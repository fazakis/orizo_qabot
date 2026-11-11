import test from 'node:test';
import assert from 'node:assert/strict';
import { Transport } from '../src/transport.mjs';
import { readReplyContext } from '../src/reply-context.mjs';
import { encryptAttachment } from '../src/media.mjs';

const group='11111111-1111-4111-8111-111111111111';
const id='22222222-2222-4222-8222-222222222222';
const row={id,conversation:group,clientMessageId:'original-client',sender:{id:12,username:'other'},eventType:'message',encryptionVersion:'e2ee_olm_v1'};
const text={version:1,eventType:'message',body:'Full original text, not the truncated preview.'};
function setup(payload=text, controls=[]) {
  const decrypted=[];
  const transport={serialize:async(f)=>f(),crypto:{decrypt:async(r)=>{
    decrypted.push(r.id);return r.id===id ? payload : r.payload;
  }}};
  return {lookup:{status:'found',row:{...row},controls},transport,maxBytes:1024,api:{downloadAttachment:()=>assert.fail('Unexpected download')},channel:{},decrypted};
}
test('authenticated full quote text and original author are returned',async()=>{
  const s=setup(); const quote=await readReplyContext(s);
  assert.equal(quote.body,text.body);assert.equal(quote.sender,'Orizo user 12 (@other)');
  assert.deepEqual(s.decrypted,[id]);assert.equal(quote.isQuote,true);
});
test('same-author edits update quote; different-author edits cannot alter it; delete wins',async()=>{
  const edit=(sender,body,eventType='edit')=>({id:body,sender:{id:sender},eventType,payload:{version:1,eventType,targetMessageId:id,body}});
  let s=setup(text,[edit(12,'latest'),edit(1,'forged'),edit(12,'older')]);
  assert.equal((await readReplyContext(s)).body,'latest');assert.ok(!s.decrypted.includes('forged'));
  s=setup(text,[edit(12,'resurrection'),edit(12,'deleted','delete')]);
  assert.match((await readReplyContext(s)).body,/unavailable/);
});
test('unreadable quote and lifecycle fail closed; client preview never used',async()=>{
  const s=setup();s.transport.crypto.decrypt=async()=>{throw Error('private error');};
  assert.match((await readReplyContext(s)).body,/unavailable/);
  assert.equal((await readReplyContext({...s,lookup:{status:'unavailable',preview:'secret old body'}})).body.includes('secret'),false);
  const c=setup(text,[{id:'broken',sender:row.sender,eventType:'edit',payload:{version:999}}]);
  assert.match((await readReplyContext(c)).body,/unavailable/);
});
test('quoted attachment uses original message AEAD binding and host media store',async()=>{
  const content=Buffer.from('test file bytes');
  const encrypted=encryptAttachment({buffer:content,contentType:'application/pdf',fileName:'../report.pdf'},group,row.clientMessageId);
  const s=setup({...text,body:'Document caption',attachment:encrypted.manifest});
  s.lookup.row.attachments=[{encryptedBlobId:encrypted.manifest.blobId,fileUrl:'https://api.orizo.app/synthetic-blob'}];
  let savedBuffer;
  s.api.downloadAttachment=async(url,max)=>{assert.equal(max,1040);return Buffer.from(encrypted.ciphertext,'base64');};
  s.channel.media={saveMediaBuffer:async(buffer,mime,kind,max,name)=>{
    assert.deepEqual(buffer,content);assert.equal(mime,'application/pdf');assert.equal(kind,'inbound');assert.equal(name,'report.pdf');savedBuffer=buffer;
    return {path:'/synthetic/report.pdf',contentType:mime};
  }};
  const quote=await readReplyContext(s);
  assert.equal(quote.body,'Document caption');assert.equal(quote.media[0].path,'/synthetic/report.pdf');
  assert.ok(savedBuffer.every(byte=>byte===0),'decrypted temporary buffer is cleared');
});
test('view-once quotes never decrypt or download protected content',async()=>{
  const s=setup();s.lookup.row.viewOnce=true;
  assert.match((await readReplyContext(s)).body,/view-once/);assert.deepEqual(s.decrypted,[]);
  s.lookup.row.viewOnce=false;s.transport.crypto.decrypt=async()=>({...text,viewOnce:true});
  assert.match((await readReplyContext(s)).body,/view-once/);
});
test('missing quoted media preserves caption but gives no file',async()=>{
  const s=setup({...text,attachment:{blobId:'missing'}});
  const quote=await readReplyContext(s);
  assert.ok(quote.body.startsWith(text.body));assert.match(quote.body,/attachment unavailable/);assert.deepEqual(quote.media,[]);
});
test('quoted attachment with wrong original-message binding is not saved',async()=>{
  const encrypted=encryptAttachment({buffer:Buffer.from('test'),contentType:'image/png',fileName:'photo.png'},group,'wrong-client-id');
  const s=setup({...text,attachment:encrypted.manifest});
  s.lookup.row.attachments=[{encryptedBlobId:encrypted.manifest.blobId,fileUrl:'https://api.orizo.app/synthetic-blob'}];
  s.api.downloadAttachment=async()=>Buffer.from(encrypted.ciphertext,'base64');
  s.channel.media={saveMediaBuffer:async()=>assert.fail('Unauthenticated media must not be saved')};
  const quote=await readReplyContext(s);
  assert.deepEqual(quote.media,[]);assert.match(quote.body,/attachment unavailable/);
});
function lookupTransport(pages) {
  const calls=[];let i=0;
  const t=new Transport({origin:'https://api.orizo.app',apiPath:p=>p,request:async(path)=>{calls.push(path);return pages[Math.min(i++,pages.length-1)];}},{state:{deviceId:'test-device'}},{});
  return {t,calls};
}
test('quote lookup pages within the same conversation and retains newer lifecycle rows',async()=>{
  const control={...row,id:'33333333-3333-4333-8333-333333333333',eventType:'edit'};
  const {t,calls}=lookupTransport([{results:[control],next:`https://api.orizo.app/api/messages/conversations/${group}/messages/?page=2`},{results:[row],next:null}]);
  const result=await t.findReply(group,id);
  assert.equal(result.row.id,id);assert.deepEqual(result.controls,[control]);assert.equal(calls.length,2);
  assert.ok(calls[1].includes('currentDeviceId=test-device'));
});
test('quote lookup rejects deleted/redacted/cross-conversation data and pagination',async()=>{
  const cases=[
    {results:[row],redacted_message_ids:[id]},
    {results:[{...row,deletedAt:'now'}]},
    {results:[{...row,conversation:id}]},
    {results:[],next:`https://attacker.invalid/api/messages/conversations/${group}/messages/`},
    {results:[],next:`https://api.orizo.app/api/messages/conversations/${id}/messages/`},
  ];
  for(const page of cases){const {t,calls}=lookupTransport([page]);assert.equal((await t.findReply(group,id)).status,'unavailable');assert.equal(calls.length,1);}
});
test('quote lookup is bounded and does not fetch invalid identifiers',async()=>{
  const {t,calls}=lookupTransport([{results:[],next:`/api/messages/conversations/${group}/messages/?page=2`}]);
  assert.equal((await t.findReply(group,id)).status,'unavailable');assert.equal(calls.length,20);
  assert.equal((await t.findReply(group,'../../other')).status,'unavailable');assert.equal(calls.length,20);
});

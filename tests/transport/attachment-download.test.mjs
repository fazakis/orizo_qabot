import test from 'node:test';
import assert from 'node:assert/strict';
import { OrizoApi } from '../../lib/src/api.mjs';
import { encryptAttachment, inboundMedia } from '../../lib/src/media.mjs';
const endpoint='https://api.orizo.app/api/messages/attachments/318/encrypted-message.bin?access=synthetic';
const cdn='https://cdn.orizo.app/gymapp-media/message_attachments/group/message/file.bin?signature=synthetic';
test('encrypted attachment follows one approved CDN redirect without API credentials',async()=>{
 const calls=[];const api=new OrizoApi(null,{fetchImpl:async(url,options)=>{
  calls.push({url:String(url),options});return calls.length===1?new Response(null,{status:302,headers:{location:cdn}}):new Response(Buffer.from('cipher'));
 }});api.tokens={access:'synthetic-token'};
 assert.equal((await api.downloadAttachment(endpoint,100)).toString(),'cipher');
 assert.equal(calls[1].url,cdn);assert.ok(calls.every(c=>c.options.redirect==='manual' && c.options.credentials==='omit' && !c.options.headers));
});
test('untrusted attachment origins, paths and redirect credentials are rejected before egress',async()=>{
 for(const location of ['https://evil.test/file.bin','http://cdn.orizo.app/gymapp-media/message_attachments/g/m/f.bin','https://cdn.orizo.app/unrelated.bin','https://user:pass@cdn.orizo.app/gymapp-media/message_attachments/g/m/f.bin','https://cdn.orizo.app:444/gymapp-media/message_attachments/g/m/f.bin','http://127.0.0.1/private']){
  let calls=0;const api=new OrizoApi(null,{fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location}});}});
  await assert.rejects(()=>api.downloadAttachment(endpoint,100),/Untrusted attachment redirect/);assert.equal(calls,1);
 }
 const api=new OrizoApi(null,{fetchImpl:async()=>assert.fail('No egress')});
 await assert.rejects(()=>api.downloadAttachment('https://evil.test/api/messages/attachments/1/encrypted-message.bin',100),/Untrusted/);
 await assert.rejects(()=>api.downloadAttachment('https://api.orizo.app/api/private',100),/Untrusted/);
});
test('redirect chains are not followed and error responses retain only HTTP status',async()=>{
 let calls=0;const api=new OrizoApi(null,{fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:cdn}});}});
 await assert.rejects(()=>api.downloadAttachment(endpoint,100),e=>e.status===302 && e.message==='Attachment HTTP 302');assert.equal(calls,2);
});
test('attachment byte limits apply after CDN redirect, including missing content-length',async()=>{
 for(const headers of [{'content-length':'101'},{}]){
  let calls=0;const api=new OrizoApi(null,{fetchImpl:async()=>++calls===1?new Response(null,{status:302,headers:{location:cdn}}):new Response(Buffer.alloc(101),{headers})});
  await assert.rejects(()=>api.downloadAttachment(endpoint,100),/Attachment too large/);
 }
});
function fixture(){
 const row={id:'m',conversation:'c',clientMessageId:'client',sender:{id:1},ciphertext:'message-cipher',cipherNonce:'nonce'};
 const e=encryptAttachment({buffer:Buffer.from('verified media'),contentType:'image/png',fileName:'image.png'},row.conversation,row.clientMessageId);
 row.attachments=[{encryptedBlobId:e.manifest.blobId,fileUrl:'old'}];
 const payload={attachment:e.manifest};
 const fresh={...row,attachments:[{...row.attachments[0],fileUrl:'fresh'}]};
 return {row,payload,fresh,cipher:Buffer.from(e.ciphertext,'base64')};
}
test('expired durable attachment URL refreshes once and still verifies the original manifest',async()=>{
 const f=fixture();let calls=0,refreshes=0,saved=0;
 const api={downloadAttachment:async url=>{calls++;if(url==='old')throw Object.assign(new Error('Attachment HTTP 404'),{status:404});return f.cipher;}};
 const channel={media:{saveMediaBuffer:async b=>{saved++;assert.equal(b.toString(),'verified media');return {path:'/synthetic/image.png'};}}};
 const result=await inboundMedia(api,channel,f.row,f.payload,100,async()=>{refreshes++;return f.fresh;});
 assert.equal(result[0].path,'/synthetic/image.png');assert.equal(calls,2);assert.equal(refreshes,1);assert.equal(saved,1);
});
test('refresh cannot replace identity, ciphertext, sender, or view-once/deleted state',async()=>{
 for(const change of [{id:'other'},{conversation:'other'},{clientMessageId:'other'},{sender:{id:12}},{ciphertext:'other'},{cipherNonce:'other'},{deletedAt:'now'},{viewOnce:true},{viewOnceConsumed:true}]){
  const f=fixture();let calls=0;
  const api={downloadAttachment:async()=>{calls++;throw Object.assign(new Error('expired'),{status:404});}};
  await assert.rejects(()=>inboundMedia(api,{},f.row,f.payload,100,async()=>({...f.fresh,...change})),/refresh rejected/);assert.equal(calls,1);
 }
});
test('CDN or refreshed ciphertext still cannot bypass attachment integrity',async()=>{
 const f=fixture();f.cipher[0]^=1;
 const api={downloadAttachment:async url=>{if(url==='old')throw Object.assign(new Error('expired'),{status:403});return f.cipher;}};
 await assert.rejects(()=>inboundMedia(api,{},f.row,f.payload,100,async()=>f.fresh),/integrity mismatch/);
});
test('view-once media never starts a download or metadata refresh',async()=>{
 const f=fixture();const api={downloadAttachment:async()=>assert.fail('No view-once download')};
 await assert.rejects(()=>inboundMedia(api,{}, {...f.row,viewOnce:true},f.payload,100,async()=>assert.fail('No refresh')),/View-once/);
});

const staged='https://cdn.orizo.app/gymapp-media/message_staging/1/4d63e868-61e0-4184-a1a8-e8de9c41a6d1/380bfc22e7604a2c99ad7fa97979e676.bin?signature=synthetic';
test('new pre-upload CDN storage reaches authenticated inbound media without credentials',async()=>{
 const f=fixture();f.row.attachments[0].fileUrl=endpoint;const calls=[];let saved=0;
 const api=new OrizoApi(null,{fetchImpl:async(url,options)=>{
  calls.push({url:String(url),options});return calls.length===1?new Response(null,{status:302,headers:{location:staged}}):new Response(f.cipher);
 }});api.tokens={access:'synthetic-token'};
 const channel={media:{saveMediaBuffer:async bytes=>{saved++;assert.equal(bytes.toString(),'verified media');return {path:'/synthetic/verified-staged.png'};}}};
 const result=await inboundMedia(api,channel,f.row,f.payload,100);
 assert.equal(result[0].path,'/synthetic/verified-staged.png');assert.equal(saved,1);assert.equal(calls.length,2);assert.equal(calls[1].url,staged);
 assert.ok(calls.every(c=>!c.options.headers && c.options.credentials==='omit' && c.options.redirect==='manual'));
});
test('pre-upload ciphertext must still match authenticated hash and message binding',async()=>{
 for(const mode of ['tampered','wrong-conversation']) {
  const f=fixture();f.row.attachments[0].fileUrl=endpoint;
  if(mode==='tampered')f.cipher[0]^=1;else f.row.conversation='other';
  let calls=0;const api=new OrizoApi(null,{fetchImpl:async()=>++calls===1?new Response(null,{status:302,headers:{location:staged}}):new Response(f.cipher)});
  await assert.rejects(()=>inboundMedia(api,{media:{saveMediaBuffer:()=>assert.fail('No unverified media')}},f.row,f.payload,100));
  assert.equal(calls,2);
 }
});
test('pre-upload redirect allowance stays limited to the exact backend storage shape',async()=>{
 for(const location of [staged.replace('message_staging','private'),staged.replace('/1/','/owner/'),staged.replace('/1/','/0/'),staged.replace('4d63e868-61e0-4184-a1a8-e8de9c41a6d1','other'),staged.replace('.bin?','.jpg?'),staged.replace('380bfc22e7604a2c99ad7fa97979e676.bin','file.bin'),staged.replace('cdn.orizo.app','evil.test'),staged.replace('https:','http:'),staged.replace('cdn.orizo.app','user:pass@cdn.orizo.app'),staged+'#fragment',staged.replace('message_staging/1/','message_staging/1/%2f'),staged.replace('/1/','/1/extra/')]) {
  let calls=0;const api=new OrizoApi(null,{fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location}});}});
  await assert.rejects(()=>api.downloadAttachment(endpoint,100),/Untrusted attachment redirect/);assert.equal(calls,1);
 }
});

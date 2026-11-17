import test from 'node:test';
import assert from 'node:assert/strict';
import {Transport} from '../src/transport.mjs';
const cid='11111111-1111-4111-8111-111111111111';
const mid=n=>`22222222-2222-4222-8222-${String(n).padStart(12,'0')}`;
const row=n=>({id:mid(n),conversation:cid});
function setup(pages){
 const calls=[];
 const api={request:async(path,options={})=>{calls.push({path,options});return pages.shift();}};
 return {transport:new Transport(api,{state:{deviceId:'device'}},{}),calls};
}
test('event-window walks opaque cursors newest first and returns chronological catchup',async()=>{
 const {transport,calls}=setup([{results:[row(3),row(4)],hasOlder:true,olderCursor:'older+/='},{results:[row(1),row(2)],hasOlder:false}]);
 assert.deepEqual(await transport.messages(cid,mid(1)),[row(2),row(3),row(4)]);
 for(const {path} of calls){const url=new URL(path,'https://example.test');assert.equal(url.pathname,`/api/messages/conversations/${cid}/event-window/`);assert.equal(url.searchParams.get('eventClass'),'all');assert.equal(url.searchParams.get('currentDeviceId'),'device');}
 assert.equal(new URL(calls[1].path,'https://example.test').searchParams.get('before'),'older+/=');
});
test('malformed windows, missing/repeated cursors and foreign rows fail closed',async()=>{
 for(const pages of [[{}],[{results:[],hasOlder:true}],[{results:[{...row(1),conversation:mid(1)}]}],[{results:[],hasOlder:true,olderCursor:'same'},{results:[],hasOlder:true,olderCursor:'same'}]]){
  const {transport}=setup(pages);await assert.rejects(transport.messages(cid));
 }
});
test('history ignores URL pagination and never follows a foreign next link',async()=>{
 const {transport,calls}=setup([{results:[row(1)],hasOlder:false,next:'https://attacker.invalid/'}]);
 assert.deepEqual(await transport.messages(cid),[row(1)]);assert.equal(calls.length,1);
});
test('delivery uses explicit device-scoped POST, deduplicates and batches at 100',async()=>{
 const {transport,calls}=setup([]);const ids=Array.from({length:201},(_,i)=>mid(i));
 await transport.acceptDelivery([...ids,ids[0],'../bad']);
 assert.deepEqual(calls.map(c=>c.options.body.messageIds.length),[100,100,1]);
 assert.deepEqual(calls.flatMap(c=>c.options.body.messageIds),ids);
 for(const c of calls){assert.equal(c.path,'/api/messages/sync/accept-delivery/');assert.equal(c.options.method,'POST');assert.equal(c.options.body.currentDeviceId,'device');}
});

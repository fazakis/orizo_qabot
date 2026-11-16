import test from 'node:test';
import assert from 'node:assert/strict';
import {QABot} from '../src/runner.mjs';
const cid='11111111-1111-4111-8111-111111111111';
const mid=n=>`22222222-2222-4222-8222-${String(n).padStart(12,'0')}`;
const message=n=>({id:mid(n),conversation:cid,eventType:'message',encryptionVersion:'e2ee_olm_v1',sender:{id:2,isBot:false}});
const cycle=(rows=[],extra={})=>({changes:rows.map(row=>({messageId:row.id,conversationId:row.conversation})),nextCursor:'next',hasMore:false,...extra});
function fixture({history=[],pages=[cycle()],resolved=[],initialized=true}={}) {
 const data=new Map(initialized?[['sync-cursor',{cursor:'saved'}],[`cursor-${cid}`,{messageId:null}]]:[]);
 const calls={changes:[],messages:[],resolve:[],metadata:[],decrypt:[],send:[]};
 const store={get:async k=>data.get(k),set:async(k,v)=>data.set(k,v)};
 const transport={
  changes:async cursor=>{calls.changes.push(cursor);const result=pages.shift();if(result instanceof Error)throw result;return result;},
  messages:async(id,after)=>{calls.messages.push([id,after]);return history;},
  resolve:async ids=>{calls.resolve.push(ids);return resolved.filter(row=>ids.includes(row.id));},
  serialize:async work=>work(),
  send:async(...args)=>{calls.send.push(args);return 'receipt';},
 };
 const options={config:{conversationIds:[cid],allowedUserIds:[2]},me:{id:9,username:'trainer_bot'},store,transport,
  api:{request:async path=>{calls.metadata.push(path);return {id:cid,type:'direct'};}},
  crypto:{decrypt:async row=>{calls.decrypt.push(row.id);return {version:1,eventType:'message',kind:'text',body:'warm up'};}}};
 return {bot:new QABot(options),options,calls,data,transport,pages};
}
test('idle cycle makes only a changes request, never a history or resolve request',async()=>{
 const f=fixture();await f.bot.poll();
 assert.deepEqual(f.calls,{changes:['saved'],messages:[],resolve:[],metadata:[],decrypt:[],send:[]});
 assert.equal(f.data.get('sync-cursor').cursor,'next');
});
test('changed IDs are deduplicated and batch-resolved; foreign conversations are excluded',async()=>{
 const rows=[message(1),message(2)];const f=fixture({pages:[cycle([...rows,rows[0],{...message(3),conversation:'other'}])],resolved:rows});
 await f.bot.poll();assert.deepEqual(f.calls.resolve,[[mid(1),mid(2)]]);assert.equal(f.calls.send.length,2);
 assert.equal(f.calls.metadata.length,1);assert.equal(f.calls.messages.length,0);
});
test('all pages are handled and journal cursor advances only after each successful page',async()=>{
 const rows=[message(1),message(2)];const f=fixture({pages:[cycle([rows[0]],{hasMore:true,nextCursor:'page2'}),cycle([rows[1]])],resolved:rows});
 await f.bot.poll();assert.deepEqual(f.calls.changes,['saved','page2']);assert.equal(f.calls.send.length,2);
});
test('partial-page failure and restart do not decrypt or reply to completed rows twice',async()=>{
 const rows=[message(1),message(2)];const f=fixture({pages:[cycle(rows),cycle(rows)],resolved:rows});
 const send=f.transport.send;let fail=true;
 f.transport.send=async(...args)=>{await send(...args);if(args[2].replyToId===mid(2)&&fail)throw Error('unavailable');};
 await assert.rejects(f.bot.poll());assert.equal(f.data.get('sync-cursor').cursor,'saved');
 fail=false;await new QABot(f.options).poll();
 assert.deepEqual(f.calls.decrypt,[mid(1),mid(2),mid(2)]);
 assert.equal(f.calls.send[1][2].operationId,f.calls.send[2][2].operationId);
 assert.equal(f.data.get('sync-cursor').cursor,'next');
});
test('baseline is captured before catchup and overlapping changes do not duplicate replies',async()=>{
 const row=message(1);const f=fixture({initialized:false,history:[row],resolved:[row],pages:[cycle([],{bootstrapRequired:true,nextCursor:'baseline'}),cycle([row])]});
 await f.bot.poll();assert.deepEqual(f.calls.changes,[undefined]);
 await f.bot.poll();assert.equal(f.calls.messages.length,1);assert.equal(f.calls.send.length,1);assert.equal(f.calls.decrypt.length,1);
});
test('empty baseline and restart never reread history',async()=>{
 const f=fixture({initialized:false,pages:[cycle([],{bootstrapRequired:true}),cycle()]});
 await f.bot.poll();await new QABot(f.options).poll();assert.equal(f.calls.messages.length,1);
});
test('explicit expired cursor resets journal only, retaining history checkpoints',async()=>{
 const expired=Object.assign(Error('expired'),{status:409,code:'message_sync_reset_required'});
 const f=fixture({pages:[expired,cycle([],{bootstrapRequired:true})]});f.data.set(`cursor-${cid}`,{messageId:mid(4)});
 await f.bot.poll();assert.deepEqual(f.calls.changes,['saved',undefined]);assert.deepEqual(f.calls.messages,[[cid,mid(4)]]);
});
test('writer conflict, authorization failure and network failure never reset cursor',async()=>{
 for(const status of [401,403,409,500]){
  const error=Object.assign(Error('unavailable'),{status,code:'bot_writer_conflict'});
  const f=fixture({pages:[error]});await assert.rejects(f.bot.poll());
  assert.deepEqual(f.calls.changes,['saved']);assert.equal(f.data.get('sync-cursor').cursor,'saved');
 }
});
test('resolve failure retains cursor; redacted and foreign rows cannot trigger a reply',async()=>{
 const f=fixture({pages:[cycle([message(1)])]});f.transport.resolve=async()=>{throw Error('unavailable');};
 await assert.rejects(f.bot.poll());assert.equal(f.data.get('sync-cursor').cursor,'saved');
 const g=fixture({pages:[cycle([message(1)])],resolved:[{...message(1),conversation:'other'}]});
 await g.bot.poll();assert.equal(g.calls.send.length,0);
 const h=fixture({pages:[cycle([message(1)])],resolved:[]});await h.bot.poll();assert.equal(h.calls.send.length,0);
});
test('new conversation is caught up even with an existing journal cursor',async()=>{
 const row=message(1);const f=fixture({history:[row],resolved:[row]});f.data.delete(`cursor-${cid}`);
 await f.bot.poll();assert.equal(f.calls.messages.length,1);assert.equal(f.calls.send.length,1);
});
test('upgrade honors older outgoing receipts when the journal revisits a message',async()=>{
 const row=message(1);const f=fixture({pages:[cycle([row])],resolved:[row]});
 f.data.set(`send-faq-${row.id}`,{messageId:'old-reply'});await f.bot.poll();
 assert.equal(f.calls.decrypt.length,0);assert.equal(f.calls.send.length,0);
});
test('catchup resolves at most 100 rows per request and keeps chronological processing',async()=>{
 const rows=Array.from({length:101},(_,i)=>message(i+1));
 const f=fixture({initialized:false,history:rows,resolved:rows,pages:[cycle([],{bootstrapRequired:true})]});
 await f.bot.poll();assert.deepEqual(f.calls.resolve.map(ids=>ids.length),[100,1]);
 assert.deepEqual(f.calls.decrypt,rows.map(row=>row.id));
});
test('page budget resumes from the last committed cursor instead of dropping changes',async()=>{
 const pages=Array.from({length:21},(_,i)=>cycle([],{nextCursor:`page-${i}`,hasMore:i<20}));
 const f=fixture({pages});await f.bot.poll();assert.equal(f.calls.changes.length,20);
 assert.equal(f.data.get('sync-cursor').cursor,'page-19');await f.bot.poll();
 assert.equal(f.calls.changes.at(-1),'page-19');assert.equal(f.data.get('sync-cursor').cursor,'page-20');
});

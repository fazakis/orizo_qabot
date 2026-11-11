import test from 'node:test';
import assert from 'node:assert/strict';
import {QABot} from '../src/runner.mjs';
const cid='11111111-1111-4111-8111-111111111111';
const row={id:'22222222-2222-4222-8222-222222222222',conversation:cid,eventType:'message',encryptionVersion:'e2ee_olm_v1',sender:{id:2,isBot:false}};
function fixture({rows=[row],resolved=rows,type='direct',body='warm up',send}={}) {
  const data=new Map(), calls=[], state={decrypts:0};
  const store={get:async k=>data.get(k),set:async(k,v)=>{data.set(k,v);}};
  const transport={messages:async(id,after)=>after?[]:rows,resolve:async ids=>resolved.filter(r=>ids.includes(r.id)),serialize:async f=>f(),send:async(...args)=>{calls.push(args);if(send)await send(...args);return 'accepted';}};
  const options={config:{conversationIds:[cid],allowedUserIds:[2]},me:{id:9,username:'trainer_bot'},store,transport,api:{request:async()=>({id:cid,type})},crypto:{decrypt:async()=>{state.decrypts++;return {version:1,eventType:'message',kind:'text',body};}}};
  return {bot:new QABot(options),options,data,calls,state};
}
test('approved trainee receives reply once with stable operation ID',async()=>{
 const f=fixture();await f.bot.poll();await f.bot.poll();assert.equal(f.calls.length,1);assert.equal(f.calls[0][2].replyToId,row.id);assert.equal(f.calls[0][2].operationId,`faq-${row.id}`);
});
test('default mode admits a consenting human without a local allowlist but still excludes bots',async()=>{
 const f=fixture();f.bot.config.allowedUserIds=[];await f.bot.poll();assert.equal(f.calls.length,1);
 assert.equal(f.bot.admit({...row,sender:{id:7,isBot:true}},cid),false);
});
test('failed send keeps checkpoint; restart reuses operation ID',async()=>{
 let fail=true;const f=fixture({send:async()=>{if(fail)throw Error('synthetic failure');}});
 await assert.rejects(f.bot.poll());assert.equal(f.data.size,0);fail=false;
 await new QABot(f.options).poll();assert.equal(f.calls[0][2].operationId,f.calls[1][2].operationId);assert.equal(f.data.size,1);
});
test('rejects own/bot/unapproved/cross-conversation/expired/view-once/control events before decryption',async()=>{
 for(const change of [{sender:{id:9}},{sender:{id:2,isBot:true}},{sender:{id:3}},{conversation:'other'},{expiresAt:'2000-01-01'},{expiresAt:'invalid'},{viewOnce:true},{viewOnceConsumed:true},{deletedAt:'now'},{eventType:'edit'},{encryptionVersion:'plaintext'}]) {
  const f=fixture({rows:[{...row,...change}]});await f.bot.poll();assert.equal(f.calls.length,0);assert.equal(f.state.decrypts,0);
 }
});
test('freshly deleted/unresolvable events do not reply',async()=>{
 const f=fixture({resolved:[]});await f.bot.poll();assert.equal(f.calls.length,0);
});
test('group activation requires explicit bot mention',async()=>{
 for(const [body,count] of [['warm up',0],['@trainer_bot warm up',1],['@trainer_bot_evil warm up',0]]) {
  const f=fixture({type:'group',body});await f.bot.poll();assert.equal(f.calls.length,count);
 }
});
test('decryption failure retains cursor and never sends',async()=>{
 const f=fixture();f.options.crypto.decrypt=async()=>{throw Error('invalid ciphertext');};
 await assert.rejects(f.bot.poll());assert.equal(f.data.size,0);assert.equal(f.calls.length,0);
});

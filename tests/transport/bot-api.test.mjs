import test from 'node:test';
import assert from 'node:assert/strict';
import {OrizoApi} from '../../lib/src/api.mjs';
const token='obt1.'+'a'.repeat(32)+'.'+'b'.repeat(43),origin='https://dev.orizo.app';
function setup(overrides={}){
 const data={credential:{origin,token},...overrides},calls=[];
 const api=new OrizoApi({get:async k=>structuredClone(data[k]),put:async(k,v)=>{data[k]=structuredClone(v);}}, {origin,fetchImpl:async(url,options)=>{
  calls.push({path:url.pathname,options});
  let result;
  if(url.pathname.endsWith('/me/'))result={id:342,username:'different_bot',isBot:true,botId:'bot-id',installationId:'installation-id'};
  else if(url.pathname.endsWith('/writer-lease/'))result={writerId:JSON.parse(options.body).writerId,expiresAt:new Date(Date.now()+120000).toISOString()};
  else result={ok:true};
  return {ok:true,status:200,json:async()=>result};
 }});return {api,data,calls};
}
test('bot credential is bound to HTTPS origin and never sent to ordinary APIs',async()=>{
 const {api,calls,data}=setup();await api.authenticate();await api.request('/api/messages/conversations/');
 assert.ok(calls.every(c=>c.path.startsWith('/api/bots/v1/')));
 assert.ok(calls.every(c=>c.options.headers.Authorization===`Bearer ${token}`));
 assert.equal(data.account.userId,342);assert.equal(data.account.origin,origin);
 for(const path of ['/api/users/','https://attacker.invalid/','/api/bots/v1/../../auth/token/','/api/bots/v1/%2e%2e/'])await assert.rejects(api.request(path));
 assert.equal(calls.length,3);
});
test('credential origin mismatch and account/installation mismatch stop before crypto initialization',async()=>{
 const wrong=setup({credential:{origin:'https://api.orizo.app',token}});await assert.rejects(wrong.api.authenticate(),/origin mismatch/);assert.equal(wrong.calls.length,0);
 const other=setup({account:{origin,userId:100,botId:'old',installationId:'old'}});await assert.rejects(other.api.authenticate(),/identity changed/);
});
test('concurrent first requests claim one writer lease and reuse it',async()=>{
 const {api,calls}=setup();await api.authenticate();await Promise.all(Array.from({length:5},()=>api.request('/api/messages/conversations/')));
 assert.equal(calls.filter(c=>c.path.endsWith('/writer-lease/')).length,1);
});

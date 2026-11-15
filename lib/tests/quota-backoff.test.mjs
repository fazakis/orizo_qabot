import test from 'node:test';
import assert from 'node:assert/strict';
import {OrizoApi} from '../src/api.mjs';

test('429 Retry-After blocks polling, sends and lease renewal without replaying a write', async()=>{
  let calls=0;
  const api=new OrizoApi({}, {fetchImpl:async()=>{
    calls++;
    return {ok:false,status:429,headers:new Headers({'Retry-After':'3600'}),
      json:async()=>({code:'bot_owner_hourly_limit'})};
  }});
  api.tokens={access:'synthetic-not-a-real-token'};
  await assert.rejects(api.request('/api/bots/v1/me/',{lease:false}),e=>e.status===429&&e.retryAfter===3600);
  await assert.rejects(api.request('/api/messages/conversations/'),e=>e.status===429&&e.code==='bot_owner_hourly_limit');
  await assert.rejects(api.request('/api/messages/conversations/fake/messages/',{method:'POST',body:{text:'synthetic'}}),e=>e.status===429);
  assert.equal(calls,1,'cooldown does not send another HTTP request or claim a writer');
  api.quotaBackoffUntil=Date.now()-1;
  api.fetch=async()=>{calls++;return {ok:true,status:200,json:async()=>({ok:true})};};
  assert.deepEqual(await api.request('/api/bots/v1/me/',{lease:false}),{ok:true});
  assert.equal(calls,2);
});
test('invalid Retry-After uses bounded fallback without disclosing response content', async()=>{
  const api=new OrizoApi({}, {fetchImpl:async()=>({ok:false,status:429,
    headers:new Headers({'Retry-After':'not-a-date'}),json:async()=>({token:'synthetic-private'})})});
  api.tokens={access:'synthetic'};
  await assert.rejects(api.request('/api/bots/v1/me/',{lease:false}),e=>e.retryAfter===60&&!e.message.includes('synthetic-private'));
});

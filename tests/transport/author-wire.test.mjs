import test from 'node:test';
import assert from 'node:assert/strict';
import {OrizoApi} from '../../lib/src/api.mjs';
test('author proof is JSON text in both JSON and multipart API requests, without changing queued object',async()=>{
 for(const attachment of [undefined,Buffer.from('synthetic').toString('base64')]){
  const header={version:2,certificateId:'synthetic-only',certificates:[{body:{issuerCertificateId:null}}],signature:'synthetic'};
  const body={clientMessageId:'synthetic-id',senderBinding:header};
  const api=new OrizoApi(null,{fetchImpl:async(url,o)=>{
   const fields=attachment?Object.fromEntries(o.body.entries()):JSON.parse(o.body);
   assert.equal(typeof fields.senderBinding,'string');assert.deepEqual(JSON.parse(fields.senderBinding),header);
   return {ok:true,status:200,json:async()=>({id:'receipt'})};
  }});api.tokens={access:'synthetic-not-a-credential'};api.leaseUntil=Date.now()+60000;
  assert.deepEqual(await api.request('/api/messages/conversations/synthetic/messages/',{method:'POST',body,attachment}),{id:'receipt'});
  assert.deepEqual(body.senderBinding,header);
 }
});

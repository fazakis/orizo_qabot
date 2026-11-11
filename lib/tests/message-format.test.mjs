import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPrivateKey,sign} from 'node:crypto';
import {OrizoCrypto,b64,bytes,utf8} from '../src/crypto.mjs';
import * as d from '../vendor/directory.mjs';
import * as core from '../vendor/crypto.mjs';
const v=JSON.parse(readFileSync(new URL('./fixtures/messageAuthorBindingVectors.json',import.meta.url)));
const f=v.context;
const raw={conversation:f.conversation_id,clientMessageId:f.client_message_id,sender:{id:f.user_id},senderDeviceId:f.device_id,
 senderSessionGeneration:f.session_generation,eventType:f.event_type,cipherNonce:f.cipher_nonce,ciphertext:f.ciphertext,senderBinding:v.binding,
 deviceEnvelopes:[{deviceId:'receiver',scheme:'olm_v1',messageType:0,ciphertext:'synthetic-wrap'}]};
function receiver(){
 const c=new OrizoCrypto(null,null);c.userId=99;c.state={deviceId:'receiver',recipientTrust:{[f.user_id]:{accountSigningKey:v.pinnedAccountKey}}};let calls=0;
 c.engine={decryptEnvelope:async input=>{calls++;assert.equal(input.identityKey,v.binding.certificates.find(p=>p.id===v.binding.certificateId).body.identityKey.replace(/=+$/,''));return {plaintext:v.contentKey};}};
 return {c,calls:()=>calls};
}
test('current app/backend author vector decrypts through real bot receiver',async()=>{
 const {c,calls}=receiver();assert.deepEqual(await c.decrypt({...raw,senderIdentityKey:'untrusted-alias'}),JSON.parse(v.plaintext));assert.equal(calls(),1);
});
test('forged headers and altered sender/session/body are rejected before ratchet/key access',async()=>{
 for(const change of [{sender:{id:43}},{senderSessionGeneration:7},{ciphertext:'changed'},
  {senderBinding:{...v.binding,signature:b64(Buffer.alloc(64))}},
  {sender_binding:{...v.binding,signature:b64(Buffer.alloc(64))}}]){
  const h=receiver();await assert.rejects(h.c.decrypt({...raw,...change}));assert.equal(h.calls(),0);
 }
 const h=receiver();h.c.state.recipientTrust[f.user_id].accountSigningKey=b64(Buffer.alloc(32));await assert.rejects(h.c.decrypt(raw));assert.equal(h.calls(),0);
});
test('stripping new header cannot downgrade author-bound ciphertext; real legacy body remains readable',async()=>{
 const {c}=receiver(),legacy={...raw};delete legacy.senderBinding;
 c.engine.decryptEnvelope=async()=>({plaintext:v.contentKey});
 await assert.rejects(c.decrypt(legacy));
 legacy.ciphertext=b64(core.xchacha20poly1305(bytes(v.contentKey),bytes(f.cipher_nonce),utf8(`orizo-e2ee-content-v1:${f.conversation_id}:${f.client_message_id}`)).encrypt(utf8(v.plaintext)));
 assert.deepEqual(await c.decrypt(legacy),JSON.parse(v.plaintext));
});
test('bot sends author-bound ciphertext accepted by app verifier and can recover it for directory refresh',async()=>{
 const c=new OrizoCrypto(null,null),leaf=v.binding.certificates.find(p=>p.id===v.binding.certificateId);
 c.userId=f.user_id;c.state={deviceId:f.device_id,selfKey:b64(Buffer.alloc(32,9)),directoryTrust:{accountSigningKey:v.pinnedAccountKey}};
 c.directoryIdentity={certificate:leaf,certificates:Object.fromEntries(v.binding.certificates.map(p=>[p.id,p])),accountSigningKey:v.pinnedAccountKey};
 const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(Array.from({length:32},(_,i)=>i+32))]),format:'der',type:'pkcs8'});
 c.engine={sign:async text=>b64(sign(null,Buffer.from(text),privateKey)),encryptForDevices:async()=>({envelopes:[],skippedDeviceIds:[]})};
 c.recipients=async()=>({ready:true,devices:[{deviceId:f.device_id,userId:f.user_id,isCurrentDevice:true,sessionGeneration:f.session_generation}],recoveryVaults:[],membershipVersion:2,directoryRevision:'revision'});
 const payload={version:1,eventType:'message',body:'synthetic compatibility check'};
 const result=await c.encrypt(f.conversation_id,f.client_message_id,payload);
 const row={...result,conversation:f.conversation_id,clientMessageId:f.client_message_id,sender:{id:f.user_id}};
 assert.equal(result.senderBinding.version,2);assert.equal(result.directoryRevision,'revision');
 await d.verifyMessageAuthorBinding({binding:result.senderBinding,context:d.messageAuthorContextFromRaw(row),cipherNonce:row.cipherNonce,ciphertext:row.ciphertext,pinnedAccountKey:v.pinnedAccountKey});
 assert.deepEqual(await c.decrypt(row),payload);
});
test('blocked directory fails before session processing and a blocked second fetch cannot become a send',async()=>{
 for(const result of [{ready:false,devices:[]},{ready:true,devices:[]},{ready:true,devices:[{deviceId:'different',isCurrentDevice:true}]}]){
  const c=new OrizoCrypto(null,{request:async()=>result});c.state={deviceId:'own'};c.engine={hasSessions:async()=>assert.fail('not ready')};
  await assert.rejects(c.recipients(f.conversation_id),{code:'message_delivery_directory_not_ready'});
 }
 let n=0;const c=new OrizoCrypto(null,{request:async()=>++n===1?{ready:true,devices:[{deviceId:'own',isCurrentDevice:true},{deviceId:'peer'}]}:{ready:false,devices:[]}});
 c.state={deviceId:'own'};c.engine={hasSessions:async()=>({})};
 await assert.rejects(c.recipients(f.conversation_id),{code:'message_delivery_directory_not_ready'});assert.equal(n,2);
});

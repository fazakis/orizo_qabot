import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {KeyFiles} from '../../src/key-files.mjs';
import {OrizoCrypto} from '../../lib/src/crypto.mjs';
import {Transport} from '../../lib/src/transport.mjs';
import {DiskStore} from '../../lib/src/store.mjs';
import {QABot} from '../../src/runner.mjs';
import {answer} from '../../src/answers.mjs';
// Synthetic signed directory, no production network or human/bot credentials.
const {signDirectoryDevice,canonicalDirectorySigningKey}=await import(new URL('../vendor/directory.mjs',import.meta.resolve('../../lib/src/crypto.mjs')));
const {x25519}=await import(new URL('../vendor/crypto.mjs',import.meta.resolve('../../lib/src/crypto.mjs')));
test('Linux vault: trainee encrypts question, FAQ replies decryptably, restart does not duplicate',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qabot-e2ee-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const keyFile=join(root,'master.key');await writeFile(keyFile,randomBytes(32),{mode:0o600});
 const devices=new Map(),messages=[],cid=randomUUID();
 const apiFor=id=>({request:async(path,{body,method='GET'}={})=>{
  if(path==='/api/messages/e2ee/devices/') {devices.set(body.deviceId,{...body,userId:id});return {};}
  if(path.endsWith('/recipients/'))return {ready:true,devices:[...devices.values()].map(d=>({...d,isCurrentDevice:d.deviceId===body.currentDeviceId,sessionGeneration:1,...(body.missingDeviceIds.includes(d.deviceId)?{oneTimeKey:{publicKey:Object.values(d.oneTimeKeys)[0]}}:{})})),recoveryVaults:[],membershipVersion:1};
  if(path===`/api/messages/conversations/${cid}/`)return {id:cid,type:'direct'};
  if(path==='/api/messages/sync/resolve/')return {results:messages.filter(m=>body.messageIds.includes(m.id))};
  if(path.startsWith(`/api/messages/conversations/${cid}/messages/`)) {
   if(method==='GET')return [...messages].reverse();
   const device=[...devices.values()].find(d=>d.userId===id);
   const row={...body,id:randomUUID(),conversation:cid,sender:{id,isBot:id===72},senderIdentityKey:device.identityKey,senderSessionGeneration:1};
   messages.push(row);return row;
  }
  throw Error('Unexpected synthetic API route');
 }});
 async function peer(id) {
  const vault=new KeyFiles(join(root,`keys-${id}`)); await vault.init();
  if(!await vault.get('account'))await vault.put('account',{userId:id});
  const api=apiFor(id),crypto=new OrizoCrypto(vault,api);await crypto.initialize();await crypto.register();
  const accountSigningKey=canonicalDirectorySigningKey(crypto.engine.signingKey);
  const certificate=await signDirectoryDevice({state:{userId:id,deviceId:crypto.state.deviceId,identityKey:crypto.engine.identityKey,signingKey:crypto.engine.signingKey,notificationPublicKey:Buffer.from(x25519.getPublicKey(Buffer.from(crypto.state.notificationKey,'base64'))).toString('base64')},accountSigningKey,issuerCertificateId:null,sign:text=>crypto.engine.sign(text)});
  crypto.directoryIdentity={accountSigningKey,certificate,certificates:{[certificate.id]:certificate}};
  const store=new DiskStore(join(root,`state-${id}`));return {api,crypto,store,transport:new Transport(api,crypto,store)};
 }
 const trainee=await peer(71);let bot=await peer(72);
 t.after(async()=>{await trainee.crypto.close();await bot.crypto.close();});
 const question='How should I warm up?';await trainee.transport.send(cid,question,{operationId:'question-1'});
 const config={conversationIds:[cid],allowedUserIds:[71]},me={id:72,username:'trainer_test_bot'};
 await new QABot({...bot,config,me}).poll();assert.equal(messages.length,2);
 assert.equal((await trainee.crypto.decrypt(messages[1])).body,answer(question));
 assert.ok(!JSON.stringify(messages).includes(question));assert.ok(!JSON.stringify(messages).includes(answer(question)));
 const deviceId=bot.crypto.state.deviceId;await bot.crypto.close();bot=await peer(72);
 assert.equal(bot.crypto.state.deviceId,deviceId);await new QABot({...bot,config,me}).poll();assert.equal(messages.length,2);
});

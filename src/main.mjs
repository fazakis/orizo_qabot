import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {KeyFiles,privateDir} from './key-files.mjs';
import {OrizoApi} from '../lib/src/api.mjs';
import {OrizoCrypto,camel} from '../lib/src/crypto.mjs';
import {DiskStore} from '../lib/src/store.mjs';
import {Transport} from '../lib/src/transport.mjs';
import {QABot} from './runner.mjs';
import {acquireLock} from './lock.mjs';
export async function run(config) {
 let api,crypto,unlock;
 const abort=new AbortController();
 const stop=()=>abort.abort();
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,stop);
 try {
  await privateDir(config.stateDir);
  unlock=await acquireLock(config.stateDir);
  const vault=new KeyFiles(join(config.stateDir,'keys'),{tokenFile:config.tokenFile,origin:config.apiOrigin});await vault.init();
  api=new OrizoApi(vault,{origin:config.apiOrigin,cdnOrigin:config.cdnOrigin});
  await api.authenticate();const me=camel(await api.request('/api/me/'));
  await api.ensureWriter();
  crypto=new OrizoCrypto(vault,api);await crypto.initialize();await crypto.register();await crypto.ensureRecovery();
  const store=new DiskStore(join(config.stateDir,'messages'));
  const transport=new Transport(api,crypto,store);
  const bot=new QABot({config,me,api,crypto,store,transport});
  console.log(`Ready: @${me.username}; encrypted FAQ replies enabled.`);
  let maintenanceAt=0;
  while(!abort.signal.aborted){
   try {
    if(Date.now()>=maintenanceAt){
     await api.request(`/api/messages/e2ee/devices/${crypto.state.deviceId}/heartbeat/`,{method:'POST',body:{installationId:crypto.state.installationId}});
     const devices=camel(await api.request('/api/messages/e2ee/devices/')).devices||[];
     if(devices.find(d=>d.deviceId===crypto.state.deviceId)?.oneTimeKeyCount<12)await transport.serialize(()=>crypto.register());
     maintenanceAt=Date.now()+60000;
    }
    // The server returns only explicit Start/admin-consented grants, never arbitrary inboxes.
    for(const r of await api.request('/api/messages/requests/')){
     if(config.conversationIds.length && !config.conversationIds.includes(r.id))continue;
     // Sender-limited installations do not automatically accept new conversations.
     if(config.allowedUserIds.length && !config.conversationIds.includes(r.id))continue;
     await api.request(`/api/messages/conversations/${r.id}/request-decision/`,{method:'POST',body:{decision:'accept'}});
    }
    if(!config.allowedUserIds.length && !config.conversationIds.length)
     for(const i of await api.request('/api/messages/group-invites/'))await api.request('/api/messages/group-invites/',{method:'POST',body:{inviteId:i.id,decision:'accept'}});
    bot.config={...config,conversationIds:config.conversationIds.length?config.conversationIds:(await transport.conversations()).map(c=>c.id)};
    await bot.poll();
   }catch(error){
    if([401,403,409].includes(error.status))throw error;
    console.error('Connection/poll unavailable; retaining keys and checkpoint for retry.');
   }
   await sleep(config.pollIntervalMs,undefined,{signal:abort.signal}).catch(e=>{if(e.name!=='AbortError')throw e;});
  }
 }finally{
  await crypto?.close().catch(()=>{});await api?.releaseWriter().catch(()=>{});await unlock?.();
  for(const sig of ['SIGINT','SIGTERM'])process.off(sig,stop);
 }
}

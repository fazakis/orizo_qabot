/** Validate every delivery key before planning any sealed first-use pin. */
import {DirectoryCertificateError,canonicalDirectorySigningKey,verifyDirectoryCertificateChain,
 verifyDirectoryCertificatePossession,type DirectoryCertificate} from './directoryCertificates';
import {directoryDeviceMatches,publicDirectoryCertificatePool,publicDirectoryPossessionProofs} from './directoryIdentity';
import type {DirectorySnapshot} from './conversationDirectoryTrust';

export class RecipientDirectoryCertificateError extends Error{
 readonly code='message_directory_certificate_required';
 constructor(){super('Messaging identity approval is required before sending. Open message security on your trusted device and ask the recipient to do the same.');}
}
type Account={userId:number;accountSigningKey:string;rootCertificateId:string};
type DeviceBinding={userId:number;deviceId:string;certificateId:string};
type VaultBinding={userId:number;vaultId:string;epoch:number;certificateId:string};
type Pin={userId:number;accountSigningKey:string};
const object=(value:unknown):Record<string,any>=>{
 if(!value || typeof value!=='object' || Array.isArray(value))throw new DirectoryCertificateError();return value as Record<string,any>;
};
function exact(value:unknown,keys:string[]):Record<string,any>{
 const data=object(value);if(Object.keys(data).sort().join(',')!==keys.sort().join(','))throw new DirectoryCertificateError();return data;
}
function rows<T>(value:unknown,limit:number,keys:string[],id:(entry:T)=>string):Map<string,T>{
 if(!Array.isArray(value) || value.length>limit)throw new DirectoryCertificateError();
 const result=new Map<string,T>();
 for(const valueEntry of value){const entry=exact(valueEntry,keys) as T,key=id(entry);if(result.has(key))throw new DirectoryCertificateError();result.set(key,entry);}
 return result;
}
/** verifiedLegacy means the complete unchanged v2 device/vault fingerprint was
 * independently verified before this root existed locally. Merely certifying
 * a known public key under an attacker root is insufficient for migration.
 */
export function validateRecipientDirectoryCertificates(input:{
 targets:DirectorySnapshot;proofs:unknown;pins:ReadonlyMap<number,string|null>;verifiedLegacy:boolean;
}):Pin[]{
 try{
  if(!input.targets.devices.length || input.targets.devices.length>64 || input.targets.recoveryVaults.length>32)throw new DirectoryCertificateError();
  const data=exact(input.proofs,['version','accounts','devices','recoveryVaults','possessionProofs','certificates']);
  if(data.version!==1)throw new DirectoryCertificateError();
  const pool=publicDirectoryCertificatePool(data.certificates),proofs=publicDirectoryPossessionProofs(data.possessionProofs,pool);
  const accountRows=rows<Account>(data.accounts,64,['userId','accountSigningKey','rootCertificateId'],entry=>String(entry.userId));
  const deviceRows=rows<DeviceBinding>(data.devices,64,['userId','deviceId','certificateId'],entry=>`${entry.userId}:${entry.deviceId}`);
  const vaultRows=rows<VaultBinding>(data.recoveryVaults,32,['userId','vaultId','epoch','certificateId'],entry=>String(entry.userId));
  const users=new Set([...input.targets.devices,...input.targets.recoveryVaults].map(target=>target.userId));
  if(accountRows.size!==users.size || deviceRows.size!==input.targets.devices.length || vaultRows.size!==input.targets.recoveryVaults.length)throw new DirectoryCertificateError();
  const accounts=new Map<number,Account>();
  for(const userId of users){
   const account=accountRows.get(String(userId));
   if(!Number.isSafeInteger(userId) || userId<=0 || !account || account.userId!==userId || !input.pins.has(userId))throw new DirectoryCertificateError();
   const key=canonicalDirectorySigningKey(account.accountSigningKey),pin=input.pins.get(userId);
   if(pin!==null && pin!==key)throw new DirectoryCertificateError();
   const root=verifyDirectoryCertificateChain(account.rootCertificateId,pool,{userId,pinnedAccountKey:pin});
   if(root.issuerCertificateId!==null || root.accountSigningKey!==key)throw new DirectoryCertificateError();
   accounts.set(userId,{...account,accountSigningKey:key});
  }
  const selected:DirectoryCertificate[]=[];
  for(const target of input.targets.devices){
   const binding=deviceRows.get(`${target.userId}:${target.deviceId}`),account=accounts.get(target.userId)!;
   if(!binding || binding.userId!==target.userId || binding.deviceId!==target.deviceId)throw new DirectoryCertificateError();
   const body=verifyDirectoryCertificateChain(binding.certificateId,pool,{userId:target.userId,pinnedAccountKey:account.accountSigningKey});
   if(!directoryDeviceMatches(body,target))throw new DirectoryCertificateError();
   const packet=pool[binding.certificateId];verifyDirectoryCertificatePossession(packet,proofs[packet.id]);selected.push(packet);
  }
  for(const target of input.targets.recoveryVaults){
   const binding=vaultRows.get(String(target.userId)),account=accounts.get(target.userId)!;
   if(!binding || binding.userId!==target.userId || binding.epoch!==target.epoch)throw new DirectoryCertificateError();
   const body=verifyDirectoryCertificateChain(binding.certificateId,pool,{userId:target.userId,pinnedAccountKey:account.accountSigningKey});
   if(body.purpose!=='recovery' || body.vaultId!==binding.vaultId || body.epoch!==target.epoch
    || body.recoveryPublicKey!==target.recoveryPublicKey)throw new DirectoryCertificateError();
   const packet=pool[binding.certificateId];verifyDirectoryCertificatePossession(packet,proofs[packet.id]);selected.push(packet);
  }
  const pins:Pin[]=[];
  for(const [userId,account] of accounts){
   if(input.pins.get(userId)!==null)continue;
   if(input.verifiedLegacy){
    const known=input.targets.devices.filter(device=>device.userId===userId);
    const rootHeldByVerifiedDevice=known.some(device=>canonicalDirectorySigningKey(device.signingKey)===account.accountSigningKey);
    const priorDeviceEndorsement=selected.some(packet=>packet.body.purpose==='device' && packet.body.userId===userId
     && known.some(device=>directoryDeviceMatches(packet.body,device,false)) && proofs[packet.id]!==undefined);
    if(!rootHeldByVerifiedDevice && !priorDeviceEndorsement)throw new DirectoryCertificateError();
   }
   pins.push({userId,accountSigningKey:account.accountSigningKey});
  }
  return pins;
 }catch{throw new RecipientDirectoryCertificateError();}
}

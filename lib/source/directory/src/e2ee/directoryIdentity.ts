/** Public enrollment coordinator. Signing and sealed pins stay with the existing E2EE owner. */
import {fromByteArray,toByteArray} from 'base64-js';
import {sha256} from '@noble/hashes/sha2.js';
import {
 canonicalDirectoryCertificateBody,canonicalDirectoryCertificatePacket,directoryCertificateAuthorization,directoryCertificateId,
 directoryCertificatePossessionAuthorization,verifyDirectoryCertificatePossession,
 DirectoryCertificateError,MAX_DIRECTORY_CERTIFICATES,verifyDirectoryCertificateChain,
 type DirectoryCertificate,type DirectoryCertificateBody,
} from './directoryCertificates';

export type LocalDirectoryDevice={userId:number;deviceId:string;identityKey:string;signingKey:string;notificationPublicKey:string};
export type EnrolledDirectoryIdentity={accountSigningKey:string;certificate:DirectoryCertificate;certificates:Record<string,DirectoryCertificate>;possessionSignature:string};
export class DirectoryIdentityApprovalRequired extends Error {
 readonly code='message_directory_approval_required';
 constructor(){super('Approve this messaging identity on an already trusted device.');}
}
export function directoryNotificationKeyHash(key:string):string {
 const normalized=key.replace(/-/g,'+').replace(/_/g,'/');
 return fromByteArray(sha256(key?toByteArray(normalized+'='.repeat((4-normalized.length%4)%4)):new Uint8Array()));
}
export function directoryDeviceMatches(body:DirectoryCertificateBody,state:LocalDirectoryDevice,includeNotification=true):boolean {
 if(body.purpose!=='device')return false;
 const expected=canonicalDirectoryCertificateBody({...body,userId:state.userId,deviceId:state.deviceId,
  identityKey:state.identityKey,signingKey:state.signingKey,notificationKeyHash:directoryNotificationKeyHash(state.notificationPublicKey)});
 return expected.purpose==='device' && body.userId===expected.userId && body.deviceId===expected.deviceId
  && body.identityKey===expected.identityKey && body.signingKey===expected.signingKey
  && (!includeNotification || body.notificationKeyHash===expected.notificationKeyHash);
}
export async function signDirectoryDevice(input:{state:LocalDirectoryDevice;accountSigningKey:string;issuerCertificateId:string|null;sign:(authorization:string)=>Promise<string>}):Promise<DirectoryCertificate>{
 const body=canonicalDirectoryCertificateBody({version:1,purpose:'device',userId:input.state.userId,
  accountSigningKey:input.accountSigningKey,issuerCertificateId:input.issuerCertificateId,canApprove:true,
  deviceId:input.state.deviceId,identityKey:input.state.identityKey,signingKey:input.state.signingKey,
  notificationKeyHash:directoryNotificationKeyHash(input.state.notificationPublicKey)});
 return canonicalDirectoryCertificatePacket({id:directoryCertificateId(body),body,signature:await input.sign(directoryCertificateAuthorization(body))});
}
export function publicDirectoryCertificatePool(value:unknown):Record<string,DirectoryCertificate>{
 if(!Array.isArray(value) || value.length>MAX_DIRECTORY_CERTIFICATES)throw new DirectoryCertificateError();
 const result:Record<string,DirectoryCertificate>=Object.create(null);
 for(const packet of value){
  if(!packet || typeof packet!=='object' || typeof packet.id!=='string' || !/^[a-f0-9]{64}$/.test(packet.id) || Object.hasOwn(result,packet.id))throw new DirectoryCertificateError();
  result[packet.id]=packet;
 }
 return result;
}
export function publicDirectoryPossessionProofs(value:unknown,certificates:Record<string,DirectoryCertificate>):Record<string,string>{
 if(!Array.isArray(value) || value.length>MAX_DIRECTORY_CERTIFICATES)throw new DirectoryCertificateError();
 const result:Record<string,string>=Object.create(null);
 for(const proof of value){
  if(!proof || typeof proof!=='object' || Object.keys(proof).sort().join(',')!=='certificateId,signature'
    || typeof proof.certificateId!=='string' || !Object.hasOwn(certificates,proof.certificateId)
    || Object.hasOwn(result,proof.certificateId) || typeof proof.signature!=='string' || proof.signature.length>256)throw new DirectoryCertificateError();
  result[proof.certificateId]=proof.signature;
 }
 return result;
}
type Snapshot={version:1;accountSigningKey:string|null;rootCertificateId:string|null;certificates:DirectoryCertificate[];possessionProofs:unknown};
function snapshot(value:unknown):Snapshot {
 if(!value || typeof value!=='object')throw new DirectoryCertificateError();
 const data=value as Snapshot;
 if(data.version!==1 || (data.accountSigningKey!==null && typeof data.accountSigningKey!=='string')
  || (data.rootCertificateId!==null && typeof data.rootCertificateId!=='string'))throw new DirectoryCertificateError();
 publicDirectoryPossessionProofs(data.possessionProofs,publicDirectoryCertificatePool(data.certificates));
 return data;
}
/** Callbacks must use the existing account generation and sealed-record key.
 * Browser callers already hold the Olm engine's exclusive account tab lock.
 */
export function createDirectoryIdentityEnrollment(input:{
 state:LocalDirectoryDevice;assertCurrent:()=>void;readPin:()=>Promise<string|null>;
 savePin:(key:string)=>Promise<void>;fetch:()=>Promise<unknown>;publish:(certificate:DirectoryCertificate,possessionSignature?:string)=>Promise<unknown>;
 sign:(authorization:string)=>Promise<string>;
}){
 let inFlight:Promise<EnrolledDirectoryIdentity>|null=null;
 const current=()=>input.assertCurrent();
 async function publishOwn(certificate:DirectoryCertificate):Promise<string>{
  current();const raw=await input.sign(directoryCertificatePossessionAuthorization(certificate.id));current();
  const proof=verifyDirectoryCertificatePossession(certificate,raw);
  await input.publish(certificate,proof);current();return proof;
 }
 async function ensure():Promise<EnrolledDirectoryIdentity>{
  current();const pin=await input.readPin();current();
  if(pin!==null && (typeof pin!=='string' || !pin))throw new DirectoryCertificateError();
  let anchor=pin,bootstrapRootId:string|null=null;
  let data=snapshot(await input.fetch());current();
  let pool=publicDirectoryCertificatePool(data.certificates);
  if(data.accountSigningKey===null || data.rootCertificateId===null){
   if(pin || data.accountSigningKey!==null || data.rootCertificateId!==null || data.certificates.length)throw new DirectoryCertificateError();
   const root=await signDirectoryDevice({state:input.state,accountSigningKey:input.state.signingKey,issuerCertificateId:null,sign:input.sign});current();
   verifyDirectoryCertificateChain(root.id,{[root.id]:root},{userId:input.state.userId,pinnedAccountKey:input.state.signingKey});
   anchor=root.body.accountSigningKey;bootstrapRootId=root.id;
   await publishOwn(root);current();
   data=snapshot(await input.fetch());current();pool=publicDirectoryCertificatePool(data.certificates);
  }
  if(!data.rootCertificateId || !data.accountSigningKey)throw new DirectoryCertificateError();
  if(bootstrapRootId && data.rootCertificateId!==bootstrapRootId)throw new DirectoryCertificateError();
  const root=verifyDirectoryCertificateChain(data.rootCertificateId,pool,{userId:input.state.userId,pinnedAccountKey:anchor});
  if(root.issuerCertificateId!==null || root.accountSigningKey!==data.accountSigningKey)throw new DirectoryCertificateError();
  // A server can certify our known public key under an attacker-owned root.
  // Never turn that into an endorsement using our private key automatically.
  const localRoot=canonicalDirectoryCertificateBody({...root,signingKey:input.state.signingKey});
  let trustedRoot=Boolean(anchor) || (localRoot.purpose==='device' && localRoot.signingKey===root.accountSigningKey);
  const proofs=publicDirectoryPossessionProofs(data.possessionProofs,publicDirectoryCertificatePool(data.certificates));
  let certificate:DirectoryCertificate|undefined;
  let renewal:DirectoryCertificate|undefined;
  let possessionSignature:string|undefined;
  for(const packet of [...data.certificates].reverse()){
   if(packet.body?.purpose!=='device' || packet.body.deviceId!==input.state.deviceId)continue;
   const body=verifyDirectoryCertificateChain(packet.id,pool,{userId:input.state.userId,pinnedAccountKey:root.accountSigningKey});
   const matchesOwner=directoryDeviceMatches(body,input.state,false);
   if(matchesOwner && proofs[packet.id]!==undefined){verifyDirectoryCertificatePossession(packet,proofs[packet.id]);trustedRoot=true;}
   if(!certificate && directoryDeviceMatches(body,input.state))certificate=packet;
   if(!renewal && body.canApprove && matchesOwner)renewal=packet;
  }
  if(!trustedRoot)throw new DirectoryIdentityApprovalRequired();
  if(!certificate && renewal){
   certificate=await signDirectoryDevice({state:input.state,accountSigningKey:root.accountSigningKey,
    issuerCertificateId:renewal.id,sign:input.sign});current();
   pool={...pool,[certificate.id]:certificate};
   verifyDirectoryCertificateChain(certificate.id,pool,{userId:input.state.userId,pinnedAccountKey:root.accountSigningKey});
   possessionSignature=await publishOwn(certificate);current();
  }
  if(!certificate)throw new DirectoryIdentityApprovalRequired();
  if(!possessionSignature){
   const existing=proofs[certificate.id];
   possessionSignature=existing===undefined?await publishOwn(certificate):verifyDirectoryCertificatePossession(certificate,existing);
   current();
  }
  if(!pin){current();await input.savePin(root.accountSigningKey);current();}
  return {accountSigningKey:root.accountSigningKey,certificate,certificates:pool,possessionSignature};
 }
 return {ensure:()=>{
  if(!inFlight){const operation=ensure();inFlight=operation;void operation.finally(()=>{if(inFlight===operation)inFlight=null;}).catch(()=>undefined);}
  return inFlight;
 }};
}

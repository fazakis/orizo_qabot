/** Public proofs only. Private identity keys remain owned by the existing Olm/recovery state. */
import {fromByteArray, toByteArray} from 'base64-js';
import {ed25519} from '@noble/curves/ed25519.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex, utf8ToBytes} from '@noble/hashes/utils.js';

export const DIRECTORY_CERTIFICATE_PREFIX = 'orizo-message-directory-certificate-v1\n';
export const DIRECTORY_POSSESSION_PREFIX = 'orizo-message-directory-possession-v1\n';
export const MAX_DIRECTORY_CHAIN_DEPTH = 16;
export const MAX_DIRECTORY_CERTIFICATES = 1536;
const DIGEST = /^[0-9a-f]{64}$/;
const COMMON = ['version','purpose','userId','accountSigningKey','issuerCertificateId','canApprove'];
const DEVICE = ['deviceId','identityKey','signingKey','notificationKeyHash'];
const RECOVERY = ['vaultId','epoch','recoveryPublicKey','approvalSigningKey'];
// Cache only immutable point validity, never account trust or approval rights.
const validSigningPoints=new Set<string>();
type Common = {version:1;userId:number;accountSigningKey:string;issuerCertificateId:string|null;canApprove:boolean};
export type DirectoryCertificateBody = Common & (
  {purpose:'device';deviceId:string;identityKey:string;signingKey:string;notificationKeyHash:string}
  | {purpose:'recovery';vaultId:string;epoch:number;recoveryPublicKey:string;approvalSigningKey:string}
);
export type DirectoryCertificate = {id:string;body:DirectoryCertificateBody;signature:string};
export class DirectoryCertificateError extends Error {
  constructor(){super('Invalid public directory certificate.');}
}
const invalid = ():never => {throw new DirectoryCertificateError();};
function object(value:unknown):Record<string,unknown>{
  if(!value || typeof value!=='object' || Array.isArray(value)) return invalid();
  return value as Record<string,unknown>;
}
function positiveInteger(value:unknown):number {
  if(typeof value!=='number' || !Number.isSafeInteger(value) || value<=0) return invalid();
  return value;
}
function encoded(value:unknown,length:number,empty=false):string {
  if(empty && value==='') return '';
  if(typeof value!=='string' || value.length>256 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return invalid();
  try {
    const normalized=value.replace(/-/g,'+').replace(/_/g,'/').replace(/=+$/,'');
    if(normalized.length%4===1) return invalid();
    const bytes=toByteArray(normalized+'='.repeat((4-normalized.length%4)%4));
    if(bytes.length!==length) return invalid();
    return fromByteArray(bytes);
  } catch {return invalid();}
}
function signingKey(value:unknown):string {
  const key=encoded(value,32);
  if(validSigningPoints.has(key)) return key;
  try {
    const point=ed25519.Point.fromBytes(toByteArray(key),false);
    if(point.isSmallOrder() || !point.isTorsionFree()) return invalid();
    if(validSigningPoints.size>=512)validSigningPoints.delete(validSigningPoints.values().next().value!);
    validSigningPoints.add(key);
    return key;
  } catch {return invalid();}
}
export function canonicalDirectorySigningKey(value:unknown):string {return signingKey(value);}
export function canonicalDirectoryCertificateBody(value:unknown):DirectoryCertificateBody {
  const body=object(value);
  const extras=body.purpose==='device'?DEVICE:body.purpose==='recovery'?RECOVERY:invalid();
  const fields=[...COMMON,...extras].sort();
  if(Object.keys(body).sort().join(',')!==fields.join(',') || body.version!==1 || typeof body.canApprove!=='boolean'
    || (body.issuerCertificateId!==null && (typeof body.issuerCertificateId!=='string' || !DIGEST.test(body.issuerCertificateId)))) return invalid();
  const common:Common={version:1,userId:positiveInteger(body.userId),accountSigningKey:signingKey(body.accountSigningKey),
    issuerCertificateId:body.issuerCertificateId as string|null,canApprove:body.canApprove};
  if(body.purpose==='device'){
    const id=body.deviceId;
    if(typeof id!=='string' || Array.from(id).length<1 || Array.from(id).length>128 || id!==id.trim()
      || !/^[\p{L}\p{M}\p{N}\p{P}\p{S} ]+$/u.test(id)) return invalid();
    return {...common,purpose:'device',deviceId:id,identityKey:encoded(body.identityKey,32),
      signingKey:signingKey(body.signingKey),notificationKeyHash:encoded(body.notificationKeyHash,32)};
  }
  if(typeof body.vaultId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.vaultId)) return invalid();
  return {...common,purpose:'recovery',vaultId:body.vaultId,epoch:positiveInteger(body.epoch),
    recoveryPublicKey:encoded(body.recoveryPublicKey,32),approvalSigningKey:signingKey(body.approvalSigningKey)};
}
export function directoryCertificateAuthorization(value:unknown):string {
  const body=canonicalDirectoryCertificateBody(value);
  const sorted=Object.fromEntries(Object.entries(body).sort(([a],[b])=>a<b?-1:a>b?1:0));
  return DIRECTORY_CERTIFICATE_PREFIX+JSON.stringify(sorted);
}
export function directoryCertificateId(body:unknown):string {
  return bytesToHex(sha256(utf8ToBytes(directoryCertificateAuthorization(body))));
}
/** Normalize transport encodings for exact retries; this does not verify ancestry. */
export function canonicalDirectoryCertificatePacket(value:unknown):DirectoryCertificate {
 const packet=object(value);
 if(Object.keys(packet).sort().join(',')!=='body,id,signature')return invalid();
 const body=canonicalDirectoryCertificateBody(packet.body);
 if(packet.id!==directoryCertificateId(body))return invalid();
 return {id:packet.id as string,body,signature:encoded(packet.signature,64)};
}
export function directoryCertificateSigningKey(body:DirectoryCertificateBody):string {
  return body.purpose==='device'?body.signingKey:body.approvalSigningKey;
}
export function directoryCertificatePossessionAuthorization(identifier:string):string {
 if(typeof identifier!=='string' || !DIGEST.test(identifier))return invalid();
 return DIRECTORY_POSSESSION_PREFIX+identifier;
}
/** Subject possession is separate from ancestry and the caller's root trust decision. */
export function verifyDirectoryCertificatePossession(certificate:unknown,signature:unknown):string {
 const packet=canonicalDirectoryCertificatePacket(certificate),normalized=encoded(signature,64);
 try{
  if(!ed25519.verify(toByteArray(normalized),utf8ToBytes(directoryCertificatePossessionAuthorization(packet.id)),
    toByteArray(directoryCertificateSigningKey(packet.body)),{zip215:false}))return invalid();
 }catch{return invalid();}
 return normalized;
}
/** Missing pins mean explicit TOFU. Persist pins only after the whole directory validates. */
export function verifyDirectoryCertificateChain(identifier:string,certificates:Record<string,unknown>,input:{userId:number;pinnedAccountKey?:string|null}):DirectoryCertificateBody {
  positiveInteger(input.userId);
  const pool=object(certificates);
  if(Object.keys(pool).length>MAX_DIRECTORY_CERTIFICATES) return invalid();
  const pin=input.pinnedAccountKey==null?null:signingKey(input.pinnedAccountKey);
  const visiting=new Set<string>(),verified=new Map<string,DirectoryCertificateBody>();
  function verify(id:string,depth:number):DirectoryCertificateBody {
    if(depth>MAX_DIRECTORY_CHAIN_DEPTH || typeof id!=='string' || !DIGEST.test(id) || visiting.has(id)) return invalid();
    const cached=verified.get(id);if(cached)return cached;
    if(!Object.hasOwn(pool,id)) return invalid();
    const packet=object(pool[id]);
    if(Object.keys(packet).sort().join(',')!=='body,id,signature' || packet.id!==id) return invalid();
    const body=canonicalDirectoryCertificateBody(packet.body);
    if(body.userId!==input.userId || directoryCertificateId(body)!==id || (pin && body.accountSigningKey!==pin)) return invalid();
    visiting.add(id);
    let key:string;
    if(body.issuerCertificateId===null){
      if(body.purpose!=='device' || !body.canApprove || body.signingKey!==body.accountSigningKey) return invalid();
      key=body.accountSigningKey;
    }else{
      const parent=verify(body.issuerCertificateId,depth+1);
      if(!parent.canApprove || parent.accountSigningKey!==body.accountSigningKey) return invalid();
      key=directoryCertificateSigningKey(parent);
    }
    try {
      if(!ed25519.verify(toByteArray(encoded(packet.signature,64)),utf8ToBytes(directoryCertificateAuthorization(body)),toByteArray(key),{zip215:false})) return invalid();
    }catch{return invalid();}
    visiting.delete(id);verified.set(id,body);return body;
  }
  return verify(identifier,1);
}

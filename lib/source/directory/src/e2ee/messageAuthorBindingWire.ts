/** Public header allowlist for ciphertext storage; no native/ratchet initialization. */
import {fromByteArray,toByteArray} from 'base64-js';
import type {DirectoryCertificate} from './directoryCertificates';
export const MESSAGE_AUTHOR_BINDING_VERSION=2;
export const MAX_MESSAGE_AUTHOR_HEADER_BYTES=65_536;
const digest=/^[a-f0-9]{64}$/;
export const authorUuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export const authorDeviceId=(value:unknown):value is string=>typeof value==='string'&&value===value.trim()&&Array.from(value).length>=1&&Array.from(value).length<=128&&/^[\p{L}\p{M}\p{N}\p{P}\p{S} ]+$/u.test(value);
export class MessageAuthorBindingError extends Error {
 readonly code:string;
 constructor(code='message_author_binding_invalid'){super('Encrypted message author could not be verified.');this.name='MessageAuthorBindingError';this.code=code;}
}
export type MessageAuthorBinding={version:2;certificateId:string;certificates:DirectoryCertificate[];signature:string};
const fail=():never=>{throw new MessageAuthorBindingError();};
const record=(value:unknown):Record<string,any>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:fail();
function exact(value:Record<string,any>,keys:string[]){if(Object.keys(value).sort().join(',')!==[...keys].sort().join(','))fail();}
export function authorEncoded(value:unknown,length:number):string{
 if(typeof value!=='string'||value.length>256||!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value))return fail();
 const normalized=value.replace(/-/g,'+').replace(/_/g,'/').replace(/=+$/,'');if(normalized.length%4===1)return fail();
 try{const bytes=toByteArray(normalized+'='.repeat((4-normalized.length%4)%4));if(bytes.length!==length)return fail();return fromByteArray(bytes);}catch{return fail();}
}
const positive=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0?value as number:fail();
const sorted=(value:Record<string,unknown>)=>Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0));
function publicCertificate(value:unknown):DirectoryCertificate{
 const packet=record(value);exact(packet,['id','body','signature']);if(typeof packet.id!=='string'||!digest.test(packet.id))return fail();
 const body=record(packet.body),device=body.purpose==='device';if(!device&&body.purpose!=='recovery')return fail();
 exact(body,['version','purpose','userId','accountSigningKey','issuerCertificateId','canApprove',...(device?['deviceId','identityKey','signingKey','notificationKeyHash']:['vaultId','epoch','recoveryPublicKey','approvalSigningKey'])]);
 if(body.version!==1||typeof body.canApprove!=='boolean'||(body.issuerCertificateId!==null&&(typeof body.issuerCertificateId!=='string'||!digest.test(body.issuerCertificateId))))return fail();
 const common={version:1,purpose:body.purpose,userId:positive(body.userId),accountSigningKey:authorEncoded(body.accountSigningKey,32),issuerCertificateId:body.issuerCertificateId,canApprove:body.canApprove};
 let canonical:Record<string,unknown>;
 if(device){if(!authorDeviceId(body.deviceId))return fail();canonical={...common,deviceId:body.deviceId,identityKey:authorEncoded(body.identityKey,32),signingKey:authorEncoded(body.signingKey,32),notificationKeyHash:authorEncoded(body.notificationKeyHash,32)};}
 else{if(!authorUuid(body.vaultId))return fail();canonical={...common,vaultId:body.vaultId,epoch:positive(body.epoch),recoveryPublicKey:authorEncoded(body.recoveryPublicKey,32),approvalSigningKey:authorEncoded(body.approvalSigningKey,32)};}
 return {id:packet.id,body:sorted(canonical) as DirectoryCertificate['body'],signature:authorEncoded(packet.signature,64)};
}
export function canonicalMessageAuthorBinding(value:unknown):MessageAuthorBinding{
 try{
  const header=record(value);exact(header,['version','certificateId','certificates','signature']);
  if(header.version!==2||typeof header.certificateId!=='string'||!digest.test(header.certificateId)||!Array.isArray(header.certificates)||header.certificates.length<1||header.certificates.length>16)return fail();
  const certificates=header.certificates.map(publicCertificate).sort((a:DirectoryCertificate,b:DirectoryCertificate)=>a.id<b.id?-1:a.id>b.id?1:0);
  if(new Set(certificates.map((packet:DirectoryCertificate)=>packet.id)).size!==certificates.length)return fail();
  const result:MessageAuthorBinding={version:2,certificateId:header.certificateId,certificates,signature:authorEncoded(header.signature,64)};
  const json=JSON.stringify(result);if(json.length>MAX_MESSAGE_AUTHOR_HEADER_BYTES)return fail();
  let bytes=0;for(const point of json){const code=point.codePointAt(0)!;bytes+=code<128?1:code<2048?2:code<65536?3:4;}
  if(bytes>MAX_MESSAGE_AUTHOR_HEADER_BYTES)return fail();return result;
 }catch{return fail();}
}
export function messageAuthorBindingFromRaw(raw:any):MessageAuthorBinding|null{
 const camel=raw.senderBinding,snake=raw.sender_binding;
 const value=camel??snake;if(value===undefined||value===null)return null;
 const canonical=canonicalMessageAuthorBinding(value);
 if(camel!=null&&snake!=null&&JSON.stringify(canonical)!==JSON.stringify(canonicalMessageAuthorBinding(snake)))return fail();
 return canonical;
}

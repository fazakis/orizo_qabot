/** Author/body binding on the existing public directory and device signing key. */
import {ed25519} from '@noble/curves/ed25519.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js';
import {toByteArray} from 'base64-js';
import {verifyDirectoryCertificateChain,type DirectoryCertificate} from './directoryCertificates';
import type {EnrolledDirectoryIdentity} from './directoryIdentity';
import {authorDeviceId,authorUuid,authorEncoded,canonicalMessageAuthorBinding,MessageAuthorBindingError,type MessageAuthorBinding} from './messageAuthorBindingWire';
export {MessageAuthorBindingError} from './messageAuthorBindingWire';
export type {MessageAuthorBinding} from './messageAuthorBindingWire';
const BODY_PREFIX='orizo-message-author-v2\n',SIGNATURE_PREFIX='orizo-message-author-signature-v2\n';
export type MessageAuthorContext={conversationId:string;clientMessageId:string;senderUserId:number;senderDeviceId:string;senderSessionGeneration:number;eventType:string};
const fail=():never=>{throw new MessageAuthorBindingError();};
export function messageAuthorContextFromRaw(raw:any):MessageAuthorContext{
 return {conversationId:String(raw.conversation||raw.conversationId||raw.conversation_id||''),clientMessageId:String(raw.clientMessageId||raw.client_message_id||''),
  senderUserId:Number(raw.sender?.id||0),senderDeviceId:String(raw.senderDeviceId||raw.sender_device_id||''),
  senderSessionGeneration:Number(raw.senderSessionGeneration??raw.sender_session_generation??0),eventType:String(raw.eventType||raw.event_type||'message')};
}
export function messageAuthorBodyContext(context:MessageAuthorContext,certificateId:string):string{
 const c=context;
 if(!authorUuid(c.conversationId)||!authorUuid(c.clientMessageId)||!Number.isSafeInteger(c.senderUserId)||c.senderUserId<=0||!authorDeviceId(c.senderDeviceId)
  ||!Number.isSafeInteger(c.senderSessionGeneration)||c.senderSessionGeneration<0||!['message','reaction','edit','delete','call'].includes(c.eventType)||typeof certificateId!=='string'||!/^[a-f0-9]{64}$/.test(certificateId))return fail();
 return BODY_PREFIX+JSON.stringify([2,c.conversationId,c.clientMessageId,c.senderUserId,c.senderDeviceId,c.senderSessionGeneration,c.eventType,certificateId]);
}
export function messageAuthorSignatureAuthorization(bodyContext:string,cipherNonce:string,ciphertext:string):string{
 if(typeof bodyContext!=='string'||!bodyContext.startsWith(BODY_PREFIX)||typeof ciphertext!=='string'||!ciphertext||ciphertext.length>2_000_000||authorEncoded(cipherNonce,24)!==cipherNonce)return fail();
 return SIGNATURE_PREFIX+JSON.stringify([bodyContext,cipherNonce,bytesToHex(sha256(utf8ToBytes(ciphertext)))]);
}
type VerifySignature=(key:string,message:string,signature:string)=>Promise<void>;
export async function verifyMessageAuthorBinding(input:{binding:unknown;context:MessageAuthorContext;cipherNonce:string;ciphertext:string;pinnedAccountKey?:string|null;verify?:VerifySignature}){
 try{
  const binding=canonicalMessageAuthorBinding(input.binding),pool=Object.fromEntries(binding.certificates.map(packet=>[packet.id,packet]));
  const bodyContext=messageAuthorBodyContext(input.context,binding.certificateId);
  const leaf=verifyDirectoryCertificateChain(binding.certificateId,pool,{userId:input.context.senderUserId,pinnedAccountKey:input.pinnedAccountKey});
  if(leaf.purpose!=='device'||leaf.deviceId!==input.context.senderDeviceId)return fail();
  const seen=new Set<string>();let current:string|null=binding.certificateId;
  while(current!==null){if(seen.has(current)||!pool[current])return fail();seen.add(current);current=pool[current].body.issuerCertificateId;}
  if(seen.size!==binding.certificates.length)return fail();
  const authorization=messageAuthorSignatureAuthorization(bodyContext,input.cipherNonce,input.ciphertext);
  if(input.verify)await input.verify(leaf.signingKey,authorization,binding.signature);
  else if(!ed25519.verify(toByteArray(binding.signature),utf8ToBytes(authorization),toByteArray(leaf.signingKey),{zip215:false}))return fail();
  return {binding,bodyContext,leaf,accountSigningKey:leaf.accountSigningKey};
 }catch{return fail();}
}
export async function createMessageAuthorBinding(input:{identity:EnrolledDirectoryIdentity;context:MessageAuthorContext;cipherNonce:string;ciphertext:string;sign:(authorization:string)=>Promise<string>}):Promise<MessageAuthorBinding>{
 const certificateId=input.identity.certificate.id,certificates:DirectoryCertificate[]=[],seen=new Set<string>();let current:string|null=certificateId;
 while(current!==null){
  const packet:DirectoryCertificate|undefined=current===certificateId?input.identity.certificate:input.identity.certificates[current];
  if(!packet||seen.has(current)||certificates.length>=16)return fail();seen.add(current);certificates.push(packet);current=packet.body.issuerCertificateId;
 }
 const bodyContext=messageAuthorBodyContext(input.context,certificateId);
 const signature=await input.sign(messageAuthorSignatureAuthorization(bodyContext,input.cipherNonce,input.ciphertext));
 const verified=await verifyMessageAuthorBinding({binding:{version:2,certificateId,certificates,signature},context:input.context,
  cipherNonce:input.cipherNonce,ciphertext:input.ciphertext,pinnedAccountKey:input.identity.accountSigningKey});
 return verified.binding;
}

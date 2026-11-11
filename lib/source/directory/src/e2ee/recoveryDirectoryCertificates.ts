/** Public recovery authority, verified against independently unlocked vault keys. */
import {
 canonicalDirectoryCertificateBody,canonicalDirectoryCertificatePacket,canonicalDirectorySigningKey,directoryCertificateAuthorization,directoryCertificateId,
 directoryCertificatePossessionAuthorization,verifyDirectoryCertificateChain,verifyDirectoryCertificatePossession,
 DirectoryCertificateError,type DirectoryCertificate,
} from './directoryCertificates';
import {DirectoryIdentityApprovalRequired,publicDirectoryCertificatePool,publicDirectoryPossessionProofs} from './directoryIdentity';
import {fromByteArray,toByteArray} from 'base64-js';
import {ed25519,x25519} from '@noble/curves/ed25519.js';

export type PublicRecoveryDirectoryVault={vaultId:string;epoch:number;recoveryPublicKey:string;approvalSigningKey:string};
export function requireRecoveryDirectorySupport(value:unknown):void{
 if(!value || typeof value!=='object' || (value as any).version!==1
  || (value as any).recoveryCertificatesVersion!==1 || !Number.isSafeInteger((value as any).certificateBatchLimit)
  || (value as any).certificateBatchLimit<2)throw new DirectoryCertificateError();
}
export function requireRecoveryDirectoryAcknowledgement(data:any,certificate:DirectoryCertificate):void{
 if((data?.directoryProofVersion ?? data?.directory_proof_version)!==1
   || (data?.directoryCertificateId ?? data?.directory_certificate_id)!==certificate.id)throw new DirectoryCertificateError();
}
export function requireRecoveryDirectoryRecord(record:PublicRecoveryDirectoryVault,certificate:DirectoryCertificate):void{
 const body=certificate.body;
 if(body.purpose!=='recovery' || body.vaultId!==record.vaultId || body.epoch!==record.epoch
  || body.recoveryPublicKey!==record.recoveryPublicKey || body.approvalSigningKey!==record.approvalSigningKey)throw new DirectoryCertificateError();
}
const unlockedVault=Symbol('validated recovery directory vault');
export type UnlockedRecoveryDirectoryVault=Readonly<PublicRecoveryDirectoryVault> & {readonly [unlockedVault]:true};
function bytes32(value:unknown):Uint8Array{
 if(typeof value!=='string' || value.length>256 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value))throw new DirectoryCertificateError();
 const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
 try{const bytes=toByteArray(normalized+'='.repeat((4-normalized.length%4)%4));if(bytes.length!==32)throw new DirectoryCertificateError();return bytes;}
 catch{throw new DirectoryCertificateError();}
}
/** Construct authority only from a bundle already unlocked by the existing vault owner. */
export function recoveryDirectoryVaultFromUnlocked(record:PublicRecoveryDirectoryVault,bundle:{
 approvalSigningSeed?:string;keys:{publicKey:string;privateKey:string}[];
}):UnlockedRecoveryDirectoryVault{
 if(!record || typeof record!=='object' || !bundle || typeof bundle!=='object'
   || typeof record.vaultId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(record.vaultId)
   || !Number.isSafeInteger(record.epoch) || record.epoch<=0 || !Array.isArray(bundle.keys) || !bundle.keys.length || bundle.keys.length>32)throw new DirectoryCertificateError();
 const recoveryPublicKey=fromByteArray(bytes32(record.recoveryPublicKey));
 const approvalSigningKey=canonicalDirectorySigningKey(record.approvalSigningKey);
 const key=bundle.keys.find(candidate=>{
  if(!candidate || typeof candidate!=='object')throw new DirectoryCertificateError();
  return fromByteArray(bytes32(candidate.publicKey))===recoveryPublicKey;
 });
 if(!key)throw new DirectoryCertificateError();
 const privateKey=bytes32(key.privateKey);let approvalSeed:Uint8Array|undefined;
 try{
  approvalSeed=bytes32(bundle.approvalSigningSeed);
  if(fromByteArray(x25519.getPublicKey(privateKey))!==recoveryPublicKey || fromByteArray(ed25519.getPublicKey(approvalSeed))!==approvalSigningKey)throw new DirectoryCertificateError();
 }finally{privateKey.fill(0);approvalSeed?.fill(0);}
 const result={vaultId:record.vaultId,epoch:record.epoch,recoveryPublicKey,approvalSigningKey};
 Object.defineProperty(result,unlockedVault,{value:true,enumerable:false,writable:false});
 return Object.freeze(result) as UnlockedRecoveryDirectoryVault;
}
function requireUnlocked(vault:UnlockedRecoveryDirectoryVault){if(vault?.[unlockedVault]!==true)throw new DirectoryCertificateError();}
export async function signRecoveryDirectoryCertificate(input:{
 userId:number;vault:UnlockedRecoveryDirectoryVault;accountSigningKey:string;issuerCertificateId:string;
 signIssuer:(authorization:string)=>Promise<string>;signRecovery:(authorization:string)=>Promise<string>;
}):Promise<{certificate:DirectoryCertificate;possessionSignature:string}>{
 requireUnlocked(input.vault);
 const body=canonicalDirectoryCertificateBody({version:1,purpose:'recovery',userId:input.userId,
  accountSigningKey:input.accountSigningKey,issuerCertificateId:input.issuerCertificateId,canApprove:true,
  vaultId:input.vault.vaultId,epoch:input.vault.epoch,recoveryPublicKey:input.vault.recoveryPublicKey,approvalSigningKey:input.vault.approvalSigningKey});
 const certificate=canonicalDirectoryCertificatePacket({id:directoryCertificateId(body),body,
  signature:await input.signIssuer(directoryCertificateAuthorization(body))});
 const possessionSignature=verifyDirectoryCertificatePossession(certificate,
  await input.signRecovery(directoryCertificatePossessionAuthorization(certificate.id)));
 return {certificate,possessionSignature};
}

/** The vault public keys here MUST come from a validated unlocked private bundle.
 * A server record or its claimed creator signature is not that independent key.
 * No missing endorsement is synthesized while authenticating an unknown root.
 */
export function authenticateRecoveryDirectoryAuthority(input:{
 data:unknown;userId:number;vault:UnlockedRecoveryDirectoryVault;pinnedAccountKey:string|null;
}):{accountSigningKey:string;certificate:DirectoryCertificate;certificates:Record<string,DirectoryCertificate>;possessionSignature:string|null}|null{
 requireUnlocked(input.vault);
 if(!input.data || typeof input.data!=='object')throw new DirectoryCertificateError();
 const data=input.data as Record<string,unknown>;
 if(data.version!==1 || data.recoveryCertificatesVersion!==1)throw new DirectoryCertificateError();
 const certificates=publicDirectoryCertificatePool(data.certificates);
 const proofs=publicDirectoryPossessionProofs(data.possessionProofs,certificates);
 if(data.accountSigningKey===null && data.rootCertificateId===null){
  if(input.pinnedAccountKey!==null || Object.keys(certificates).length || Object.keys(proofs).length)throw new DirectoryCertificateError();
  return null;
 }
 if(typeof data.rootCertificateId!=='string' || typeof data.accountSigningKey!=='string')throw new DirectoryCertificateError();
 const root=verifyDirectoryCertificateChain(data.rootCertificateId,certificates,{userId:input.userId,pinnedAccountKey:input.pinnedAccountKey});
 if(root.issuerCertificateId!==null || root.accountSigningKey!==data.accountSigningKey)throw new DirectoryCertificateError();
 for(const certificate of Object.values(certificates).reverse()){
  if(certificate.body?.purpose!=='recovery' || certificate.body.vaultId!==input.vault.vaultId)continue;
  const body=verifyDirectoryCertificateChain(certificate.id,certificates,{userId:input.userId,pinnedAccountKey:root.accountSigningKey});
  if(body.purpose!=='recovery')throw new DirectoryCertificateError();
  const expected=canonicalDirectoryCertificateBody({...body,userId:input.userId,vaultId:input.vault.vaultId,
   epoch:input.vault.epoch,recoveryPublicKey:input.vault.recoveryPublicKey,approvalSigningKey:input.vault.approvalSigningKey});
  if(expected.purpose!=='recovery' || body.userId!==expected.userId || body.epoch!==expected.epoch
    || body.recoveryPublicKey!==expected.recoveryPublicKey || body.approvalSigningKey!==expected.approvalSigningKey || !body.canApprove)continue;
  const proof=proofs[certificate.id];
  if(proof===undefined && input.pinnedAccountKey===null)throw new DirectoryIdentityApprovalRequired();
  return {accountSigningKey:root.accountSigningKey,certificate,certificates,
   possessionSignature:proof===undefined?null:verifyDirectoryCertificatePossession(certificate,proof)};
 }
 throw new DirectoryIdentityApprovalRequired();
}

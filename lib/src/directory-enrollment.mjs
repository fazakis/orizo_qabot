// Public certificate migration only. Call inside the existing exclusive crypto owner.
// No device registration, vault creation, message sends or identity replacement.
import * as directory from '../vendor/directory.mjs';
import {b64, bytes} from './crypto.mjs';
import {x25519, signMessageRecoveryDeviceApproval} from '../vendor/crypto.mjs';

const certificatesPath = '/api/messages/e2ee/directory-certificates/';
const headsPath = '/api/messages/e2ee/directory-heads/';
export async function enrollExistingDirectory(crypto) {
  const {api, state, engine, userId, recovery} = crypto;
  if (!state?.pickle || !recovery?.record || !recovery?.unlocked?.bundle)
    throw new Error('Existing device and unlocked recovery vault required');
  const vault = directory.recoveryDirectoryVaultFromUnlocked({...recovery.record,vaultId:recovery.record.vaultId??recovery.record.id}, recovery.unlocked.bundle);
  const local = {userId, deviceId:state.deviceId, identityKey:engine.identityKey, signingKey:engine.signingKey,
    notificationPublicKey:b64(x25519.getPublicKey(bytes(state.notificationKey)))};
  const sign = text => engine.sign(text);
  const bridge = (accountSigningKey, issuerCertificateId) => directory.signRecoveryDirectoryCertificate({
    userId, vault, accountSigningKey, issuerCertificateId, signIssuer:sign,
    signRecovery:async text => signMessageRecoveryDeviceApproval(recovery.unlocked.bundle,text),
  });
  const fetchManifest = async () => {
    const value = await api.request(certificatesPath);
    directory.requireRecoveryDirectorySupport(value);
    return value;
  };
  const enrollment = directory.createDirectoryIdentityEnrollment({state:local, assertCurrent:()=>{},
    readPin:async()=>state.directoryTrust?.accountSigningKey ?? null,
    savePin:async key=>{state.directoryTrust={...state.directoryTrust,accountSigningKey:key};await crypto.persist();},
    fetch:fetchManifest, sign,
    publish:async(certificate,possessionSignature)=>{
      // Vault-protected legacy accounts must establish root + vault atomically.
      if(certificate.body.issuerCertificateId===null && (await fetchManifest()).rootCertificateId===null){
        const recoveryBridge=await bridge(certificate.body.accountSigningKey,certificate.id);
        const response=await api.request(certificatesPath,{method:'POST',body:{certificates:[{certificate,possessionSignature},recoveryBridge]}});
        if(response?.batchVersion!==1)throw new Error('Directory batch acknowledgement missing');
        return response;
      }
      return api.request(certificatesPath,{method:'POST',body:{certificate,possessionSignature}});
    },
  });
  const own = await enrollment.ensure();
  let manifest = await fetchManifest();
  let authority;
  try { authority=directory.authenticateRecoveryDirectoryAuthority({data:manifest,userId,vault,pinnedAccountKey:own.accountSigningKey}); }
  catch(error) {
    if(!(error instanceof directory.DirectoryIdentityApprovalRequired))throw error;
    const packet=await bridge(own.accountSigningKey,own.certificate.id);
    await api.request(certificatesPath,{method:'POST',body:packet});
    manifest=await fetchManifest();
    authority=directory.authenticateRecoveryDirectoryAuthority({data:manifest,userId,vault,pinnedAccountKey:own.accountSigningKey});
  }
  if(!authority?.possessionSignature)throw new Error('Recovery endorsement missing');
  const pool=directory.publicDirectoryCertificatePool(manifest.certificates);
  const snapshot=await api.request(headsPath);
  if(snapshot?.version!==1 || !Object.hasOwn(snapshot,'head'))throw new Error('Directory head protocol unavailable');
  const previous=snapshot.head===null?null:directory.verifyDirectoryHead(snapshot.head,pool,{userId,accountSigningKey:own.accountSigningKey});
  const priorPin=state.directoryTrust?.headPin;
  if(priorPin && !previous)throw new Error('Directory head downgrade');
  if(previous)directory.advanceDirectoryHeadPin(previous,priorPin??null);
  const required=[own.certificate.id,authority.certificate.id];
  if(required.some(id=>previous?.body.revokedCertificateIds.includes(id)))throw new Error('Directory identity was revoked');
  // Preserve every prior approval/revocation; add only the two locally held subjects.
  let head=previous;
  if(!previous || required.some(id=>!previous.body.activeCertificateIds.includes(id))){
    const body=directory.nextDirectoryHeadBody({previous,userId,accountSigningKey:own.accountSigningKey,
      issuerCertificateId:own.certificate.id,active:[...(previous?.body.activeCertificateIds??[]),...required]});
    head={id:directory.directoryHeadId(body),body,signature:await sign(directory.directoryHeadAuthorization(body))};
    directory.verifyDirectoryHead(head,pool,{userId,accountSigningKey:own.accountSigningKey});
    await api.request(headsPath,{method:'POST',body:{head}});
  }
  const readback=await api.request(headsPath);
  const confirmed=directory.verifyDirectoryHead(readback?.head,pool,{userId,accountSigningKey:own.accountSigningKey});
  if(confirmed.id!==head.id || required.some(id=>!directory.headAllows(confirmed,id)))throw new Error('Directory head read-back mismatch');
  state.directoryTrust={accountSigningKey:own.accountSigningKey,headPin:directory.advanceDirectoryHeadPin(confirmed,priorPin??null)};
  await crypto.persist();
  crypto.directoryIdentity = own;
  return {certified:true,deviceCertified:true,recoveryCertified:true,headEpoch:confirmed.body.epoch};
}

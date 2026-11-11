import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {OrizoCrypto} from '../src/crypto.mjs';
import {enrollExistingDirectory} from '../src/directory-enrollment.mjs';
import {x25519,addMessageRecoveryApprovalKey} from '../vendor/crypto.mjs';
import {verifyDirectoryCertificatePossession} from '../vendor/directory.mjs';

test('source-complete SDK enrolls existing device and recovery keys atomically, then reuses them',async t=>{
 const data={account:{userId:101}},vault={get:async k=>structuredClone(data[k]??null),put:async(k,v)=>{data[k]=structuredClone(v);}};
 const manifest={version:1,recoveryCertificatesVersion:1,certificateBatchLimit:10,accountSigningKey:null,rootCertificateId:null,certificates:[],possessionProofs:[]};
 let head=null,posts=0;
 const api={async request(path,{method,body}={}){
  if(path.endsWith('/directory-certificates/')) {
   if(method==='POST') {
    posts++;
    for(const packet of body.certificates??[body]) {
     const {certificate,possessionSignature}=packet;
     verifyDirectoryCertificatePossession(certificate,possessionSignature);
     manifest.certificates.push(certificate);
     manifest.possessionProofs.push({certificateId:certificate.id,signature:possessionSignature});
     if(certificate.body.issuerCertificateId===null){manifest.rootCertificateId=certificate.id;manifest.accountSigningKey=certificate.body.accountSigningKey;}
    }
    return {batchVersion:1};
   }
   return structuredClone(manifest);
  }
  if(path.endsWith('/directory-heads/')) {
   if(method==='POST'){posts++;head=structuredClone(body.head);}
   return {version:1,head:structuredClone(head)};
  }
  throw Error('Unexpected fixture API request');
 }};
 const crypto=new OrizoCrypto(vault,api);await crypto.initialize();t.after(()=>crypto.close());
 const originalId=crypto.state.deviceId,originalIdentity=crypto.engine.identityKey;
 const key=randomBytes(32),publicKey=Buffer.from(x25519.getPublicKey(key)).toString('base64');
 const {bundle,approvalSigningKey}=addMessageRecoveryApprovalKey({keys:[{publicKey,privateKey:key.toString('base64')}]});
 crypto.recovery={record:{vaultId:randomUUID(),epoch:1,recoveryPublicKey:publicKey,approvalSigningKey},unlocked:{bundle}};
 const result=await enrollExistingDirectory(crypto);
 assert.equal(result.recoveryCertified,true);assert.equal(result.deviceCertified,true);
 assert.equal(manifest.certificates.length,2);assert.equal(posts,2);
 assert.equal(crypto.state.deviceId,originalId);assert.equal(crypto.engine.identityKey,originalIdentity);
 const previousHead=head.id;
 await enrollExistingDirectory(crypto);
 assert.equal(posts,2);assert.equal(head.id,previousHead);
});

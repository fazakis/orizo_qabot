import {sha256} from '@noble/hashes/sha2.js';
import {utf8ToBytes} from '@noble/hashes/utils.js';
import {recoverySafetyFingerprint, type RecoveryVaultRecipient} from './messageRecoveryCrypto';

type DirectoryDevice = {userId:number;deviceId:string;identityKey:string;signingKey:string;notificationPublicKey:string;isCurrentDevice:boolean};
export type DirectorySnapshot = {devices:DirectoryDevice[];recoveryVaults:RecoveryVaultRecipient[]};
/** Keep existing verified safety codes valid while enforcing them at send time. */
export function conversationDirectoryFingerprint(conversationId:string, targets:DirectorySnapshot):string {
  const devices=targets.devices.map(device=>`${device.userId}:${device.deviceId}:${device.identityKey}:${device.signingKey}`).sort().join('|');
  const recovery=recoverySafetyFingerprint(targets.recoveryVaults);
  return Array.from(sha256(utf8ToBytes(`orizo-e2ee-safety-v2:${conversationId}:${devices}:${recovery}`)),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export class DirectoryTrustError extends Error {
  readonly code='message_directory_changed';
  constructor(){super('This conversation’s safety code changed. Compare and verify it again before sending.');}
}

export function assertConversationDirectory(input:{
  conversationId:string;targets:DirectorySnapshot;verifiedFingerprint:string|null;
  current:{userId:number;deviceId:string;identityKey:string;signingKey:string;notificationPublicKey:string};
}) {
  const {targets,current}=input;
  if (!targets.devices.length || targets.devices.length>64 || targets.recoveryVaults.length>32) throw new DirectoryTrustError();
  const ids=new Set<string>();
  for(const device of targets.devices){
    if(!Number.isSafeInteger(device.userId)||device.userId<=0||!device.deviceId||!device.identityKey||!device.signingKey||ids.has(device.deviceId)) throw new DirectoryTrustError();
    ids.add(device.deviceId);
    if(device.isCurrentDevice && (device.userId!==current.userId || device.deviceId!==current.deviceId)) throw new DirectoryTrustError();
  }
  const own=targets.devices.find(device=>device.deviceId===current.deviceId);
  if(!own?.isCurrentDevice || own.userId!==current.userId || own.identityKey!==current.identityKey
    || own.signingKey!==current.signingKey || own.notificationPublicKey!==current.notificationPublicKey) throw new DirectoryTrustError();
  const users=new Set<number>();
  for(const vault of targets.recoveryVaults){
    if(!Number.isSafeInteger(vault.userId)||vault.userId<=0||!Number.isSafeInteger(vault.epoch)||vault.epoch<=0||!vault.recoveryPublicKey||users.has(vault.userId)) throw new DirectoryTrustError();
    users.add(vault.userId);
  }
  const fingerprint=conversationDirectoryFingerprint(input.conversationId,targets);
  if(input.verifiedFingerprint && input.verifiedFingerprint!==fingerprint) throw new DirectoryTrustError();
  return fingerprint;
}

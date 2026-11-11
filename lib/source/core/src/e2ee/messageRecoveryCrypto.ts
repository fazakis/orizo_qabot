import { fromByteArray, toByteArray } from 'base64-js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { messageSecureRandomBytes as randomBytes } from './messageSecureRandom';

import {
  deriveMessageRecoveryPassphraseKey,
  MESSAGE_RECOVERY_ARGON2ID_PROFILE,
} from './messageRecoveryPasswordKdf';
import {
  normalizeRecoveryPassphrase,
  validateNewRecoveryPassphraseBounds,
} from './messageRecoveryPasswordPolicy';

export const MESSAGE_RECOVERY_SUITE = 'x25519_xchacha20poly1305_v1' as const;
export const MESSAGE_RECOVERY_ENVELOPE_SCHEME = 'sealed_x25519_xchacha_v1' as const;
export const STRONG_PASSPHRASE_KIND = 'strong_passphrase_v1' as const;
export const RECOVERY_CODE_KIND = 'recovery_code_v1' as const;

const PASSPHRASE_KDF = Object.freeze({
  algorithm: 'argon2id_v1' as const,
  memoryKiB: MESSAGE_RECOVERY_ARGON2ID_PROFILE.memoryKiB,
  iterations: MESSAGE_RECOVERY_ARGON2ID_PROFILE.iterations,
  parallelism: MESSAGE_RECOVERY_ARGON2ID_PROFILE.parallelism,
  length: MESSAGE_RECOVERY_ARGON2ID_PROFILE.length,
});

export type MessageRecoveryCredentialKind =
  | typeof STRONG_PASSPHRASE_KIND
  | typeof RECOVERY_CODE_KIND;

export type MessageRecoveryCredential = {
  kind: MessageRecoveryCredentialKind;
  kdfAlgorithm: 'argon2id_v1' | 'hkdf_sha256_v1';
  kdfSalt: string;
  kdfParams: Record<string, number>;
  wrappedVaultKey: string;
  wrapNonce: string;
};

export type MessageRecoveryVaultKey = {
  publicKey: string;
  privateKey: string;
  createdAt: string;
};

export type MessageRecoveryVaultBundle = {
  version: 1;
  keys: MessageRecoveryVaultKey[];
  approvalSigningSeed: string;
};

export type MessageRecoveryVaultRecord = {
  vaultId: string;
  epoch: number;
  revision: number;
  suite: typeof MESSAGE_RECOVERY_SUITE;
  approvalSigningKey: string;
  recoveryPublicKey: string;
  encryptedPrivateKey: string;
  privateKeyNonce: string;
  credentials: MessageRecoveryCredential[];
  creatorDeviceId?: string;
  creatorSigningKey?: string;
  creatorSignature?: string;
  creatorAuthorization?: string;
  previousVaultId?: string;
  previousApprovalSigningKey?: string;
  transitionSignature?: string;
  transitionAuthorization?: string;
  transitionChain?: MessageRecoveryTransition[];
  reanchorRequired?: boolean;
};

export type MessageRecoveryAuthorizationAction = 'setup' | 'update' | 'reset' | 'reset_retire';

export type MessageRecoveryAuthorizationPayload = Pick<
  MessageRecoveryVaultRecord,
  'suite' | 'approvalSigningKey' | 'recoveryPublicKey' | 'encryptedPrivateKey' | 'privateKeyNonce' | 'credentials'
>;

export type MessageRecoveryTransition = {
  vaultId: string;
  epoch: number;
  approvalSigningKey: string;
  previousVaultId: string;
  previousApprovalSigningKey: string;
  transitionAuthorization: string;
  transitionSignature: string;
  canonicalPayload: MessageRecoveryAuthorizationPayload;
};

export class MessageRecoveryTransitionVerificationError extends Error {
  code: 'message_recovery_transition_invalid' | 'message_recovery_reanchor_required';

  constructor(
    message: string,
    code: 'message_recovery_transition_invalid' | 'message_recovery_reanchor_required',
  ) {
    super(message);
    this.name = 'MessageRecoveryTransitionVerificationError';
    this.code = code;
  }
}

export type MessageRecoveryUnlockedVault = {
  vaultKey: string;
  bundle: MessageRecoveryVaultBundle;
};

export type MessageRecoveryEnvelope = {
  userId: number;
  vaultEpoch: number;
  scheme: typeof MESSAGE_RECOVERY_ENVELOPE_SCHEME;
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
};

export type RecoveryVaultRecipient = {
  userId: number;
  epoch: number;
  suite: typeof MESSAGE_RECOVERY_SUITE;
  recoveryPublicKey: string;
};

const base64 = (value: Uint8Array) => fromByteArray(value);
const unbase64 = (value: string) => toByteArray(value);
const unbase64Length = (value: string, length: number, label: string) => {
  const decoded = unbase64(value);
  if (decoded.length !== length) throw new Error(`${label} is invalid.`);
  return decoded;
};
const utf8 = (value: string) => utf8ToBytes(value);
const decodeUtf8 = (value: Uint8Array) => {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(value);
  return decodeURIComponent(Array.from(value, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''));
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export const messageRecoveryAuthorization = ({
  action,
  userId,
  currentVaultId,
  currentRevision,
  payload,
  targetDeviceId,
  operationId,
}: {
  action: MessageRecoveryAuthorizationAction;
  userId: number;
  currentVaultId: string | null;
  currentRevision: number;
  payload: MessageRecoveryAuthorizationPayload;
  targetDeviceId?: string;
  operationId?: string;
}) => {
  const canonicalPayload = {
    approvalSigningKey: payload.approvalSigningKey,
    credentials: payload.credentials
      .map((credential) => ({
        kdfAlgorithm: credential.kdfAlgorithm,
        kdfParams: credential.kdfParams,
        kdfSalt: credential.kdfSalt,
        kind: credential.kind,
        wrapNonce: credential.wrapNonce,
        wrappedVaultKey: credential.wrappedVaultKey,
      }))
      .sort((left, right) => left.kind.localeCompare(right.kind)),
    encryptedPrivateKey: payload.encryptedPrivateKey,
    privateKeyNonce: payload.privateKeyNonce,
    recoveryPublicKey: payload.recoveryPublicKey,
    suite: payload.suite,
  };
  const digest = Array.from(
    sha256(utf8(canonicalJson(canonicalPayload))),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  const base = `orizo-message-recovery-identity-v1:${action}:${userId}:${currentVaultId || 'none'}:${currentRevision}:${digest}`;
  return action === 'reset_retire'
    ? `${base}:${targetDeviceId || ''}:${String(operationId || '').toLowerCase()}`
    : base;
};

const seal = (key: Uint8Array, value: Uint8Array, aad: string) => {
  const nonce = randomBytes(24);
  return {
    nonce: base64(nonce),
    ciphertext: base64(xchacha20poly1305(key, nonce, utf8(aad)).encrypt(value)),
  };
};

const open = (key: Uint8Array, nonce: string, ciphertext: string, aad: string) =>
  xchacha20poly1305(key, unbase64(nonce), utf8(aad)).decrypt(unbase64(ciphertext));

const privateBundleAad = (userId: number, publicKey: string) =>
  `orizo-message-recovery-private-v1:${userId}:${publicKey}`;

const credentialAad = (
  userId: number,
  publicKey: string,
  kind: MessageRecoveryCredentialKind,
  salt: Uint8Array,
) => `orizo-message-recovery-credential-v1:${userId}:${publicKey}:${kind}:${base64(salt)}:${kind === STRONG_PASSPHRASE_KIND ? `${PASSPHRASE_KDF.memoryKiB}:${PASSPHRASE_KDF.iterations}:${PASSPHRASE_KDF.parallelism}:${PASSPHRASE_KDF.length}` : '32'}`;

const envelopeAad = (
  conversationId: string,
  clientMessageId: string,
  userId: number,
  vaultEpoch: number,
) => `orizo-message-recovery-envelope-v1:${conversationId}:${clientMessageId}:${userId}:${vaultEpoch}`;

export const normalizeRecoveryCode = (value: string) =>
  value.toUpperCase().replace(/[^0-9A-F]/g, '');

export const validateRecoveryCode = (value: string) => {
  const normalized = normalizeRecoveryCode(value);
  if (normalized.length !== 48) throw new Error('Recovery code must contain exactly 48 hexadecimal characters.');
  return normalized;
};

export const generateRecoveryCode = () => {
  const value = Array.from(randomBytes(24), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return (value.match(/.{1,4}/g) || [value]).join('-');
};

/** Structural setup bounds; interactive entry points add the zxcvbn gate. */
export const validateRecoveryPassphrase = validateNewRecoveryPassphraseBounds;

const transitionAuthorizationParts = (authorization: string) => {
  const parts = String(authorization).split(':');
  const action = parts[1] as MessageRecoveryAuthorizationAction;
  const expectedLength = action === 'reset_retire' ? 8 : 6;
  if (
    parts[0] !== 'orizo-message-recovery-identity-v1'
    || !['reset', 'reset_retire'].includes(action)
    || parts.length !== expectedLength
  ) return null;
  const userId = Number(parts[2]);
  const currentRevision = Number(parts[4]);
  if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(currentRevision) || currentRevision < 0) return null;
  return {
    action,
    userId,
    currentVaultId: parts[3] === 'none' ? null : parts[3],
    currentRevision,
    targetDeviceId: action === 'reset_retire' ? parts[6] : undefined,
    operationId: action === 'reset_retire' ? parts[7] : undefined,
  };
};

/** Verify a bounded server transition chain from a locally pinned vault. */
export const verifyMessageRecoveryTransitionChain = ({
  userId,
  pinnedVaultId,
  pinnedEpoch,
  pinnedApprovalSigningKey,
  activeVaultId,
  activeEpoch,
  activeApprovalSigningKey,
  transitionChain,
}: {
  userId: number;
  pinnedVaultId: string;
  pinnedEpoch: number;
  pinnedApprovalSigningKey: string;
  activeVaultId: string;
  activeEpoch: number;
  activeApprovalSigningKey: string;
  transitionChain: MessageRecoveryTransition[];
}) => {
  if (!pinnedVaultId || !pinnedApprovalSigningKey || !activeVaultId || !activeApprovalSigningKey) {
    throw new MessageRecoveryTransitionVerificationError(
      'Encrypted recovery transition data is incomplete.',
      'message_recovery_transition_invalid',
    );
  }
  if (!Array.isArray(transitionChain) || transitionChain.length === 0 || transitionChain.length > 32) {
    throw new MessageRecoveryTransitionVerificationError(
      'Encrypted recovery history is no longer available from the pinned identity.',
      'message_recovery_reanchor_required',
    );
  }
  const start = transitionChain.findIndex((step) => (
    step.previousVaultId === pinnedVaultId
    && step.previousApprovalSigningKey === pinnedApprovalSigningKey
    && step.epoch > pinnedEpoch
  ));
  if (start < 0) {
    throw new MessageRecoveryTransitionVerificationError(
      'Encrypted recovery history is no longer available from the pinned identity.',
      'message_recovery_reanchor_required',
    );
  }

  let previousVaultId = pinnedVaultId;
  let previousApprovalSigningKey = pinnedApprovalSigningKey;
  let previousEpoch = pinnedEpoch;
  const seenVaults = new Set([pinnedVaultId]);
  for (const step of transitionChain.slice(start)) {
    const parts = transitionAuthorizationParts(step.transitionAuthorization);
    if (
      !parts
      || parts.userId !== userId
      || parts.currentVaultId !== previousVaultId
      || step.previousVaultId !== previousVaultId
      || step.previousApprovalSigningKey !== previousApprovalSigningKey
      || step.approvalSigningKey !== step.canonicalPayload?.approvalSigningKey
      || !step.vaultId
      || seenVaults.has(step.vaultId)
      || !Number.isSafeInteger(step.epoch)
      || step.epoch <= previousEpoch
      || step.epoch > activeEpoch
    ) {
      throw new MessageRecoveryTransitionVerificationError(
        'Encrypted recovery transition data is invalid.',
        'message_recovery_transition_invalid',
      );
    }
    const expectedAuthorization = messageRecoveryAuthorization({
      action: parts.action,
      userId,
      currentVaultId: parts.currentVaultId,
      currentRevision: parts.currentRevision,
      payload: step.canonicalPayload,
      targetDeviceId: parts.targetDeviceId,
      operationId: parts.operationId,
    });
    let validSignature = false;
    try {
      validSignature = expectedAuthorization === step.transitionAuthorization && ed25519.verify(
        unbase64Length(step.transitionSignature, 64, 'Recovery transition signature'),
        utf8(step.transitionAuthorization),
        unbase64Length(previousApprovalSigningKey, 32, 'Recovery approval public key'),
      );
    } catch {
      validSignature = false;
    }
    if (!validSignature) {
      throw new MessageRecoveryTransitionVerificationError(
        'Encrypted recovery transition signature is invalid.',
        'message_recovery_transition_invalid',
      );
    }
    seenVaults.add(step.vaultId);
    previousVaultId = step.vaultId;
    previousApprovalSigningKey = step.approvalSigningKey;
    previousEpoch = step.epoch;
    if (previousVaultId === activeVaultId) break;
  }
  if (
    previousVaultId !== activeVaultId
    || previousApprovalSigningKey !== activeApprovalSigningKey
    || previousEpoch !== activeEpoch
  ) {
    throw new MessageRecoveryTransitionVerificationError(
      'Encrypted recovery transition chain does not reach the active identity.',
      'message_recovery_transition_invalid',
    );
  }
};

const passphraseWrappingKey = async (passphrase: string, salt: Uint8Array) =>
  deriveMessageRecoveryPassphraseKey(normalizeRecoveryPassphrase(passphrase), salt);

const recoveryCodeWrappingKey = (code: string, salt: Uint8Array) => hkdf(
  sha256,
  utf8(validateRecoveryCode(code)),
  salt,
  utf8('orizo-message-recovery-code-v1'),
  32,
);

const wrappingKey = async (
  kind: MessageRecoveryCredentialKind,
  secret: string,
  salt: Uint8Array,
) => kind === STRONG_PASSPHRASE_KIND
  ? passphraseWrappingKey(secret, salt)
  : recoveryCodeWrappingKey(secret, salt);

export const wrapRecoveryVaultKey = async ({
  userId,
  recoveryPublicKey,
  kind,
  secret,
  vaultKey,
}: {
  userId: number;
  recoveryPublicKey: string;
  kind: MessageRecoveryCredentialKind;
  secret: string;
  vaultKey: Uint8Array;
}): Promise<MessageRecoveryCredential> => {
  if (kind === STRONG_PASSPHRASE_KIND) validateRecoveryPassphrase(secret);
  const salt = randomBytes(16);
  const key = await wrappingKey(kind, secret, salt);
  const wrapped = seal(key, vaultKey, credentialAad(userId, recoveryPublicKey, kind, salt));
  key.fill(0);
  return {
    kind,
    kdfAlgorithm: kind === STRONG_PASSPHRASE_KIND ? 'argon2id_v1' : 'hkdf_sha256_v1',
    kdfSalt: base64(salt),
    kdfParams: kind === STRONG_PASSPHRASE_KIND ? {
      memoryKiB: PASSPHRASE_KDF.memoryKiB,
      iterations: PASSPHRASE_KDF.iterations,
      parallelism: PASSPHRASE_KDF.parallelism,
      length: PASSPHRASE_KDF.length,
    } : { length: 32 },
    wrappedVaultKey: wrapped.ciphertext,
    wrapNonce: wrapped.nonce,
  };
};

export const unwrapRecoveryVaultKey = async ({
  userId,
  recoveryPublicKey,
  credential,
  secret,
}: {
  userId: number;
  recoveryPublicKey: string;
  credential: MessageRecoveryCredential;
  secret: string;
}) => {
  const salt = unbase64(credential.kdfSalt);
  if (credential.kind === STRONG_PASSPHRASE_KIND) {
    const params = credential.kdfParams || {};
    if (
      credential.kdfAlgorithm !== 'argon2id_v1'
      || Number(params.memoryKiB) !== PASSPHRASE_KDF.memoryKiB
      || Number(params.iterations) !== PASSPHRASE_KDF.iterations
      || Number(params.parallelism) !== PASSPHRASE_KDF.parallelism
      || Number(params.length) !== PASSPHRASE_KDF.length
    ) throw new Error('Unsupported recovery-password key derivation profile.');
  } else if (
    credential.kind !== RECOVERY_CODE_KIND
    || credential.kdfAlgorithm !== 'hkdf_sha256_v1'
    || Number(credential.kdfParams?.length) !== 32
  ) {
    throw new Error('Unsupported recovery-code key derivation profile.');
  }
  const key = await wrappingKey(credential.kind, secret, salt);
  try {
    return open(
      key,
      credential.wrapNonce,
      credential.wrappedVaultKey,
      credentialAad(userId, recoveryPublicKey, credential.kind, salt),
    );
  } finally {
    key.fill(0);
  }
};

export const encryptRecoveryVaultBundle = (
  userId: number,
  recoveryPublicKey: string,
  vaultKey: Uint8Array,
  bundle: MessageRecoveryVaultBundle,
) => seal(
  vaultKey,
  utf8(JSON.stringify(bundle)),
  privateBundleAad(userId, recoveryPublicKey),
);

export const decryptRecoveryVaultBundle = (
  userId: number,
  record: MessageRecoveryVaultRecord,
  vaultKey: Uint8Array,
): MessageRecoveryVaultBundle => {
  if (vaultKey.length !== 32) throw new Error('Encrypted message recovery vault key is invalid.');
  unbase64Length(record.recoveryPublicKey, 32, 'Recovery public key');
  const plaintext = open(
    vaultKey,
    record.privateKeyNonce,
    record.encryptedPrivateKey,
    privateBundleAad(userId, record.recoveryPublicKey),
  );
  const bundle = JSON.parse(decodeUtf8(plaintext)) as MessageRecoveryVaultBundle;
  if (bundle.version !== 1 || !Array.isArray(bundle.keys) || bundle.keys.length === 0 || bundle.keys.length > 32) {
    throw new Error('Encrypted message recovery data is invalid.');
  }
  const seen = new Set<string>();
  for (const candidate of bundle.keys) {
    const privateKey = unbase64Length(candidate.privateKey, 32, 'Recovery private key');
    const publicKey = unbase64Length(candidate.publicKey, 32, 'Recovery public key');
    if (seen.has(candidate.publicKey)) throw new Error('Encrypted message recovery keyring contains duplicates.');
    seen.add(candidate.publicKey);
    if (base64(x25519.getPublicKey(privateKey)) !== base64(publicKey)) {
      throw new Error('Encrypted message recovery keypair is invalid.');
    }
  }
  if (!seen.has(record.recoveryPublicKey)) {
    throw new Error('Encrypted message recovery key does not match its public identity.');
  }
  if (record.approvalSigningKey && (
    !bundle.approvalSigningSeed
    || base64(ed25519.getPublicKey(unbase64Length(bundle.approvalSigningSeed, 32, 'Recovery approval private key'))) !== record.approvalSigningKey
  )) {
    throw new Error('Encrypted message recovery approval key does not match its public identity.');
  }
  return bundle;
};

export const createMessageRecoveryVault = async (userId: number, passphrase: string) => {
  const privateKey = randomBytes(32);
  const recoveryPublicKey = base64(x25519.getPublicKey(privateKey));
  const vaultKey = randomBytes(32);
  const approvalSigningSeed = randomBytes(32);
  const approvalSigningKey = base64(ed25519.getPublicKey(approvalSigningSeed));
  const bundle: MessageRecoveryVaultBundle = {
    version: 1,
    approvalSigningSeed: base64(approvalSigningSeed),
    keys: [{
      publicKey: recoveryPublicKey,
      privateKey: base64(privateKey),
      createdAt: new Date().toISOString(),
    }],
  };
  privateKey.fill(0);
  approvalSigningSeed.fill(0);
  const recoveryCode = generateRecoveryCode();
  const encrypted = encryptRecoveryVaultBundle(userId, recoveryPublicKey, vaultKey, bundle);
  const credentials = await Promise.all([
    wrapRecoveryVaultKey({
      userId,
      recoveryPublicKey,
      kind: STRONG_PASSPHRASE_KIND,
      secret: passphrase,
      vaultKey,
    }),
    wrapRecoveryVaultKey({
      userId,
      recoveryPublicKey,
      kind: RECOVERY_CODE_KIND,
      secret: recoveryCode,
      vaultKey,
    }),
  ]);
  return {
    recoveryCode,
    unlocked: { vaultKey: base64(vaultKey), bundle } satisfies MessageRecoveryUnlockedVault,
    request: {
      suite: MESSAGE_RECOVERY_SUITE,
      approvalSigningKey,
      recoveryPublicKey,
      encryptedPrivateKey: encrypted.ciphertext,
      privateKeyNonce: encrypted.nonce,
      credentials,
    },
  };
};

export const signMessageRecoveryDeviceApproval = (
  bundle: MessageRecoveryVaultBundle,
  challenge: string,
) => {
  if (!bundle.approvalSigningSeed) throw new Error('This recovery vault cannot approve a new device. Reset recovery from a trusted device first.');
  return base64(ed25519.sign(utf8(challenge), unbase64(bundle.approvalSigningSeed)));
};

export const addMessageRecoveryApprovalKey = (bundle: MessageRecoveryVaultBundle) => {
  if (bundle.approvalSigningSeed) {
    return {
      bundle,
      approvalSigningKey: base64(ed25519.getPublicKey(unbase64(bundle.approvalSigningSeed))),
    };
  }
  const seed = randomBytes(32);
  try {
    return {
      bundle: { ...bundle, approvalSigningSeed: base64(seed) },
      approvalSigningKey: base64(ed25519.getPublicKey(seed)),
    };
  } finally {
    seed.fill(0);
  }
};

export const unlockMessageRecoveryVault = async ({
  userId,
  record,
  kind,
  secret,
}: {
  userId: number;
  record: MessageRecoveryVaultRecord;
  kind: MessageRecoveryCredentialKind;
  secret: string;
}): Promise<MessageRecoveryUnlockedVault> => {
  const credential = record.credentials.find((value) => value.kind === kind);
  if (!credential) throw new Error('That recovery method is not configured.');
  try {
    const vaultKey = await unwrapRecoveryVaultKey({
      userId,
      recoveryPublicKey: record.recoveryPublicKey,
      credential,
      secret,
    });
    const bundle = decryptRecoveryVaultBundle(userId, record, vaultKey);
    return { vaultKey: base64(vaultKey), bundle };
  } catch {
    throw new Error(kind === RECOVERY_CODE_KIND
      ? 'That backup code isn’t right. Check it and try again.'
      : 'That chat password isn’t right. Check it and try again, or use your backup code.');
  }
};

export const recoveryFingerprint = (userId: number, epoch: number, publicKey: string) => {
  const digest = Array.from(
    sha256(utf8(`orizo-message-recovery-fingerprint-v1:${userId}:${epoch}:${publicKey}`)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('').toUpperCase();
  return (digest.match(/.{1,5}/g) || [digest]).slice(0, 12).join(' ');
};

export const recoverySafetyFingerprint = (entries: RecoveryVaultRecipient[]) => {
  const canonical = entries
    .map((value) => `${value.userId}:${value.epoch}:${value.recoveryPublicKey}`)
    .sort()
    .join('|');
  const digest = Array.from(
    sha256(utf8(`orizo-message-recovery-safety-v1:${canonical}`)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('').toUpperCase();
  return (digest.match(/.{1,5}/g) || [digest]).slice(0, 12).join(' ');
};

const assertNonZeroSharedSecret = (shared: Uint8Array) => {
  if (shared.every((value) => value === 0)) throw new Error('Invalid X25519 public key.');
  return shared;
};

export const sealMessageRecoveryEnvelope = ({
  contentKey,
  recipient,
  conversationId,
  clientMessageId,
}: {
  contentKey: Uint8Array;
  recipient: RecoveryVaultRecipient;
  conversationId: string;
  clientMessageId: string;
}): MessageRecoveryEnvelope => {
  const ephemeralPrivateKey = randomBytes(32);
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const shared = assertNonZeroSharedSecret(
    x25519.getSharedSecret(ephemeralPrivateKey, unbase64Length(recipient.recoveryPublicKey, 32, 'Recovery public key')),
  );
  ephemeralPrivateKey.fill(0);
  const aad = envelopeAad(conversationId, clientMessageId, recipient.userId, recipient.epoch);
  const key = hkdf(sha256, shared, utf8(aad), utf8(MESSAGE_RECOVERY_ENVELOPE_SCHEME), 32);
  const encrypted = seal(key, contentKey, aad);
  key.fill(0);
  return {
    userId: recipient.userId,
    vaultEpoch: recipient.epoch,
    scheme: MESSAGE_RECOVERY_ENVELOPE_SCHEME,
    ephemeralPublicKey: base64(ephemeralPublicKey),
    nonce: encrypted.nonce,
    ciphertext: encrypted.ciphertext,
  };
};

export const openMessageRecoveryEnvelope = ({
  envelope,
  bundle,
  conversationId,
  clientMessageId,
}: {
  envelope: MessageRecoveryEnvelope;
  bundle: MessageRecoveryVaultBundle;
  conversationId: string;
  clientMessageId: string;
}): Uint8Array => {
  const aad = envelopeAad(conversationId, clientMessageId, envelope.userId, envelope.vaultEpoch);
  for (const candidate of bundle.keys) {
    try {
      const shared = assertNonZeroSharedSecret(
        x25519.getSharedSecret(
          unbase64Length(candidate.privateKey, 32, 'Recovery private key'),
          unbase64Length(envelope.ephemeralPublicKey, 32, 'Recovery ephemeral public key'),
        ),
      );
      const key = hkdf(sha256, shared, utf8(aad), utf8(MESSAGE_RECOVERY_ENVELOPE_SCHEME), 32);
      try {
        const contentKey = open(key, envelope.nonce, envelope.ciphertext, aad);
        if (contentKey.length !== 32) throw new Error('Recovered message key is invalid.');
        return contentKey;
      } finally {
        key.fill(0);
      }
    } catch {
      // A recovery bundle is a small keyring. Try historical epochs before
      // reporting that this message cannot be restored.
    }
  }
  throw new Error('No recovery key can open this message.');
};


export const openMessageRecoveryEnvelopeSet = ({
  envelopes,
  bundle,
  conversationId,
  clientMessageId,
}: {
  envelopes: MessageRecoveryEnvelope[];
  bundle: MessageRecoveryVaultBundle;
  conversationId: string;
  clientMessageId: string;
}) => {
  for (const envelope of envelopes) {
    try {
      return openMessageRecoveryEnvelope({ envelope, bundle, conversationId, clientMessageId });
    } catch {
      // Keep trying historical/current epochs for this account.
    }
  }
  throw new Error('No recovery envelope can be opened by this keyring.');
};

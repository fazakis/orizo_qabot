import { argon2idAsync } from '@noble/hashes/argon2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

export const MESSAGE_RECOVERY_ARGON2ID_PROFILE = Object.freeze({
  version: 0x13,
  memoryKiB: 32 * 1024,
  iterations: 3,
  parallelism: 1,
  length: 32,
  saltBytes: 16,
  maxPasswordBytes: 1024,
});

const normalizedPasswordBytes = (passphrase: string) => {
  if (typeof passphrase !== 'string') throw new Error('Recovery password is invalid.');
  const bytes = utf8ToBytes(passphrase.normalize('NFKC'));
  if (bytes.length === 0 || bytes.length > MESSAGE_RECOVERY_ARGON2ID_PROFILE.maxPasswordBytes) {
    bytes.fill(0);
    throw new Error('Recovery password is invalid.');
  }
  return bytes;
};

const checkedSalt = (salt: Uint8Array) => {
  if (!(salt instanceof Uint8Array) || salt.length !== MESSAGE_RECOVERY_ARGON2ID_PROFILE.saltBytes) {
    throw new Error('Recovery password salt is invalid.');
  }
  return Uint8Array.from(salt);
};

/** Web/iOS recovery KDF. Android resolves the native worker implementation. */
export const deriveMessageRecoveryPassphraseKey = async (
  passphrase: string,
  salt: Uint8Array,
) => {
  const passwordBytes = normalizedPasswordBytes(passphrase);
  const saltBytes = checkedSalt(salt);
  try {
    return await argon2idAsync(passwordBytes, saltBytes, {
      version: MESSAGE_RECOVERY_ARGON2ID_PROFILE.version,
      t: MESSAGE_RECOVERY_ARGON2ID_PROFILE.iterations,
      m: MESSAGE_RECOVERY_ARGON2ID_PROFILE.memoryKiB,
      p: MESSAGE_RECOVERY_ARGON2ID_PROFILE.parallelism,
      dkLen: MESSAGE_RECOVERY_ARGON2ID_PROFILE.length,
      maxmem: 40 * 1024 * 1024,
      asyncTick: 8,
    });
  } finally {
    passwordBytes.fill(0);
    saltBytes.fill(0);
  }
};

/**
 * Signed Olm fallback keys (audit F19).
 *
 * One-time keys are consumed by every new session, so anyone allowed to start
 * a conversation could drain a device's supply and block new sessions. A
 * fallback key is reused when no one-time key is left. It must be signed by
 * the device's own Ed25519 key over this exact statement, and senders verify
 * that signature against the device's certificate-bound signing key, so a
 * server cannot substitute a fallback key it controls.
 *
 * The statement format is shared with the native Rust core
 * (modules/orizo-olm-android/rust/src/lib.rs, fallback_key_statement).
 * Pattern: matrix-org/vodozemac src/olm/account/mod.rs (generate_fallback_key,
 * fallback_key, forget_fallback_key) and the signed fallback-key upload in
 * (matrix-org/matrix-rust-sdk crates/matrix-sdk-crypto/src/olm/account.rs).
 */
export interface SignedFallbackKey {
  keyId: string;
  publicKey: string;
  signature: string;
}

export const fallbackKeyStatement = (deviceId: string, keyId: string, publicKey: string) =>
  `orizo-message-fallback-key-v1\n${deviceId}\n${keyId}\n${publicKey}`;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function normalizeSignedFallbackKeys(raw: unknown): SignedFallbackKey[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    const key = value as Partial<SignedFallbackKey> | null;
    if (!key || typeof key.keyId !== 'string' || typeof key.publicKey !== 'string' || typeof key.signature !== 'string') return [];
    if (!key.keyId || key.keyId.length > 64 || !BASE64.test(key.publicKey) || key.publicKey.length > 64
        || !BASE64.test(key.signature) || key.signature.length > 128) return [];
    return [{ keyId: key.keyId, publicKey: key.publicKey, signature: key.signature }];
  }).slice(0, 1);
}

type PrekeyDevice = {
  deviceId: string;
  signingKey: string;
  oneTimeKey: { keyId: string; publicKey: string } | null;
  fallbackKey?: SignedFallbackKey | null;
};

/**
 * Use a served fallback key as a device's prekey only after its signature
 * verifies with that device's (already certificate-checked) signing key. An
 * invalid or unsigned fallback key is dropped, so the device is treated as
 * having no prekey this round instead of starting a session with a key the
 * server may control.
 */
export async function resolveFallbackPrekeys<T extends PrekeyDevice>(
  devices: T[],
  verify: (signingKey: string, message: string, signature: string) => Promise<void>,
): Promise<T[]> {
  return Promise.all(devices.map(async (device) => {
    if (device.oneTimeKey?.publicKey || !device.fallbackKey) return { ...device, fallbackKey: null };
    const { keyId, publicKey, signature } = device.fallbackKey;
    try {
      await verify(device.signingKey, fallbackKeyStatement(device.deviceId, keyId, publicKey), signature);
    } catch {
      return { ...device, fallbackKey: null };
    }
    return { ...device, oneTimeKey: { keyId, publicKey }, fallbackKey: null };
  }));
}

/** Whether the server asked this device to publish or replace its fallback key. */
export const fallbackKeyNeedsRotation = (data: any) => {
  const value = String(data?.fallbackKeyState ?? data?.fallback_key_state ?? '');
  return value === 'missing' || value === 'used';
};

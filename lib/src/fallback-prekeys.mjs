// Match the app's signed fallback-key protocol. A fallback is a reusable
// prekey, not permission to omit a live recipient or accept an unsigned key.
export async function resolveFallbackPrekeys(devices, verify) {
  return Promise.all(devices.map(async (device) => {
    if (device.oneTimeKey?.publicKey || !device.fallbackKey)
      return { ...device, fallbackKey: null };
    const { keyId, publicKey, signature } = device.fallbackKey;
    if (![device.deviceId, device.signingKey, keyId, publicKey, signature]
      .every(value => typeof value === 'string' && value.length > 0))
      return { ...device, fallbackKey: null };
    try {
      await verify(device.signingKey,
        `orizo-message-fallback-key-v1\n${device.deviceId}\n${keyId}\n${publicKey}`,
        signature);
    } catch {
      return { ...device, fallbackKey: null };
    }
    return { ...device, oneTimeKey: { keyId, publicKey }, fallbackKey: null };
  }));
}

// Bot devices prove possession using the existing signed recovery challenge.
// No fabricated account password, bypass flag or private-vault read relaxation.
export async function readRecoveryForOwner(api) {
  const status = await api.request('/api/messages/e2ee/recovery/status/');
  if (!status.enabled) return status;
  const proof = await api.request('/api/messages/e2ee/recovery/read-challenges/', {
    method:'POST', body:{deviceId:api.crypto.state.deviceId},
  });
  const expires = Date.parse(proof.expiresAt ?? proof.expires_at);
  if (!/^vrr1\.[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(proof.token || '') ||
      typeof proof.authorization !== 'string' || !Number.isFinite(expires) || expires <= Date.now())
    throw new Error('Invalid recovery device challenge');
  return api.request('/api/messages/e2ee/recovery/', {headers:{
    'X-Orizo-Recovery-Read-Token':proof.token,
    'X-Orizo-Recovery-Read-Signature':await api.crypto.engine.sign(proof.authorization),
  }});
}

import { fromByteArray, toByteArray } from 'base64-js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { MessageOlmEngine, MessageOlmEngineBootstrap } from '../olmEngineTypes';
import { normalizeSignedFallbackKeys } from '../fallbackKeys';

export const WEB_STATE_PREFIX = 'orizo-web-vodozemac-v1:';
type Invoke = (operation: string, payload: string, state: Uint8Array, key: Uint8Array) => Uint8Array | Promise<Uint8Array>;
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

export const decodeBridge = (raw: Uint8Array) => {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw.length < 14 || view.getUint32(0) !== 0x4f4c4d42 || raw[4] !== 1) throw new Error('Invalid encryption response.');
  const size = view.getUint32(6);
  if (size > raw.length - 14) throw new Error('Invalid encryption response size.');
  const result = JSON.parse(new TextDecoder().decode(raw.subarray(10, 10 + size)));
  const stateSize = view.getUint32(10 + size);
  if (14 + size + stateSize !== raw.length) throw new Error('Invalid encrypted state size.');
  if (raw[5] !== 1) throw failure(result.code || 'message_crypto_failed', result.message || 'Encryption failed.');
  return { result, state: stateSize ? raw.slice(14 + size) : null };
};

/** The account and every ratchet are one encrypted, atomically persisted record.
 * No operation releases ciphertext/plaintext until its next state is durable. */
export const createWebOlmEngine = async (
  options: MessageOlmEngineBootstrap, invoke: Invoke, release: () => void = () => undefined,
): Promise<MessageOlmEngine> => {
  let key = new Uint8Array(32);
  let state = new Uint8Array(0);
  let closing = false;
  let storageFailed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const migrated = !!options.legacyAccountPickle && !options.legacyAccountPickle.startsWith(WEB_STATE_PREFIX);
  try {
    const pickleKey = options.legacyPickleKey || await options.createLegacyPickleKey();
    key = sha256(new TextEncoder().encode(`orizo-web-state-v1:${pickleKey}`));
    if (options.legacyAccountPickle?.startsWith(WEB_STATE_PREFIX)) {
      state = new Uint8Array(toByteArray(options.legacyAccountPickle.slice(WEB_STATE_PREFIX.length)));
      if (!state.length) throw new Error('The saved encryption identity is incomplete.');
    }
    const commit = async (operation: string, data: Record<string, unknown> = {}) => {
      if (storageFailed) throw failure('message_crypto_storage_failed', 'Reload this tab to recover the last saved encryption state.');
      const output = decodeBridge(await invoke(operation, JSON.stringify({ accountId: options.accountId, ...data }), state, key));
      if (operation === 'bootstrap' && Number(output.result.skippedSessionCount || 0) > 0) {
        throw failure('message_crypto_migration_incomplete', 'Some existing messaging sessions could not be imported. Your saved identity has not been changed.');
      }
      if (output.state) {
        try { await options.persistLegacyAccount(WEB_STATE_PREFIX + fromByteArray(output.state)); }
        catch (error) { storageFailed = true; throw error; }
        state.fill(0); state = output.state;
      }
      return output.result;
    };
    const registered = migrated ? await options.resolveLegacyServerIdentity() : null;
    if (migrated && !registered) throw failure('message_crypto_migration_pending', 'Connect this existing device before migrating its encryption identity.');
    const identity = await commit('bootstrap', {
      ...(migrated ? { legacyAccountPickle: options.legacyAccountPickle, legacyPickleKey: pickleKey,
        legacySessions: Object.entries(options.legacySessions).flatMap(([deviceId, values]) => values.map(value => ({ deviceId, ...value }))),
        expectedIdentityKey: registered!.identityKey, expectedSigningKey: registered!.signingKey } : {}),
    });
    const run = (operation: string, data: Record<string, unknown> = {}) => {
      if (closing) return Promise.reject(failure('message_crypto_closed', 'This messaging session is closing.'));
      const next = queue.then(() => commit(operation, data));
      queue = next.catch(() => undefined);
      return next;
    };
    return {
      kind: 'web-vodozemac-v1', accountId: options.accountId,
      identityKey: identity.identityKey, signingKey: identity.signingKey, importedLegacy: migrated,
      async getUnpublishedOneTimeKeys() { return (await run('identity')).unpublishedOneTimeKeys || {}; },
      async generateOneTimeKeys(count) { return (await run('generateOneTimeKeys', { count })).oneTimeKeys; },
      async markOneTimeKeysPublished() { await run('markOneTimeKeysPublished'); },
      async fallbackKeys(deviceId, rotate) { return normalizeSignedFallbackKeys((await run('fallbackKey', { deviceId, rotate })).fallbackKeys); },
      async sign(message) { return (await run('sign', { message })).signature; },
      async verify(signingKey, message, signature) { await run('verify', { signingKey, message, signature }); },
      async hasSessions(recipients) { return Object.fromEntries((await run('hasSessions', { recipients })).sessions.map((value: { deviceId: string; available: boolean }) => [value.deviceId, value.available])); },
      async encryptForDevices(recipients) { return run('encryptForDevices', { recipients }); },
      async decryptEnvelope(request) { return run('decryptEnvelope', { ...request }); },
      async decryptEnvelopes(requests) {
        // Preserve the wire core's newest-first batching convention explicitly.
        const sorted = [...requests].sort((a,b) => b.serverCreatedAt.localeCompare(a.serverCreatedAt) || b.serverMessageId.localeCompare(a.serverMessageId));
        const out = [];
        for (let start=sorted.length; start>0; start-=500) {
          const batch = sorted.slice(Math.max(0,start-500),start);
          out.push(...(await run('decryptEnvelopes', { envelopes: batch })).results);
        }
        return out;
      },
      async resetSessionsAndOneTimeKeys(count) {
        const { clearedSessionCount } = await run('clearSessions');
        const { oneTimeKeys } = await run('generateOneTimeKeys', { count });
        return { clearedSessionCount, oneTimeKeys };
      },
      async commitActivation() { if (migrated) await options.persistLegacySessions({}); },
      // Migrated keys must never be rolled backwards; retained ciphertext is safe to resume.
      async rollbackUncommitted() {},
      async close() { closing=true; await queue; key.fill(0);state.fill(0);release(); },
    };
  } catch (error) { key.fill(0);state.fill(0);release();throw error; }
};

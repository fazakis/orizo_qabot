/**
 * Signed directory heads (audit H2): authenticated freshness and revocation
 * for an account's public messaging certificates.
 *
 * A head is the account's own signed statement of which device and recovery
 * certificates are currently active and which are revoked. Heads form a hash
 * chain (epoch + previousHeadId), and revocations only ever accumulate. A
 * recipient pins the newest head it has accepted per account and refuses an
 * older epoch (rollback), a different head at the same epoch (fork), a missing
 * head once one was seen (downgrade), and any delivery target that is not in
 * the head's active set. A malicious server therefore cannot add a device,
 * revive a revoked one, or hide a revocation it has already shown.
 *
 * The idea follows Matrix cross-signing, where an account's own key signs the
 * devices it trusts (matrix-org/matrix-rust-sdk
 * crates/matrix-sdk-crypto/src/identities/); no code was copied. The wire
 * format is Orizo's own and mirrored by the backend (messaging/directory_heads.py).
 */
import {fromByteArray, toByteArray} from 'base64-js';
import {ed25519} from '@noble/curves/ed25519.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex, utf8ToBytes} from '@noble/hashes/utils.js';
import {
  DirectoryCertificateError, canonicalDirectorySigningKey, directoryCertificateSigningKey, verifyDirectoryCertificateChain,
} from './directoryCertificates';

export const DIRECTORY_HEAD_PREFIX = 'orizo-message-directory-head-v1\n';
export const MAX_HEAD_ACTIVE = 128;
export const MAX_HEAD_REVOKED = 512;
/** A head older than this is shown as unconfirmed, never used to block delivery. */
export const DIRECTORY_HEAD_STALE_SECONDS = 45 * 86400;
const DIGEST = /^[0-9a-f]{64}$/;
const KEYS = ['version', 'userId', 'accountSigningKey', 'epoch', 'previousHeadId', 'issuedAt',
  'issuerCertificateId', 'activeCertificateIds', 'revokedCertificateIds'].sort();

export type DirectoryHeadBody = {
  version: 1; userId: number; accountSigningKey: string; epoch: number; previousHeadId: string | null;
  issuedAt: number; issuerCertificateId: string; activeCertificateIds: string[]; revokedCertificateIds: string[];
};
export type DirectoryHead = { id: string; body: DirectoryHeadBody; signature: string };
export type DirectoryHeadPin = { epoch: number; headId: string };

export class DirectoryHeadError extends Error {
  readonly code = 'message_directory_head_invalid';
  constructor() { super('This contact’s device list could not be confirmed. Ask them to open Orizo on a trusted device.'); }
}
const invalid = (): never => { throw new DirectoryHeadError(); };

const idList = (value: unknown, limit: number): string[] => {
  if (!Array.isArray(value) || value.length > limit) return invalid();
  const sorted = [...value].sort();
  if (sorted.some((id, i) => typeof id !== 'string' || !DIGEST.test(id) || (i > 0 && sorted[i - 1] === id))) return invalid();
  if (sorted.some((id, i) => id !== value[i])) return invalid(); // must already be sorted
  return sorted;
};

export function canonicalDirectoryHeadBody(value: unknown): DirectoryHeadBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).sort().join(',') !== KEYS.join(',') || body.version !== 1) return invalid();
  const positive = (n: unknown) => (typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : invalid());
  const epoch = positive(body.epoch);
  const previous = body.previousHeadId;
  if (epoch === 1 ? previous !== null : (typeof previous !== 'string' || !DIGEST.test(previous))) return invalid();
  if (typeof body.issuerCertificateId !== 'string' || !DIGEST.test(body.issuerCertificateId)) return invalid();
  const active = idList(body.activeCertificateIds, MAX_HEAD_ACTIVE);
  const revoked = idList(body.revokedCertificateIds, MAX_HEAD_REVOKED);
  if (active.some(id => revoked.includes(id))) return invalid();
  if (revoked.includes(body.issuerCertificateId)) return invalid();
  let accountSigningKey: string;
  try { accountSigningKey = canonicalDirectorySigningKey(body.accountSigningKey); } catch { return invalid(); }
  return {
    version: 1, userId: positive(body.userId), accountSigningKey, epoch, previousHeadId: previous as string | null,
    issuedAt: positive(body.issuedAt), issuerCertificateId: body.issuerCertificateId,
    activeCertificateIds: active, revokedCertificateIds: revoked,
  };
}

export function directoryHeadAuthorization(body: DirectoryHeadBody): string {
  const canonical = canonicalDirectoryHeadBody(body);
  const sorted = Object.fromEntries(Object.entries(canonical).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return DIRECTORY_HEAD_PREFIX + JSON.stringify(sorted);
}

export const directoryHeadId = (body: DirectoryHeadBody) => bytesToHex(sha256(utf8ToBytes(directoryHeadAuthorization(body))));

/** Verify one head's signature and issuer chain against the account key (pinned or first-use). */
export function verifyDirectoryHead(packet: unknown, pool: Record<string, unknown>, input: { userId: number; accountSigningKey: string }): DirectoryHead {
  if (!packet || typeof packet !== 'object') return invalid();
  const raw = packet as Record<string, unknown>;
  if (Object.keys(raw).sort().join(',') !== 'body,id,signature') return invalid();
  const body = canonicalDirectoryHeadBody(raw.body);
  if (body.userId !== input.userId || body.accountSigningKey !== input.accountSigningKey || raw.id !== directoryHeadId(body)) return invalid();
  let issuer;
  try {
    issuer = verifyDirectoryCertificateChain(body.issuerCertificateId, pool, { userId: input.userId, pinnedAccountKey: input.accountSigningKey });
  } catch (error) {
    if (error instanceof DirectoryCertificateError) return invalid();
    throw error;
  }
  if (!issuer.canApprove) return invalid();
  const isRoot = issuer.issuerCertificateId === null;
  if (!isRoot && !body.activeCertificateIds.includes(body.issuerCertificateId)) return invalid();
  const signature = typeof raw.signature === 'string' ? raw.signature : invalid();
  try {
    const sig = toByteArray(signature.replace(/=+$/, '') + '='.repeat((4 - (signature.replace(/=+$/, '').length % 4)) % 4));
    if (sig.length !== 64 || !ed25519.verify(sig, utf8ToBytes(directoryHeadAuthorization(body)),
      toByteArray(directoryCertificateSigningKey(issuer)), { zip215: false })) return invalid();
  } catch { return invalid(); }
  return { id: raw.id as string, body, signature };
}

/**
 * Apply a verified head against the stored pin. Returns the pin to persist
 * once the whole directory validates. Older epochs and same-epoch forks fail.
 */
export function advanceDirectoryHeadPin(head: DirectoryHead, pin: DirectoryHeadPin | null): DirectoryHeadPin {
  if (pin) {
    if (head.body.epoch < pin.epoch) return invalid();
    if (head.body.epoch === pin.epoch && head.id !== pin.headId) return invalid();
  }
  return { epoch: head.body.epoch, headId: head.id };
}

/** Which of a user's delivery certificates the head allows. Anything else is excluded. */
export function headAllows(head: DirectoryHead, certificateId: string): boolean {
  return head.body.activeCertificateIds.includes(certificateId) && !head.body.revokedCertificateIds.includes(certificateId);
}

export const directoryHeadIsStale = (head: DirectoryHead, nowSeconds = Math.floor(Date.now() / 1000)) =>
  nowSeconds - head.body.issuedAt > DIRECTORY_HEAD_STALE_SECONDS;

/**
 * The next head for this account. Revocations accumulate; a certificate that
 * was ever revoked can never become active again.
 */
export function nextDirectoryHeadBody(input: {
  previous: DirectoryHead | null; userId: number; accountSigningKey: string; issuerCertificateId: string;
  active: Iterable<string>; revoke?: Iterable<string>; nowSeconds?: number;
}): DirectoryHeadBody {
  const revoked = new Set([...(input.previous?.body.revokedCertificateIds ?? []), ...(input.revoke ?? [])]);
  const active = [...new Set(input.active)].filter(id => !revoked.has(id)).sort();
  return canonicalDirectoryHeadBody({
    version: 1, userId: input.userId, accountSigningKey: input.accountSigningKey,
    epoch: (input.previous?.body.epoch ?? 0) + 1, previousHeadId: input.previous?.id ?? null,
    issuedAt: Math.max(input.nowSeconds ?? Math.floor(Date.now() / 1000), (input.previous?.body.issuedAt ?? 0) + 1),
    issuerCertificateId: input.issuerCertificateId,
    activeCertificateIds: active, revokedCertificateIds: [...revoked].sort(),
  });
}

/** Base64 helper shared with tests for signatures produced by the engines. */
export const encodeSignature = (bytes: Uint8Array) => fromByteArray(bytes);

type Binding = { userId: number; certificateId: string | null };

/**
 * Check every delivery target against its account's newest head.
 *
 * Accounts without any head yet keep today's certificate-only behaviour, until
 * one has been seen: from then on a missing head is a downgrade and fails.
 * A target certificate that is not active in its head fails the directory
 * (fail closed) instead of being dropped silently. Returns the head pins to
 * persist after the rest of the directory validates, and which accounts'
 * heads are stale.
 */
export function checkDirectoryHeads(input: {
  payload: unknown;
  bindings: Binding[];
  accountKeys: ReadonlyMap<number, string>;
  pins: ReadonlyMap<number, DirectoryHeadPin | null>;
  nowSeconds?: number;
}): { pins: Array<{ userId: number; pin: DirectoryHeadPin }>; staleUserIds: number[] } {
  const data = (input.payload && typeof input.payload === 'object' ? input.payload : { version: 1, heads: [], certificates: [] }) as Record<string, unknown>;
  if (data.version !== 1 || !Array.isArray(data.heads) || !Array.isArray(data.certificates) || data.heads.length > 64) return invalid();
  const pool: Record<string, unknown> = {};
  for (const certificate of data.certificates as Array<Record<string, unknown>>) {
    if (!certificate || typeof certificate.id !== 'string') return invalid();
    pool[certificate.id] = certificate;
  }
  const headsByUser = new Map<number, unknown>();
  for (const head of data.heads as Array<Record<string, any>>) {
    const userId = head?.body?.userId;
    if (typeof userId !== 'number' || headsByUser.has(userId)) return invalid();
    headsByUser.set(userId, head);
  }
  const pins: Array<{ userId: number; pin: DirectoryHeadPin }> = [];
  const stale: number[] = [];
  const users = [...new Set(input.bindings.map(binding => binding.userId))];
  for (const userId of users) {
    const raw = headsByUser.get(userId);
    const pin = input.pins.get(userId) ?? null;
    if (raw === undefined) {
      if (pin) return invalid(); // a head was seen before: downgrade
      continue;
    }
    const accountSigningKey = input.accountKeys.get(userId);
    if (!accountSigningKey) return invalid();
    // Certificates from the head proof plus the directory's own chains.
    const head = verifyDirectoryHead(raw, pool, { userId, accountSigningKey });
    pins.push({ userId, pin: advanceDirectoryHeadPin(head, pin) });
    for (const binding of input.bindings.filter(entry => entry.userId === userId)) {
      if (!binding.certificateId || !headAllows(head, binding.certificateId)) return invalid();
    }
    if (directoryHeadIsStale(head, input.nowSeconds)) stale.push(userId);
  }
  return { pins, staleUserIds: stale };
}

export const DIRECTORY_HEAD_PIN_PREFIX = '@message-e2ee-directory-head:';

/** Sealed per-account head pins, alongside the root pins (sealedDirectoryPins.ts). */
export function createSealedDirectoryHeadPins(input: {
  viewerId: number; assertCurrent: () => void; getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  seal: (context: string, value: unknown) => Promise<{ nonce: string; ciphertext: string }>;
  open: (context: string, sealed: { nonce: string; ciphertext: string }) => Promise<unknown>;
}) {
  const key = (subjectId: number) => `${DIRECTORY_HEAD_PIN_PREFIX}${input.viewerId}:${subjectId}`;
  const context = (subjectId: number) => `directory-head-v1:${input.viewerId}:${subjectId}`;
  async function read(subjectId: number): Promise<DirectoryHeadPin | null> {
    input.assertCurrent();
    const raw = await input.getItem(key(subjectId));
    input.assertCurrent();
    if (raw === null) return null;
    try {
      const sealed = JSON.parse(raw);
      const value = await input.open(context(subjectId), sealed) as Record<string, unknown>;
      input.assertCurrent();
      if (!value || value.version !== 1 || value.viewerId !== input.viewerId || value.subjectId !== subjectId
        || typeof value.epoch !== 'number' || !Number.isSafeInteger(value.epoch) || value.epoch <= 0
        || typeof value.headId !== 'string' || !DIGEST.test(value.headId)) return invalid();
      return { epoch: value.epoch, headId: value.headId };
    } catch { input.assertCurrent(); return invalid(); }
  }
  async function write(subjectId: number, pin: DirectoryHeadPin): Promise<void> {
    const previous = await read(subjectId);
    if (previous && (pin.epoch < previous.epoch || (pin.epoch === previous.epoch && pin.headId !== previous.headId))) return invalid();
    if (previous && previous.epoch === pin.epoch) return;
    const sealed = await input.seal(context(subjectId), { version: 1, viewerId: input.viewerId, subjectId, ...pin });
    input.assertCurrent();
    await input.setItem(key(subjectId), JSON.stringify(sealed));
    input.assertCurrent();
  }
  return { read, write };
}

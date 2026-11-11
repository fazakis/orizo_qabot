export const ANDROID_NATIVE_OLM_ENGINE = 'native-vodozemac-v1' as const;
export const ANDROID_NATIVE_OLM_ENGINE_PIN_PREFIX = '@message-e2ee-olm-engine:v1:';
export const ANDROID_NATIVE_OLM_REMOVAL_PREFIX = '@message-e2ee-olm-removal:v1:';

export type LegacyOlmSession = {
  sessionId: string;
  identityKey: string;
  sessionGeneration: number;
  pickle: string;
};

export type LegacyOlmSessions = Record<string, LegacyOlmSession[]>;

export type OlmSessionRecipient = {
  deviceId: string;
  identityKey: string;
  sessionGeneration: number;
};

export type OlmEncryptionRecipient = OlmSessionRecipient & {
  oneTimeKey: string | null;
  plaintext: string;
};

export type OlmEncryptedEnvelope = {
  deviceId: string;
  messageType: number;
  ciphertext: string;
  sessionId: string;
  createdSession: boolean;
};

export type OlmDecryptRequest = OlmSessionRecipient & {
  messageType: number;
  ciphertext: string;
  /** Authoritative server ordering; ISO timestamps sort chronologically. */
  serverCreatedAt: string;
  serverMessageId: string;
};

export type OlmDecryptResult = {
  plaintext: string;
  sessionId: string;
  createdInbound: boolean;
};

export type IndexedOlmDecryptRequest = OlmDecryptRequest & {
  index: number;
};

export type OlmDecryptBatchResult =
  | ({ index: number; ok: true } & OlmDecryptResult)
  | { index: number; ok: false; code: string; message: string };

export type OlmSessionResetResult = {
  clearedSessionCount: number;
  oneTimeKeys: Record<string, string>;
};

export type OlmPublicIdentity = {
  identityKey: string;
  signingKey: string;
};

export type MessageOlmEngineBootstrap = {
  /** Restore only an already activated native identity; no import/create/remove. */
  existingOnly?: boolean;
  accountId: string;
  legacyAccountPickle: string | null;
  legacyPickleKey: string | null;
  legacySessions: LegacyOlmSessions;
  createLegacyPickleKey: () => Promise<string>;
  persistLegacyAccount: (pickle: string) => Promise<void>;
  persistLegacySessions: (sessions: LegacyOlmSessions) => Promise<void>;
  discardLegacyState: () => Promise<void>;
  /**
   * Native mobile engines call this before importing a legacy libolm account.
   * A missing record means that the server has retired/reset that device and
   * the client
   * must create a fresh native identity instead of reviving stale key state.
   */
  resolveLegacyServerIdentity: () => Promise<OlmPublicIdentity | null>;
  refreshBrowserSnapshot?: () => Promise<{legacyAccountPickle: string | null; legacySessions: LegacyOlmSessions}>;
  loadRuntimeForTests?: () => Promise<any>;
};

export interface MessageOlmEngine {
  readonly kind: 'js-libolm' | 'web-vodozemac-v1' | typeof ANDROID_NATIVE_OLM_ENGINE;
  readonly accountId: string;
  readonly identityKey: string;
  readonly signingKey: string;
  readonly importedLegacy: boolean;
  getUnpublishedOneTimeKeys(): Promise<Record<string, string>>;
  generateOneTimeKeys(count: number): Promise<Record<string, string>>;
  markOneTimeKeysPublished(): Promise<void>;
  /**
   * Signed fallback key for this device, generating a new one when rotate is
   * set. Optional: an older native build without the operation rejects, and
   * callers then simply publish no fallback key.
   */
  fallbackKeys?(deviceId: string, rotate: boolean): Promise<import('./fallbackKeys').SignedFallbackKey[]>;
  sign(message: string): Promise<string>;
  verify(signingKey: string, message: string, signature: string): Promise<void>;
  hasSessions(recipients: OlmSessionRecipient[]): Promise<Record<string, boolean>>;
  encryptForDevices(recipients: OlmEncryptionRecipient[]): Promise<{
    envelopes: OlmEncryptedEnvelope[];
    skippedDeviceIds: string[];
  }>;
  decryptEnvelope(request: OlmDecryptRequest, options?: { background?: boolean }): Promise<OlmDecryptResult>;
  decryptEnvelopes(requests: IndexedOlmDecryptRequest[]): Promise<OlmDecryptBatchResult[]>;
  /** Native crash journal: acknowledgment is allowed only after durable key caching. */
  pendingDecrypts?(): Promise<Array<{ messageId: string; plaintext: string }>>;
  acknowledgePersistedDecrypts?(messageIds: string[]): void;
  flushDecryptAcknowledgments?(): Promise<void>;
  resetSessionsAndOneTimeKeys(count: number): Promise<OlmSessionResetResult>;
  /** Commit the engine choice only after server registration succeeds. */
  commitActivation(): Promise<void>;
  /** Remove only a newly prepared, not-yet-activated native account. */
  rollbackUncommitted(): Promise<void>;
  close(): Promise<void>;
}

export const nativeOlmAccountId = (userId: number, installationId: string) =>
  `${userId}:${installationId}`;

export const nativeOlmEnginePinKey = (accountId: string) =>
  `${ANDROID_NATIVE_OLM_ENGINE_PIN_PREFIX}${accountId}`;

export const nativeOlmRemovalMarkerKey = (accountId: string) =>
  `${ANDROID_NATIVE_OLM_REMOVAL_PREFIX}${accountId}`;

export const assertImportedOlmIdentity = (
  imported: OlmPublicIdentity,
  registered: OlmPublicIdentity,
) => {
  if (
    imported.identityKey !== registered.identityKey
    || imported.signingKey !== registered.signingKey
  ) {
    throw Object.assign(
      new Error('The imported native encryption identity does not match the registered device.'),
      { code: 'message_native_olm_identity_mismatch' },
    );
  }
};

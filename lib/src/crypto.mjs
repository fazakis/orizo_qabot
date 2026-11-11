import wasmBase64 from "../vendor/wasm.mjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as core from "../vendor/crypto.mjs";
import {readRecoveryForOwner} from './recovery-read.mjs';
import {enrollExistingDirectory} from './directory-enrollment.mjs';
import * as directory from '../vendor/directory.mjs';
import {requireDeliveryReady} from './delivery-readiness.mjs';
import {resolveFallbackPrekeys} from './fallback-prekeys.mjs';
export const b64 = (b) => Buffer.from(b).toString("base64");
export const bytes = (s) => new Uint8Array(Buffer.from(s, "base64"));
export const utf8 = (s) => new TextEncoder().encode(s);
export const camel = (value) =>
  Array.isArray(value)
    ? value.map(camel)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value).map(([k, v]) => [
            k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
            camel(v),
          ]),
        )
      : value;
let initialized = false;
async function initialize() {
  if (initialized) return;
  const wasm = Buffer.from(wasmBase64, "base64");
  if (createHash("sha256").update(wasm).digest("hex") !== core.WEB_OLM_SHA256)
    throw new Error("Encryption runtime integrity mismatch");
  core.initSync({ module: wasm });
  initialized = true;
}
export class OrizoCrypto {
  constructor(vault, api) {
    this.vault = vault;
    this.api = api;
    if (api) api.crypto = this;
  }
  async initialize() {
    await initialize();
    const account = await this.vault.get("account");
    this.userId = account.userId;
    this.state = await this.vault.get("device");
    if (!this.state) {
      this.state = {
        userId: this.userId,
        deviceId: randomUUID(),
        installationId: account.installationId,
        pickleKey: b64(randomBytes(32)),
        selfKey: b64(randomBytes(32)),
        notificationKey: b64(randomBytes(32)),
      };
      await this.persist();
    }
    if (this.state.userId !== this.userId || this.state.installationId !== account.installationId)
      throw new Error("Encryption account mismatch");
    this.engine = await core.createWebOlmEngine(
      {
        accountId: String(this.userId),
        legacyAccountPickle: this.state.pickle || null,
        legacyPickleKey: this.state.pickleKey,
        legacySessions: {},
        createLegacyPickleKey: async () => this.state.pickleKey,
        persistLegacyAccount: async (pickle) => {
          this.state.pickle = pickle;
          await this.persist();
        },
        persistLegacySessions: async () => {},
        resolveLegacyServerIdentity: async () => null,
      },
      core.invoke,
    );
  }
  persist() {
    return this.vault.put("device", this.state);
  }
  async register(refill = true, fallbackRefreshed = false) {
    let keys = await this.engine.getUnpublishedOneTimeKeys();
    const fallbackKeys = await this.engine.fallbackKeys(this.state.deviceId, false);
    const record = camel(
      await this.api.request("/api/messages/e2ee/devices/", {
        method: "POST",
        body: {
          deviceId: this.state.deviceId,
          installationId: this.state.installationId,
          platform: "web",
          capabilities: [
            "device_leases_v1",
            "recovery_envelope_v1",
            "delivery_directory_complete_v1",
            "message_requests_v1",
          ],
          identityKey: this.engine.identityKey,
          signingKey: this.engine.signingKey,
          notificationPublicKey: b64(
            core.x25519.getPublicKey(bytes(this.state.notificationKey)),
          ),
          oneTimeKeys: keys,
          ...(fallbackKeys[0] ? { fallbackKey: fallbackKeys[0] } : {}),
        },
      }),
    );
    if (record.pendingRecoveryApproval)
      throw new Error("Existing vault approval required; no automatic reset");
    if (Object.keys(keys).length) await this.engine.markOneTimeKeysPublished();
    // Persist the signed fallback private key before publishing. A lost HTTP
    // response retries the same key; never rotate again within this attempt.
    if (!fallbackRefreshed && ['missing','used'].includes(record.fallbackKeyState)) {
      await this.engine.fallbackKeys(this.state.deviceId, true);
      return this.register(refill, true);
    }
    if (refill && Number(record.oneTimeKeyCount ?? 0) < 12) {
      await this.engine.generateOneTimeKeys(50);
      return this.register(false, fallbackRefreshed);
    }
    this.registration = record;
    return record;
  }
  async ensureRecovery() {
    let stored = await this.vault.get("recovery");
    const account = await this.vault.get("account");
    let remote = camel(await readRecoveryForOwner(this.api,account));
    if (!stored) {
      if (remote.enabled)
        throw new Error("Unrecognized recovery vault; refusing replacement");
      stored = await core.createMessageRecoveryVault(
        this.userId,
        account.recoveryPassphrase,
      );
      const authorization = core.messageRecoveryAuthorization({
        action: "setup",
        userId: this.userId,
        currentVaultId: null,
        currentRevision: 0,
        payload: stored.request,
      });
      stored.request = {
        ...stored.request,
        creatorDeviceId: this.state.deviceId,
        creatorSignature: await this.engine.sign(authorization),
      };
      await this.vault.put("recovery", stored);
    }
    if (!remote.enabled)
      remote = camel(
        await this.api.request("/api/messages/e2ee/recovery/", {
          method: "POST",
          body: stored.request,
        }),
      );
    const record = remote.vault;
    if (
      record.recoveryPublicKey !== stored.request.recoveryPublicKey ||
      record.approvalSigningKey !== stored.request.approvalSigningKey
    )
      throw new Error("Recovery vault identity changed");
    const passwordUnlocked = await core.unlockMessageRecoveryVault({
      userId: this.userId,
      record,
      kind: core.STRONG_PASSPHRASE_KIND,
      secret: account.recoveryPassphrase,
    });
    const codeUnlocked = await core.unlockMessageRecoveryVault({
      userId: this.userId,
      record,
      kind: core.RECOVERY_CODE_KIND,
      secret: stored.recoveryCode,
    });
    if (
      passwordUnlocked.vaultKey !== stored.unlocked.vaultKey ||
      codeUnlocked.vaultKey !== stored.unlocked.vaultKey
    )
      throw new Error("Recovery verification failed");
    stored.record = record;
    stored.verifiedAt = new Date().toISOString();
    await this.vault.put("recovery", stored);
    this.recovery = stored;
    await enrollExistingDirectory(this);
    return { enabled: true, verified: true, epoch: record.epoch };
  }
  async recipients(conversationId) {
    const endpoint = `/api/messages/conversations/${conversationId}/e2ee/recipients/`;
    let result = camel(
      await this.api.request(endpoint, {
        method: "POST",
        body: { currentDeviceId: this.state.deviceId, missingDeviceIds: [] },
      }),
    );
    requireDeliveryReady(result, this.state.deviceId);
    const remote = result.devices.filter((d) => !d.isCurrentDevice);
    const available = await this.engine.hasSessions(
      remote.map((d) => ({
        deviceId: d.deviceId,
        identityKey: d.identityKey,
        sessionGeneration: d.sessionGeneration,
      })),
    );
    const missing = remote
      .filter((d) => !available[d.deviceId])
      .map((d) => d.deviceId);
    if (missing.length)
      result = camel(
        await this.api.request(endpoint, {
          method: "POST",
          body: {
            currentDeviceId: this.state.deviceId,
            missingDeviceIds: missing,
          },
        }),
      );
    requireDeliveryReady(result, this.state.deviceId);
    // Devices can be offline after exhausting their one-time keys. The
    // server's signed fallback still permits authenticated session creation.
    // Resolve it only after the final missing-device directory refresh.
    return { ...result, devices: await resolveFallbackPrekeys(result.devices,
      (signingKey, message, signature) => this.engine.verify(signingKey, message, signature)) };
  }
  async encrypt(conversationId, clientMessageId, payload) {
    const targets = await this.recipients(conversationId);
    if (!this.directoryIdentity) throw new Error('Approved sender identity unavailable');
    const own = targets.devices.find(d => d.deviceId === this.state.deviceId && d.isCurrentDevice);
    const authorContext = {conversationId, clientMessageId, senderUserId:this.userId,
      senderDeviceId:this.state.deviceId, senderSessionGeneration:own.sessionGeneration ?? 0, eventType:payload.eventType};
    const bodyContext = directory.messageAuthorBodyContext(authorContext, this.directoryIdentity.certificate.id);
    const contentKey = new Uint8Array(randomBytes(32)),
      nonce = new Uint8Array(randomBytes(24));
    const ciphertext = core
      .xchacha20poly1305(
        contentKey,
        nonce,
        utf8(`orizo-e2ee-content-v1:${conversationId}:${bodyContext}`),
      )
      .encrypt(utf8(JSON.stringify(payload)));
    const envelopes = [];
    for (const d of targets.devices.filter((d) => d.isCurrentDevice)) {
      const n = new Uint8Array(randomBytes(24));
      envelopes.push({
        deviceId: d.deviceId,
        scheme: "local_xchacha_v1",
        messageType: -1,
        nonce: b64(n),
        ciphertext: b64(
          core
            .xchacha20poly1305(
              bytes(this.state.selfKey),
              n,
              utf8(`${conversationId}:${clientMessageId}:${d.deviceId}`),
            )
            .encrypt(contentKey),
        ),
      });
    }
    const remote = await this.engine.encryptForDevices(
      targets.devices
        .filter((d) => !d.isCurrentDevice)
        .map((d) => ({
          deviceId: d.deviceId,
          identityKey: d.identityKey,
          sessionGeneration: d.sessionGeneration,
          oneTimeKey: d.oneTimeKey?.publicKey || null,
          plaintext: b64(contentKey),
        })),
    );
    envelopes.push(
      ...remote.envelopes.map((e) => ({ ...e, scheme: "olm_v1" })),
    );
    const notificationEnvelopes = targets.devices
      .filter(
        (d) =>
          d.notificationPublicKey &&
          !d.isCurrentDevice &&
          d.userId !== this.userId,
      )
      .map((d) => {
        const ephemeral = core.x25519.keygen(),
          n = new Uint8Array(randomBytes(12));
        const key = core.hkdf(
          core.sha256,
          core.x25519.getSharedSecret(
            ephemeral.secretKey,
            bytes(d.notificationPublicKey),
          ),
          utf8(conversationId),
          utf8("orizo-message-notification-v1"),
          32,
        );
        const preview =
          payload.eventType === "message"
            ? payload.body.slice(0, 180)
            : "Message updated";
        return {
          deviceId: d.deviceId,
          ephemeralPublicKey: b64(ephemeral.publicKey),
          nonce: b64(n),
          ciphertext: b64(
            core
              .chacha20poly1305(key, n, utf8(conversationId))
              .encrypt(utf8(preview)),
          ),
        };
      });
    const recoveryEnvelopes = (targets.recoveryVaults || []).map((recipient) =>
      core.sealMessageRecoveryEnvelope({
        contentKey,
        recipient,
        conversationId,
        clientMessageId,
      }),
    );
    contentKey.fill(0);
    const senderBinding = await directory.createMessageAuthorBinding({identity:this.directoryIdentity,
      context:authorContext, cipherNonce:b64(nonce), ciphertext:b64(ciphertext), sign:text=>this.engine.sign(text)});
    return {
      encryptionVersion: "e2ee_olm_v1",
      senderDeviceId: this.state.deviceId,
      senderSessionGeneration: authorContext.senderSessionGeneration,
      senderBinding,
      directoryRevision: targets.directoryRevision,
      eventType: payload.eventType,
      ciphertext: b64(ciphertext),
      cipherNonce: b64(nonce),
      deviceEnvelopes: envelopes,
      notificationEnvelopes,
      recoveryEnvelopes,
      skippedDeviceIds: remote.skippedDeviceIds,
      membershipVersion: targets.membershipVersion,
    };
  }
  async decrypt(raw) {
    const header = directory.messageAuthorBindingFromRaw(raw);
    const row = camel(raw),
      conversationId = String(row.conversation || row.conversationId),
      clientMessageId = row.clientMessageId;
    const author = header ? await directory.verifyMessageAuthorBinding({binding:header,
      context:directory.messageAuthorContextFromRaw(raw), cipherNonce:row.cipherNonce, ciphertext:row.ciphertext,
      pinnedAccountKey:row.sender?.id === this.userId ? this.state?.directoryTrust?.accountSigningKey :
        this.state?.recipientTrust?.[row.sender?.id]?.accountSigningKey}) : null;
    const bodyContext = author?.bodyContext || clientMessageId;
    let key;
    // Recovery ciphertext is independently authenticated and restart-safe. It
    // avoids consuming an Olm ratchet twice when durable polling replays a row.
    const recoveryEnvelope = (row.recoveryEnvelopes || []).find(
      (e) => e.userId === this.userId,
    );
    if (recoveryEnvelope && this.recovery)
      key = core.openMessageRecoveryEnvelope({
        envelope: recoveryEnvelope,
        bundle: this.recovery.unlocked.bundle,
        conversationId,
        clientMessageId,
      });
    else {
      const e = (row.deviceEnvelopes || []).find(
        (e) => e.deviceId === this.state.deviceId,
      );
      if (!e) throw new Error("No message envelope for this bot");
      if (e.scheme === "local_xchacha_v1")
        key = core
          .xchacha20poly1305(
            bytes(this.state.selfKey),
            bytes(e.nonce),
            utf8(`${conversationId}:${clientMessageId}:${this.state.deviceId}`),
          )
          .decrypt(bytes(e.ciphertext));
      else
        key = bytes(
          (
            await this.engine.decryptEnvelope({
              deviceId: row.senderDeviceId,
              identityKey: author?.leaf.identityKey.replace(/=+$/, '') || row.senderIdentityKey,
              sessionGeneration: row.senderSessionGeneration || 0,
              messageType: e.messageType,
              ciphertext: e.ciphertext,
              serverCreatedAt: row.createdAt,
              serverMessageId: row.id,
            })
          ).plaintext,
        );
    }
    try {
      return JSON.parse(
        new TextDecoder().decode(
          core
            .xchacha20poly1305(
              key,
              bytes(row.cipherNonce),
              utf8(
                `orizo-e2ee-content-v1:${conversationId}:${bodyContext}`,
              ),
            )
            .decrypt(bytes(row.ciphertext)),
        ),
      );
    } finally {
      key.fill(0);
    }
  }
  async close() {
    await this.engine?.close();
  }
}

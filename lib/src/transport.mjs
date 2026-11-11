import { randomUUID } from "node:crypto";
import { encryptAttachment } from "./media.mjs";
import { camel } from "./crypto.mjs";
import { normalizeTarget } from "./config.mjs";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export class Transport {
  constructor(api, crypto, store) {
    this.api = api;
    this.crypto = crypto;
    this.store = store;
    this.chain = Promise.resolve();
    this.socket = null;
    this.sends = new Map();
  }
  serialize(work) {
    const p = this.chain.then(work);
    this.chain = p.catch(() => {});
    return p;
  }
  async pages(path) {
    const rows = [];
    for (let i = 0; path && i < 1000; i++) {
      const page = camel(await this.api.request(path));
      rows.push(...(Array.isArray(page) ? page : page.results || []));
      if (Array.isArray(page) || !page.next) return rows;
      const next = new URL(page.next, this.api.origin);
      if (
        next.origin !== this.api.origin
      )
        throw new Error("Untrusted pagination origin");
      path = next.pathname + next.search;
    }
    if (path) throw new Error("Pagination limit reached");
    return rows;
  }
  async changes(cursor) {
    return camel(await this.api.request('/api/messages/sync/changes/',{
      method:'POST',body:{deviceId:this.crypto.state.deviceId,cursor,limit:100},
    }));
  }
  async resolve(messageIds) {
    if(!messageIds.length)return [];
    return camel(await this.api.request('/api/messages/sync/resolve/',{
      method:'POST',body:{currentDeviceId:this.crypto.state.deviceId,messageIds},
    })).results;
  }
  conversations() {
    return this.pages("/api/messages/conversations/");
  }
  // Quotes are resolved only inside the current, freshly authorized conversation.
  // Bound history work; never follow a reply's client-supplied preview or URL.
  async findReply(id, messageId) {
    if (!normalizeTarget(id) || !normalizeTarget(messageId))
      return { status: "unavailable" };
    const endpoint = `/api/messages/conversations/${id}/messages/`;
    let path = `${endpoint}?currentDeviceId=${encodeURIComponent(this.crypto.state.deviceId)}`;
    const controls = [];
    let count = 0;
    for (let pageNumber = 0; path && pageNumber < 20; pageNumber++) {
      const page = camel(await this.api.request(path));
      if (page.redactedMessageIds?.includes(messageId))
        return { status: "unavailable" };
      const batch = Array.isArray(page) ? page : page.results || [];
      for (const row of batch) {
        if (++count > 1000) return { status: "unavailable" };
        if (String(row.conversation || row.conversationId) !== id)
          return { status: "unavailable" };
        if (row.id === messageId) {
          if (row.deletedAt || !Number.isSafeInteger(row.sender?.id) || row.sender.id <= 0 || row.eventType !== "message" || row.encryptionVersion !== "e2ee_olm_v1")
            return { status: "unavailable" };
          return { status: "found", row, controls };
        }
        if (["edit", "delete"].includes(row.eventType)) controls.push(row);
      }
      if (Array.isArray(page) || !page.next) break;
      const next = new URL(page.next, this.api.origin);
      if (next.origin !== this.api.origin || next.pathname !== this.api.apiPath(endpoint))
        return { status: "unavailable" };
      next.searchParams.set("currentDeviceId", this.crypto.state.deviceId);
      path = next.pathname + next.search;
    }
    return { status: "unavailable" };
  }
  async messages(id, after) {
    if (!normalizeTarget(id)) throw new Error("Invalid conversation");
    const rows = [];
    let path = `/api/messages/conversations/${id}/messages/?currentDeviceId=${this.crypto.state.deviceId}`;
    for (let i = 0; path && i < 1000; i++) {
      const page = camel(await this.api.request(path)),
        batch = Array.isArray(page) ? page : page.results || [];
      let stop = false;
      for (const row of batch) {
        if (after && row.id === after) {
          stop = true;
          break;
        }
        rows.push(row);
      }
      if (stop || Array.isArray(page) || !page.next) return rows.reverse();
      const next = new URL(page.next, this.api.origin);
      if (
        next.origin !== this.api.origin
      )
        throw new Error("Untrusted pagination origin");
      path = next.pathname + next.search;
    }
    throw new Error("Message catchup limit reached");
  }
  send(
    id,
    text,
    {
      eventType = "message",
      targetMessageId,
      replyToId,
      operationId = randomUUID(),
      attachment,
      reactionEmoji,
      attempts = 4,
      timeoutMs = 30000,
    } = {},
  ) {
    if (!normalizeTarget(id))
      return Promise.reject(new Error("Invalid conversation"));
    // Serialize ratchet/state mutation, not network delivery. A slow preview
    // must not block inbound decryption or an independent command reply.
    const key = `send-${operationId}`;
    if (this.sends.has(key)) return this.sends.get(key);
    const run = (async () => {
      let prepared = await this.serialize(async () => {
        const existing = await this.store.get(key);
        if (existing?.messageId) return { messageId: existing.messageId };
        const clientMessageId = existing?.clientMessageId || randomUUID();
        const payload = {
          version: 1,
          eventType,
          kind: "text",
          body: text,
          replyTo: replyToId
            ? { id: replyToId, senderUsername: "", preview: "" }
            : null,
          sharedType: "",
          sharedId: "",
          attachment: null,
          ...(targetMessageId ? { targetMessageId } : {}),
          ...(eventType === "reaction" ? { reactionEmoji: reactionEmoji || "" } : {}),
          createdAt: new Date().toISOString(),
        };
        let encryptedFile = existing?.encryptedFile;
        if (!existing && attachment) {
          const encrypted = encryptAttachment(attachment, id, clientMessageId);
          payload.attachment = encrypted.manifest;
          payload.kind = encrypted.manifest.kind;
          encryptedFile = encrypted.ciphertext;
        }
        let request = existing?.request || {
          clientMessageId,
          ...(await this.crypto.encrypt(id, clientMessageId, payload)),
        };
        if (payload.attachment) {
          request.encryptedBlobId = payload.attachment.blobId;
          request.ciphertextSha256 = payload.attachment.ciphertextSha256;
        }
        await this.store.set(key, {
          conversationId: id,
          clientMessageId,
          request,
          encryptedFile,
        });
        return { clientMessageId, request, encryptedFile };
      });
      if (prepared.messageId) return prepared.messageId;
      let { clientMessageId, request, encryptedFile } = prepared;
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          const row = camel(
            await this.api.request(
              `/api/messages/conversations/${id}/messages/`,
              { method: "POST", body: request, attachment: encryptedFile, timeoutMs },
            ),
          );
          if (!row.id) throw new Error("Missing server acceptance receipt");
          await this.store.set(key, {
            conversationId: id,
            clientMessageId,
            messageId: row.id,
            completedAt: Date.now(),
          });
          return row.id;
        } catch (e) {
          if (
            e.status === 409 &&
            e.code === "message_delivery_directory_changed" &&
            attempt < attempts - 1
          ) {
            await this.serialize(async () => {
              const recovered = await this.crypto.decrypt({
                ...request,
                conversation: id,
                sender: {id:this.crypto.userId},
              });
              const previous = request;
              request = {
                clientMessageId,
                ...(await this.crypto.encrypt(id, clientMessageId, recovered)),
                ...(encryptedFile
                  ? {
                      encryptedBlobId: previous.encryptedBlobId,
                      ciphertextSha256: previous.ciphertextSha256,
                    }
                  : {}),
              };
              await this.store.set(key, {
                conversationId: id,
                clientMessageId,
                request,
                encryptedFile,
              });
            });
            continue;
          }
          if ((e.status && e.status < 500 && e.status !== 429) || attempt === attempts - 1)
            throw e;
          await delay(500 * 2 ** attempt);
        }
      }
    })();
    this.sends.set(key, run);
    void run.finally(() => this.sends.delete(key)).catch(() => {});
    return run;
  }
  react(id, messageId, emoji, options = {}) {
    return this.send(id, "", { ...options, eventType: "reaction",
      targetMessageId: messageId, reactionEmoji: emoji });
  }
  async waitForIdle() {
    await Promise.allSettled([...this.sends.values()]);
    await this.chain;
  }
  edit(id, messageId, text, options = {}) {
    return this.send(id, text, {
      ...options,
      eventType: "edit",
      targetMessageId: messageId,
    });
  }
  remove(id, messageId, options = {}) {
    return this.send(id, "", {
      ...options,
      eventType: "delete",
      targetMessageId: messageId,
    });
  }
  typing(id, active) {
    if (!normalizeTarget(id)) return;
    void this.api.request(`/api/messages/conversations/${id}/typing/`, {
      method:'POST',body:{active:!!active},timeoutMs:8000,
    }).catch(() => {});
  }
  async connect(onWake, signal) {
    // Bot-only long polling will supply wake hints; ordinary messaging sockets
    // never receive scoped bot credentials. The monitor already polls durably.
    if (signal.aborted) return;
    await new Promise(resolve => signal.addEventListener('abort', resolve, {once:true}));
  }
}

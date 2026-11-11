import { answer } from './answers.mjs';
export class QABot {
  constructor({config, me, transport, crypto, store, api, now = Date.now}) {
    Object.assign(this, {config, me, transport, crypto, store, api, now});
  }
  async poll() {
    // Poll sequentially: never race the shared ratchet or checkpoint owner.
    for (const id of this.config.conversationIds) {
      const conversation = await this.api.request(`/api/messages/conversations/${id}/`);
      if (conversation.id !== id) throw Error('Conversation mismatch');
      const key = `cursor-${id}`;
      const cursor = await this.store.get(key);
      const rows = await this.transport.messages(id, cursor?.messageId);
      for (const raw of rows) {
        // Resolve again so deleted/expired events from catchup cannot activate replies.
        const row = (await this.transport.resolve([raw.id]))?.find(r => r.id === raw.id);
        if (row && this.admit(row, id)) {
          const payload = await this.transport.serialize(() => this.crypto.decrypt(row));
          if (payload.version === 1 && payload.eventType === 'message' && payload.kind === 'text' && typeof payload.body === 'string') {
            let text = payload.body;
            const mention = `@${this.me.username}`;
            if (conversation.type !== 'group' || text.toLowerCase().split(/\s+/).includes(mention.toLowerCase())) {
              text = text.replaceAll(mention, '').trim();
              await this.transport.send(id, answer(text), {replyToId:row.id, operationId:`faq-${row.id}`});
            }
          }
        }
        // Failure before acceptance leaves checkpoint unchanged. SDK uses stable operationId
        // and ciphertext outbox, including after acceptance with a lost HTTP response.
        await this.store.set(key, {messageId:raw.id});
      }
    }
  }
  admit(row, id) {
    return String(row.conversation || row.conversationId) === id &&
      row.eventType === 'message' && row.encryptionVersion === 'e2ee_olm_v1' &&
      Number.isSafeInteger(row.sender?.id) && row.sender.id !== this.me.id && !row.sender.isBot &&
      (!this.config.allowedUserIds.length || this.config.allowedUserIds.includes(row.sender.id)) && !row.deletedAt &&
      !row.viewOnce && !row.viewOnceConsumed &&
      (!row.expiresAt || (Number.isFinite(Date.parse(row.expiresAt)) && Date.parse(row.expiresAt) > this.now()));
  }
}

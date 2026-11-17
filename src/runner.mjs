import { answer } from './answers.mjs';
export class QABot {
  constructor({config, me, transport, crypto, store, api, now = Date.now}) {
    Object.assign(this, {config, me, transport, crypto, store, api, now});
  }
  async poll() {
    await this.flushDelivery();
    const saved = await this.store.get('sync-cursor');
    let cycle;
    try { cycle = await this.transport.changes(saved?.cursor); }
    catch (error) {
      // Writer conflicts are fatal; only an explicit journal reset permits a baseline.
      if (error.status !== 409 || error.code !== 'message_sync_reset_required') throw error;
      cycle = await this.transport.changes();
    }
    // Capture the journal boundary BEFORE history so arrivals during baseline
    // reads are caught next time. Keep existing per-conversation checkpoints.
    const pending = new Set((await this.store.get('baseline-pending'))?.ids || []);
    for (const id of this.config.conversationIds)
      if (cycle.bootstrapRequired || !await this.store.get(`cursor-${id}`)) pending.add(id);
    // Persist recovery intent before committing any newer journal boundary.
    await this.store.set('baseline-pending', {ids:[...pending]});
    for (const id of this.config.conversationIds) {
      if (!pending.has(id)) continue;
      try { await this.catchUp(id); }
      catch (error) {
        if ([401,409].includes(error.status)) throw error;
        // Keep this chat pending without starving unrelated conversations.
        continue;
      }
      pending.delete(id);
      await this.store.set('baseline-pending', {ids:[...pending]});
    }
    const conversations = new Map();
    for (let page = 0; page < 20; page++) {
      if (!Array.isArray(cycle.changes) || typeof cycle.nextCursor !== 'string' || !cycle.nextCursor)
        throw Error('Invalid synchronization response');
      const allowed = new Set(this.config.conversationIds.filter(id => !pending.has(id)));
      const ids = [...new Set(cycle.changes
        .filter(change => allowed.has(change.conversationId))
        .map(change => change.messageId).filter(Boolean))];
      if (ids.length) {
        for (const row of await this.transport.resolve(ids)) {
          const id = String(row.conversation || row.conversationId);
          if (!ids.includes(row.id) || !allowed.has(id)) continue;
          await this.receive(row, id, conversations);
        }
      }
      // Failed resolve/decrypt/send leaves this page replayable. Completed rows
      // have durable receipts, including baseline/journal overlap and restarts.
      await this.store.set('sync-cursor', {cursor:cycle.nextCursor});
      await this.flushDelivery();
      if (!cycle.hasMore) return;
      if (page < 19) cycle = await this.transport.changes(cycle.nextCursor);
    }
  }
  async catchUp(id) {
    const key = `cursor-${id}`;
    const cursor = await this.store.get(key);
    const rows = await this.transport.messages(id, cursor?.messageId);
    const conversations = new Map();
    for (let offset = 0; offset < rows.length; offset += 100) {
      const batch = rows.slice(offset, offset + 100);
      const resolved = new Map((await this.transport.resolve(batch.map(row => row.id)))
        .map(row => [row.id, row]));
      for (const raw of batch) {
        const row = resolved.get(raw.id);
        if (row) await this.receive(row, id, conversations);
        await this.store.set(key, {messageId:raw.id});
      }
    }
    // Empty conversations are also initialized; don't fetch their history every tick.
    if (!rows.length && !cursor) await this.store.set(key, {messageId:null});
  }
  async receive(row, id, conversations) {
    if (!this.admit(row, id)) return;
    if (await this.store.get(`received-${row.id}`)) return this.queueDelivery(row.id);
    // Honor send receipts written by older versions during an upgrade.
    if ((await this.store.get(`send-faq-${row.id}`))?.messageId) return this.queueDelivery(row.id);
    if (!conversations.has(id)) {
      const conversation = await this.api.request(`/api/messages/conversations/${id}/`);
      if (conversation.id !== id) throw Error('Conversation mismatch');
      conversations.set(id, conversation);
    }
    const payload = await this.transport.serialize(() => this.crypto.decrypt(row));
    if (payload.version === 1 && payload.eventType === 'message' && payload.kind === 'text' && typeof payload.body === 'string') {
      let text = payload.body;
      const mention = `@${this.me.username}`;
      if (conversations.get(id).type !== 'group' || text.toLowerCase().split(/\s+/).includes(mention.toLowerCase())) {
        text = text.replaceAll(mention, '').trim();
        await this.transport.send(id, answer(text), {replyToId:row.id, operationId:`faq-${row.id}`});
      }
    }
    await this.store.set(`received-${row.id}`, {handled:true});
    await this.queueDelivery(row.id);
  }
  async queueDelivery(id) {
    let pending = (await this.store.get('delivery-pending'))?.ids || [];
    if (pending.includes(id)) return;
    if (pending.length >= 1000) {
      await this.flushDelivery();
      pending = (await this.store.get('delivery-pending'))?.ids || [];
      if (pending.length >= 1000) throw Error('Delivery receipt queue full; retry later');
    }
    // Durable handled state precedes the ACK queue; the journal advances last.
    await this.store.set('delivery-pending', {ids:[...pending, id]});
  }
  async flushDelivery() {
    let pending = (await this.store.get('delivery-pending'))?.ids || [];
    while (pending.length) {
      const batch = pending.slice(0,100);
      try { await this.transport.acceptDelivery(batch); }
      catch (error) {
        if ([401,409].includes(error.status)) throw error;
        return; // Durable retry on the next cycle, independent of incoming reads.
      }
      pending = pending.slice(batch.length);
      await this.store.set('delivery-pending', {ids:pending});
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

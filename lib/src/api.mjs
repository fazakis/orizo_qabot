import { randomUUID, randomBytes } from "node:crypto";
export class OrizoApi {
  constructor(vault, { fetchImpl = fetch, origin = 'https://api.orizo.app', cdnOrigin = 'https://cdn.orizo.app' } = {}) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password)
      throw new Error('An HTTPS API origin is required');
    this.origin = origin;
    this.cdnOrigin = cdnOrigin;
    this.writerId = randomUUID();
    this.leaseUntil = 0;
    this.vault = vault;
    this.fetch = fetchImpl;
    this.tokens = null;
    this.loginFlight = null;
  }
  async authenticate() {
    if (this.loginFlight) return this.loginFlight;
    this.loginFlight = (async () => {
      const credential = await this.vault.get('credential');
      if (!/^obt1\.[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(credential?.token || ''))
        throw new Error('Provision a bot token through protected credential entry');
      if (credential.origin !== this.origin) throw new Error('Bot credential origin mismatch');
      this.tokens = {access: credential.token};
      const me = await this.request('/api/me/', {retry:false, lease:false});
      if (me.isBot !== true || !Number.isSafeInteger(me.id) || !me.installationId || !me.botId)
        throw new Error('Expected a registered bot identity');
      let account = await this.vault.get('account');
      if (account && (account.origin !== this.origin || account.userId !== me.id || account.botId !== me.botId || account.installationId !== me.installationId))
        throw new Error('Bot identity changed; refusing to reuse keys');
      if (!account) {
        account = {origin:this.origin, userId:me.id, username:me.username, botId:me.botId, installationId:me.installationId,
          recoveryPassphrase:randomBytes(48).toString('base64url')};
        await this.vault.put('account', account);
      }
      this.account = account;
    })().finally(() => { this.loginFlight = null; });
    return this.loginFlight;
  }
  apiPath(path) {
    if (typeof path !== 'string' || path.includes('..') || path.includes('\\') || path.split('?')[0].includes('%') || path.includes('#'))
      throw new Error('Bot API path rejected');
    if (path.startsWith('/api/bots/v1/')) return path;
    if (path === '/api/me/') return '/api/bots/v1/me/';
    if (path.startsWith('/api/messages/')) return '/api/bots/v1/messages/'+path.slice('/api/messages/'.length);
    throw new Error('Bot API path rejected');
  }
  async ensureWriter() {
    if (this.leaseUntil > Date.now()+30000) return;
    if (!this.leaseFlight) this.leaseFlight = (async () => {
      const result = await this.request('/api/bots/v1/writer-lease/', {
        method:'POST',body:{writerId:this.writerId},lease:false});
      const until = Date.parse(result.expiresAt);
      if (result.writerId !== this.writerId || !Number.isFinite(until) || until <= Date.now())
        throw new Error('Invalid bot writer lease');
      this.leaseUntil = until;
    })().finally(() => { this.leaseFlight = null; });
    return this.leaseFlight;
  }
  async request(path, { method = "GET", body, attachment, retry = true, timeoutMs = 30000, headers = {}, lease = true } = {}) {
    const url = new URL(this.apiPath(path), this.origin);
    if (url.origin !== this.origin) throw new Error('Bot origin rejected');
    if (!this.tokens) await this.authenticate();
    if (lease && !url.pathname.endsWith('/me/')) await this.ensureWriter();
    // Signed camelCase headers must travel as JSON text through DRF's
    // snake-case parser, including non-multipart sends (same as the app).
    const wireFields = body?.senderBinding && typeof body.senderBinding === 'object'
      ? {...body, senderBinding:JSON.stringify(body.senderBinding)} : body;
    let wireBody = wireFields ? JSON.stringify(wireFields) : undefined;
    if (attachment) {
      const form = new FormData();
      for (const [key, value] of Object.entries(wireFields || {}))
        if (value !== undefined)
          form.append(
            key,
            typeof value === "object" ? JSON.stringify(value) : String(value),
          );
      form.append(
        "attachment",
        new Blob([Buffer.from(attachment, "base64")], {
          type: "application/octet-stream",
        }),
        "encrypted.bin",
      );
      wireBody = form;
    }
    const res = await this.fetch(url, {
      method,
      redirect: "error",
      headers: {
        ...headers,
        Authorization: `Bearer ${this.tokens.access}`,
        "X-Orizo-Bot-Writer": this.writerId,
        ...(body && !attachment ? { "Content-Type": "application/json" } : {}),
      },
      body: wireBody,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 && retry) {
      await this.authenticate();
      if(headers['X-Orizo-Recovery-Read-Token'])throw new Error('Recovery session changed; retry owner confirmation');
      return this.request(path, { method, body, attachment, retry: false, timeoutMs, headers, lease });
    }
    if (!res.ok) {
      const error = new Error(`Orizo API HTTP ${res.status}: ${url.pathname}`);
      error.status = res.status;
      try {
        const info = await res.json();
        error.code = typeof info.code === "string" ? info.code : undefined;
      } catch {}
      throw error;
    }
    return res.status === 204 ? null : res.json();
  }
  async releaseWriter() {
    await this.leaseFlight;
    if (!this.leaseUntil) return;
    await this.request('/api/bots/v1/writer-lease/', {method:'DELETE',lease:false,retry:false,timeoutMs:5000});
    this.leaseUntil = 0;
  }
  async downloadAttachment(raw, maxBytes) {
    const url = new URL(raw, this.origin);
    if (
      url.origin !== this.origin ||
      !/^\/api\/messages\/attachments\/\d+\/encrypted-message\.bin$/.test(
        url.pathname,
      )
    )
      throw new Error("Untrusted attachment URL");
    if (url.username || url.password || url.hash)
      throw new Error("Untrusted attachment URL");
    const signal = AbortSignal.timeout(60000);
    const options = { redirect: "manual", credentials: "omit", signal };
    let res = await this.fetch(url, options);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      const target = location ? new URL(location, url) : null;
      // The API signs a one-hop CDN URL. Never forward API credentials or
      // follow arbitrary redirects; ciphertext still requires hash + AEAD.
      if (!target || target.origin !== this.cdnOrigin ||
          target.username || target.password || target.hash ||
          !(
            /^\/gymapp-media\/message_attachments\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+\.bin$/.test(target.pathname) ||
            // Pre-uploaded blobs retain this backend-generated key when
            // attached to a published message; hash + AEAD still bind content.
            /^\/gymapp-media\/message_staging\/[1-9]\d*\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{32}\.bin$/.test(target.pathname)
          ))
        throw new Error("Untrusted attachment redirect");
      res = await this.fetch(target, options);
    }
    if (!res.ok) {
      await res.body?.cancel();
      const error = new Error(`Attachment HTTP ${res.status}`);
      error.status = res.status;
      throw error;
    }
    if (Number(res.headers.get("content-length")) > maxBytes) {
      await res.body?.cancel();
      throw new Error("Attachment too large");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error("Attachment too large");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}

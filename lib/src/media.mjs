import { randomUUID, randomBytes, createHash } from "node:crypto";
import { basename } from "node:path";
import { xchacha20poly1305 } from "../vendor/crypto.mjs";
import { bytes, b64, utf8 } from "./crypto.mjs";
export function encryptAttachment(input, conversationId, clientMessageId) {
  const blobId = randomUUID(),
    key = randomBytes(32),
    nonce = randomBytes(24);
  try {
    const ciphertext = xchacha20poly1305(
      key,
      nonce,
      utf8(
        `orizo-e2ee-attachment-v1:${conversationId}:${clientMessageId}:${blobId}`,
      ),
    ).encrypt(input.buffer);
    const mime = input.contentType || "application/octet-stream";
    const kind = mime.startsWith("image/")
      ? "image"
      : mime.startsWith("video/")
        ? "video"
        : mime.startsWith("audio/")
          ? "voice"
          : "pdf";
    return {
      ciphertext: b64(ciphertext),
      manifest: {
        blobId,
        kind,
        name: basename(input.fileName || "attachment"),
        mimeType: mime,
        size: input.buffer.length,
        key: b64(key),
        nonce: b64(nonce),
        ciphertextSha256: createHash("sha256").update(ciphertext).digest("hex"),
        durationMs: 0,
        waveform: [],
        codec: "",
        gifPlayback: !!input.gifPlayback,
      },
    };
  } finally {
    key.fill(0);
  }
}
export function decryptAttachment(
  ciphertext,
  manifest,
  conversationId,
  clientMessageId,
  maxBytes,
) {
  if (
    !manifest ||
    !Number.isSafeInteger(manifest.size) ||
    manifest.size < 0 ||
    manifest.size > maxBytes ||
    ciphertext.length > maxBytes + 16
  )
    throw new Error("Attachment size rejected");
  if (
    createHash("sha256").update(ciphertext).digest("hex") !==
    manifest.ciphertextSha256
  )
    throw new Error("Attachment integrity mismatch");
  const key = bytes(manifest.key);
  try {
    const plaintext = xchacha20poly1305(
      key,
      bytes(manifest.nonce),
      utf8(
        `orizo-e2ee-attachment-v1:${conversationId}:${clientMessageId}:${manifest.blobId}`,
      ),
    ).decrypt(ciphertext);
    if (plaintext.length !== manifest.size)
      throw new Error("Attachment length mismatch");
    return Buffer.from(plaintext);
  } finally {
    key.fill(0);
  }
}
export async function inboundMedia(api, channel, row, payload, maxBytes, refreshRow) {
  if (!payload.attachment) return [];
  // Do not claim or consume view-once content as a background bot.
  if (row.viewOnce || row.viewOnceConsumed || payload.viewOnce)
    throw new Error("View-once media is not supported by the Orizo agent");
  const m = payload.attachment,
    remote = row.attachments?.find((a) => a.encryptedBlobId === m.blobId);
  if (!remote?.fileUrl) throw new Error("Encrypted attachment unavailable");
  let cipher;
  try {
    cipher = await api.downloadAttachment(remote.fileUrl, maxBytes + 16);
  } catch (error) {
    if (!refreshRow || ![401, 403, 404, 410].includes(error.status)) throw error;
    // Durable ingress stores ciphertext, but signed attachment URLs expire.
    // Refresh metadata only; never substitute message identity or payload.
    const fresh = await refreshRow();
    if (!fresh || fresh.id !== row.id ||
        String(fresh.conversation) !== String(row.conversation) ||
        fresh.clientMessageId !== row.clientMessageId ||
        fresh.sender?.id !== row.sender?.id ||
        fresh.ciphertext !== row.ciphertext || fresh.cipherNonce !== row.cipherNonce ||
        fresh.deletedAt || fresh.viewOnce || fresh.viewOnceConsumed)
      throw new Error("Attachment refresh rejected");
    const updated = fresh.attachments?.find(a => a.encryptedBlobId === m.blobId);
    if (!updated?.fileUrl) throw new Error("Encrypted attachment unavailable");
    cipher = await api.downloadAttachment(updated.fileUrl, maxBytes + 16);
  }
  const plain = decryptAttachment(
    cipher,
    m,
    String(row.conversation),
    row.clientMessageId,
    maxBytes,
  );
  let saved;
  try {
    saved = await channel.media.saveMediaBuffer(
      plain,
      m.mimeType,
      "inbound",
      maxBytes,
      basename(m.name || "attachment"),
    );
  } finally {
    plain.fill(0);
  }
  return [
    {
      path: saved.path,
      contentType: saved.contentType || m.mimeType,
      filename: basename(m.name || "attachment"),
    },
  ];
}

import { inboundMedia } from "./media.mjs";

const unavailable = "[Quoted message unavailable: it may have been deleted, be outside the accessible history, or be unreadable.]";

// Only authenticated original message data becomes quote context. Client preview
// and senderUsername are display hints, never identity or a fallback for deletion.
export async function readReplyContext({ lookup, transport, api, channel, maxBytes }) {
  if (!lookup) return undefined;
  if (lookup.status !== "found") return { body: unavailable, isQuote: true };
  const { row, controls = [] } = lookup;
  const quote = {
    id: row.id,
    sender: `Orizo user ${row.sender.id}${row.sender.username ? ` (@${row.sender.username})` : ""}`,
    isSelf: row.sender.id === transport.crypto.userId,
    isQuote: true,
  };
  if (row.viewOnce || row.viewOnceConsumed)
    return { ...quote, body: "[Quoted view-once content is not opened by the agent.]" };
  try {
    const payload = await transport.serialize(() => transport.crypto.decrypt(row));
    if (payload.version !== 1 || payload.eventType !== "message") throw new Error("Invalid quote");
    if (payload.viewOnce)
      return { ...quote, body: "[Quoted view-once content is not opened by the agent.]" };
    let body = typeof payload.body === "string" ? payload.body : "";
    // Same-author lifecycle events only; delete wins even over a later edit.
    // An unreadable relevant-author control fails closed instead of showing stale text.
    const ownControls = controls.filter((event) => event.sender?.id === row.sender.id);
    if (ownControls.length > 100) throw new Error("Quote lifecycle limit");
    for (const event of [...ownControls].reverse()) {
      const update = await transport.serialize(() => transport.crypto.decrypt(event));
      if (update.version !== 1 || update.eventType !== event.eventType) throw new Error("Invalid quote update");
      if (update.targetMessageId !== row.id) continue;
      if (update.eventType === "delete") return { ...quote, body: unavailable };
      if (update.eventType === "edit" && typeof update.body === "string") body = update.body;
    }
    const result = { ...quote, body: body || (payload.attachment ? "[Quoted attachment]" : "[Quoted message has no text.]"), media: [] };
    if (payload.attachment) {
      try {
        result.media = await inboundMedia(api, channel, row, payload, maxBytes);
      } catch {
        result.body += "\n[Quoted attachment unavailable or exceeds the media limit.]";
      }
    }
    return result;
  } catch {
    return { ...quote, body: unavailable };
  }
}

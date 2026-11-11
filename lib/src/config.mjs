export function normalizeTarget(raw) {
  const id = String(raw || '').replace(/^orizo-bot:/, '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : undefined;
}

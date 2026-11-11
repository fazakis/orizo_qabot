// Browser/Node fallback: Noble requires a real Web Crypto CSPRNG and fails
// closed when unavailable. No pseudo-random or deterministic fallback.
export { randomBytes as messageSecureRandomBytes } from '@noble/hashes/utils.js';

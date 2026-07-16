/**
 * Idempotency keys for a provider write.
 *
 * The same key is presented to the provider on every attempt of one logical
 * write, so a retry after an ambiguous timeout reconciles to the same event
 * instead of creating a second one (B2: "a retried write does not duplicate").
 *
 * The key is 32 lowercase hex characters. That alphabet is a subset of RFC 4648
 * base32hex, so the SAME key is directly usable as a Microsoft Graph
 * `transactionId` AND as a client-assigned Google Calendar event id (whose id
 * grammar is base32hex, 5–1024 chars) — one key, both idempotency mechanisms,
 * no secret and nothing provider-identifying in it.
 */
export function newIdempotencyKey(): string {
  // randomUUID is hyphenated hex; stripping hyphens leaves 32 chars of [0-9a-f],
  // a valid base32hex string and a valid Google event id.
  return crypto.randomUUID().replace(/-/g, '');
}

/** A key we generated always matches this; used to reject a tampered stored key. */
export function isWellFormedIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

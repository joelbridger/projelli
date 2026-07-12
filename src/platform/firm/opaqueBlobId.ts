/**
 * Opaque relay update identifier. This is deliberately a 256-bit random
 * handle, not a document name, UUID supplied by a caller, or any local id.
 * Keep this wire format aligned with backend/src/routes/matters.ts.
 */
export const OPAQUE_BLOB_ID_PREFIX = 'bh2_';
export const OPAQUE_BLOB_ID_PATTERN = /^bh2_[A-Za-z0-9_-]{43}$/;

export function createOpaqueBlobId(): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Secure random values are required for firm relay updates.');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${OPAQUE_BLOB_ID_PREFIX}${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}`;
}

export function isOpaqueBlobId(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_BLOB_ID_PATTERN.test(value);
}

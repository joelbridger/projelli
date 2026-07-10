/** A filesystem-safe request name generated locally, never taken from client input. */
export function assertRequestSlug(slug: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    throw new Error('Request folder names must contain only lowercase letters, numbers, and hyphens.');
  }
  return slug;
}

export function createRequestSlug(seed = 'request'): string {
  const prefix = seed.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'request';
  const suffix = randomToken(8);
  return assertRequestSlug(`${prefix.slice(0, 40)}-${suffix}`);
}

/** Opaque wire handle: no product meaning may be encoded in it. */
export function createOpaqueItemHandle(): string {
  return `ri_${randomToken(18)}`;
}

function randomToken(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
}

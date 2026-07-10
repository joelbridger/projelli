function bytesToB64Url(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function b64ToBytes(b64: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(b64) || b64.length % 4 === 1) {
    throw new Error('Invalid base64.');
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function b64UrlToBytes(b64Url: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*={0,2}$/u.test(b64Url) || b64Url.length % 4 === 1) {
    throw new Error('Invalid base64url.');
  }
  const padded = b64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    Math.ceil(b64Url.length / 4) * 4,
    '=',
  );
  return b64ToBytes(padded);
}

export function buildLinkFragment(sB64: string, intakePubRaw65B: Uint8Array): string {
  if (intakePubRaw65B.length !== 65) {
    throw new Error(`Expected a 65-byte intake public key, got ${String(intakePubRaw65B.length)}.`);
  }
  return `v1.${bytesToB64Url(b64ToBytes(sB64))}.${bytesToB64Url(intakePubRaw65B)}`;
}

export type ParseLinkFragmentResult =
  | { version: 1; s: Uint8Array; intakePubRaw: Uint8Array }
  | { error: string };

export function parseLinkFragment(fragment: string): ParseLinkFragmentResult {
  const clean = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const parts = clean.split('.');
  if (parts.length !== 3) return { error: 'malformed' };
  const [version, sPart, pubPart] = parts;
  if (version !== 'v1') return { error: 'unsupported_version' };

  let s: Uint8Array;
  let intakePubRaw: Uint8Array;
  try {
    s = b64UrlToBytes(sPart ?? '');
    intakePubRaw = b64UrlToBytes(pubPart ?? '');
  } catch {
    return { error: 'malformed_base64' };
  }

  if (s.length === 0) return { error: 'invalid_secret' };
  if (intakePubRaw.length !== 65) return { error: 'invalid_public_key' };
  return { version: 1, s, intakePubRaw };
}

import { describe, expect, it } from 'vitest';

import { buildLinkFragment, parseLinkFragment } from '@/platform/intake/intakeLink';

function b64(bytes: Uint8Array): string {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function b64Url(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

describe('intake link fragment codec', () => {
  it('round-trips the link secret and 65-byte intake public key', () => {
    const s = new Uint8Array(32).map((_, i) => i + 1);
    const pub = new Uint8Array(65).fill(7);
    pub[0] = 4;

    const fragment = buildLinkFragment(b64(s), pub);
    expect(fragment).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const parsed = parseLinkFragment(fragment);
    expect(parsed).toEqual({ version: 1, s, intakePubRaw: pub });
  });

  it('accepts a leading hash from a URL fragment', () => {
    const s = new Uint8Array(32).fill(11);
    const pub = new Uint8Array(65).fill(12);
    pub[0] = 4;

    const parsed = parseLinkFragment(`#${buildLinkFragment(b64(s), pub)}`);

    expect(parsed).toEqual({ version: 1, s, intakePubRaw: pub });
  });

  it('returns a typed error for the wrong version', () => {
    const parsed = parseLinkFragment('v2.abc.def');

    expect(parsed).toEqual({ error: 'unsupported_version' });
  });

  it('returns a typed error for a truncated public key', () => {
    const s = new Uint8Array(32).fill(1);
    const pub = new Uint8Array(64).fill(2);
    const parsed = parseLinkFragment(`v1.${b64Url(s)}.${b64Url(pub)}`);

    expect(parsed).toEqual({ error: 'invalid_public_key' });
  });

  it('returns a typed error for garbage base64url', () => {
    const parsed = parseLinkFragment('v1.not*base64.also*bad');

    expect(parsed).toEqual({ error: 'malformed_base64' });
  });
});

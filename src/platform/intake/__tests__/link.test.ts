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

  it('rejects a non-256-bit link secret on parse (low-entropy link)', () => {
    const shortS = new Uint8Array(1).fill(9);
    const pub = new Uint8Array(65).fill(4);
    pub[0] = 4;

    const parsed = parseLinkFragment(`v1.${b64Url(shortS)}.${b64Url(pub)}`);

    expect(parsed).toEqual({ error: 'invalid_secret' });
  });

  it('refuses to build a link from a non-32-byte secret', () => {
    const shortS = new Uint8Array(16).fill(3);
    const pub = new Uint8Array(65).fill(4);
    pub[0] = 4;

    expect(() => buildLinkFragment(b64(shortS), pub)).toThrow(/32-byte|256-bit/i);
  });
});

/**
 * seatToken — OFFLINE Ed25519 verification of a seat token. We mint a real
 * EdDSA JWT with a generated keypair (exactly the backend's wire format) and
 * prove the client verifier accepts a good token, rejects a wrong key, rejects
 * an expired token, rejects alg confusion, and rejects tampering.
 */

import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto';
import { verifySeatToken, decodeSeatTokenUnsafe } from '@/platform/firm/seatToken';

function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Mint an EdDSA JWT the same way the backend's signSeatToken does. */
function mintSeatToken(payload: Record<string, unknown>, privateKey: KeyObject): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${header}.${body}`;
  const sig = edSign(null, Buffer.from(signingInput), privateKey);
  return `${signingInput}.${b64url(sig)}`;
}

const NOW = 1_781_000_000; // fixed seconds
const claims = {
  org_id: 'org-1',
  user_id: 'user-1',
  seat_id: 'seat-1',
  machine_id: 'machine-1',
  tier: 'practice' as const,
  packs: ['legal'] as Array<'legal'>,
  seats: 5,
  iss: 'licenses.lanternplatform.app',
  sub: 'user-1',
  iat: NOW - 100,
  exp: NOW + 3600,
};

describe('seatToken offline verification', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  it('accepts a valid token signed by the matching key and returns its claims', async () => {
    const token = mintSeatToken(claims, privateKey);
    const res = await verifySeatToken(token, publicPem, NOW);
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.claims.tier).toBe('practice');
      expect(res.claims.seat_id).toBe('seat-1');
      expect(res.claims.org_id).toBe('org-1');
    }
  });

  it('rejects a token signed by a DIFFERENT key (signature_invalid)', async () => {
    const other = generateKeyPairSync('ed25519');
    const token = mintSeatToken(claims, other.privateKey);
    const res = await verifySeatToken(token, publicPem, NOW);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.reason).toBe('signature_invalid');
  });

  it('rejects an expired token (expired)', async () => {
    const token = mintSeatToken({ ...claims, exp: NOW - 10 }, privateKey);
    const res = await verifySeatToken(token, publicPem, NOW);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.reason).toBe('expired');
  });

  it('rejects alg confusion (alg:none / HS256 header)', async () => {
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })));
    const body = b64url(Buffer.from(JSON.stringify(claims)));
    const forged = `${header}.${body}.`;
    const res = await verifySeatToken(forged, publicPem, NOW);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.reason).toBe('bad_alg');
  });

  it('rejects tampered claims (signature no longer matches)', async () => {
    const token = mintSeatToken(claims, privateKey);
    const [h, , s] = token.split('.');
    const forgedBody = b64url(Buffer.from(JSON.stringify({ ...claims, tier: 'free' })));
    const tampered = `${h}.${forgedBody}.${s}`;
    const res = await verifySeatToken(tampered, publicPem, NOW);
    expect(res.valid).toBe(false);
  });

  it('rejects a malformed token', async () => {
    const res = await verifySeatToken('not.a.jwt.at.all', publicPem, NOW);
    expect(res.valid).toBe(false);
  });

  it('decodeSeatTokenUnsafe reads claims without verifying', () => {
    const token = mintSeatToken(claims, privateKey);
    const decoded = decodeSeatTokenUnsafe(token);
    expect(decoded?.user_id).toBe('user-1');
    expect(decoded?.tier).toBe('practice');
  });
});

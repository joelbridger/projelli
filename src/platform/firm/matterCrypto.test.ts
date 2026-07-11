import { describe, expect, it } from 'vitest';
import {
  decryptUpdateV2, encryptUpdate, encryptUpdateV2, generateMatterKey, importMatterKey,
} from './matterCrypto';

const context = { keyEpoch: 3, matterHandle: `mh2_${'A'.repeat(43)}`, streamHandle: `sh2_${'B'.repeat(43)}` };

describe('v2 matter crypto', () => {
  it('binds each new blob to its opaque matter and stream handle', async () => {
    const key = await importMatterKey(await generateMatterKey());
    const plain = new TextEncoder().encode('encrypted root index');
    const blob = await encryptUpdateV2(key, plain, context);
    expect(await decryptUpdateV2(key, blob, context)).toMatchObject({ ok: true });
    expect(await decryptUpdateV2(key, blob, { ...context, streamHandle: `sh2_${'C'.repeat(43)}` })).toEqual({ ok: false, reason: 'auth_failed' });
    expect(await decryptUpdateV2(key, blob, { ...context, matterHandle: `mh2_${'D'.repeat(43)}` })).toEqual({ ok: false, reason: 'auth_failed' });
  });

  it('reads a legacy blob only during the bounded migration window, then writes v2', async () => {
    const key = await importMatterKey(await generateMatterKey());
    const old = await encryptUpdate(key, new Uint8Array([1, 2]), context.keyEpoch);
    expect(await decryptUpdateV2(key, old, context, true)).toMatchObject({ ok: true });
    expect(await decryptUpdateV2(key, old, context, false)).toEqual({ ok: false, reason: 'bad_version' });
    const current = await encryptUpdateV2(key, new Uint8Array([3]), context);
    expect(current).not.toBe(old);
  });
});

import { describe, expect, it } from 'vitest';
import {
  decryptUpdateV2, encryptUpdateV2, generateMatterKey, importMatterKey,
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

  it('rejects v1 ciphertext without a migration read window', async () => {
    const key = await importMatterKey(await generateMatterKey());
    const v1 = btoa(String.fromCharCode(1, ...new Uint8Array(12 + 16)));
    expect(await decryptUpdateV2(key, v1, context)).toEqual({ ok: false, reason: 'bad_version' });
    const current = await encryptUpdateV2(key, new Uint8Array([3]), context);
    expect(await decryptUpdateV2(key, current, context)).toMatchObject({ ok: true, update: new Uint8Array([3]) });
  });
});

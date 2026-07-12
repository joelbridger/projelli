import { describe, expect, it } from 'vitest';

import {
  deriveAuthToken,
  derivePageKey,
  generateContentKey,
  generateIntakeKeypair,
  generateSubmissionId,
  importContentKey,
  openItemChunk,
  openManifest,
  sealItemChunk,
  sealManifest,
  unwrapContentKey,
  verifySubmissionIdFresh,
  verifySubmissionIntegrity,
  wrapContentKey,
  type SealedManifest,
} from '@/platform/intake/intakeCrypto';

const VERSION = 1;
const EPHEMERAL_PUB_BYTES = 65;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const HEADER_BYTES = 1 + EPHEMERAL_PUB_BYTES + SALT_BYTES + IV_BYTES;
const MATTER_INFO = new TextEncoder().encode('lantern-matter-key-wrap:v1:epoch:1');
const MATTER_AAD = new TextEncoder().encode('epoch:1');

function buf(bytes: Uint8Array): Uint8Array {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes;
  return new Uint8Array(bytes);
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function importRawPub(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    buf(raw) as unknown as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
}

async function exportRawPub(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

async function matterStyleWrappingKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const ikm = await crypto.subtle.importKey('raw', sharedBits, { name: 'HKDF' }, false, [
    'deriveBits',
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(salt) as unknown as BufferSource, info: MATTER_INFO },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function matterStyleWrap(contentKeyB64: string, recipientPubRaw: Uint8Array): Promise<string> {
  const ephemeralPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const recipientPub = await importRawPub(recipientPubRaw);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const wrappingKey = await matterStyleWrappingKey(ephemeralPair.privateKey, recipientPub, salt);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: buf(iv) as unknown as BufferSource, additionalData: buf(MATTER_AAD) as unknown as BufferSource },
      wrappingKey,
      buf(b64ToBytes(contentKeyB64)) as unknown as BufferSource,
    ),
  );
  const ephemeralPubRaw = await exportRawPub(ephemeralPair.publicKey);
  const out = new Uint8Array(HEADER_BYTES + ciphertext.length);
  let offset = 0;
  out[offset] = VERSION;
  offset += 1;
  out.set(ephemeralPubRaw, offset);
  offset += EPHEMERAL_PUB_BYTES;
  out.set(salt, offset);
  offset += SALT_BYTES;
  out.set(iv, offset);
  offset += IV_BYTES;
  out.set(ciphertext, offset);
  return bytesToB64(out);
}

async function matterStyleUnwrap(wrappedB64: string, privateKey: CryptoKey): Promise<string> {
  const raw = b64ToBytes(wrappedB64);
  const ephemeralPubRaw = raw.subarray(1, 1 + EPHEMERAL_PUB_BYTES);
  const salt = raw.subarray(1 + EPHEMERAL_PUB_BYTES, 1 + EPHEMERAL_PUB_BYTES + SALT_BYTES);
  const iv = raw.subarray(
    1 + EPHEMERAL_PUB_BYTES + SALT_BYTES,
    1 + EPHEMERAL_PUB_BYTES + SALT_BYTES + IV_BYTES,
  );
  const ciphertext = raw.subarray(HEADER_BYTES);
  const ephemeralPub = await importRawPub(ephemeralPubRaw);
  const wrappingKey = await matterStyleWrappingKey(privateKey, ephemeralPub, salt);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(iv) as unknown as BufferSource, additionalData: buf(MATTER_AAD) as unknown as BufferSource },
      wrappingKey,
      buf(ciphertext) as unknown as BufferSource,
    ),
  );
  return bytesToB64(plaintext);
}

describe('intake crypto round-trips', () => {
  it('wraps and unwraps a per-item content key', async () => {
    const { privateKey, publicKeyRaw } = await generateIntakeKeypair();
    const contentKeyB64 = await generateContentKey();

    const wrapped = await wrapContentKey(contentKeyB64, publicKeyRaw);
    const unwrapped = await unwrapContentKey(wrapped, privateKey);

    expect(unwrapped).toBe(contentKeyB64);
  });

  it('seals and opens an item chunk with bound intake/item/submission/index ids', async () => {
    const contentKey = await importContentKey(await generateContentKey());
    const ids = { intakeId: 'intake-1', itemId: 'item-1', submissionId: generateSubmissionId(), index: 0 };
    const plaintext = new TextEncoder().encode('front of license');

    const sealed = await sealItemChunk(contentKey, plaintext, ids);
    const opened = await openItemChunk(contentKey, sealed, ids);

    expect(opened.ok).toBe(true);
    if (opened.ok) expect(Array.from(opened.data)).toEqual(Array.from(plaintext));
  });

  it('seals and opens the submission manifest under the reserved manifest AAD', async () => {
    const contentKey = await importContentKey(await generateContentKey());
    const ids = { intakeId: 'intake-1', itemId: 'license', submissionId: generateSubmissionId() };
    const manifest: SealedManifest = {
      submission_id: ids.submissionId,
      item_id: ids.itemId,
      content_type: 'image/jpeg',
      file_names: ['license-front.jpg', 'license-back.jpg'],
      chunk_hashes: ['sha256-front', 'sha256-back'],
      chunk_count: 2,
    };

    const sealed = await sealManifest(contentKey, manifest, ids);
    const opened = await openManifest(contentKey, sealed, ids);

    expect(opened).toEqual({ ok: true, manifest });
  });

  it('derives matching page keys and a 32-byte auth token from the same link secret', async () => {
    const s = crypto.getRandomValues(new Uint8Array(32));
    const pageKeyA = await derivePageKey(s);
    const pageKeyB = await derivePageKey(s);
    const iv = new Uint8Array(12).fill(5);
    const plaintext = new TextEncoder().encode('sealed checklist');

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: buf(iv) as unknown as BufferSource },
      pageKeyA,
      buf(plaintext) as unknown as BufferSource,
    );
    const decrypted = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: buf(iv) as unknown as BufferSource },
        pageKeyB,
        ciphertext,
      ),
    );
    const auth = await deriveAuthToken(s);

    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    expect(auth.tokenBytes).toHaveLength(32);
    expect(auth.tokenB64).toBe(bytesToB64(auth.tokenBytes));
  });
});

describe('intake crypto tamper checks', () => {
  it('fails to open a chunk when any AAD id field changes', async () => {
    const contentKey = await importContentKey(await generateContentKey());
    const ids = { intakeId: 'intake-1', itemId: 'item-1', submissionId: 'sub-1', index: 3 };
    const sealed = await sealItemChunk(contentKey, new TextEncoder().encode('answer'), ids);

    const alteredIds = [
      { ...ids, intakeId: 'intake-2' },
      { ...ids, itemId: 'item-2' },
      { ...ids, submissionId: 'sub-2' },
      { ...ids, index: 4 },
    ];

    for (const altered of alteredIds) {
      await expect(openItemChunk(contentKey, sealed, altered)).resolves.toEqual({
        ok: false,
        reason: 'auth_failed',
      });
    }
  });

  it('keeps intake key wraps isolated from matter key-wrap context in both directions', async () => {
    const { privateKey, publicKeyRaw } = await generateIntakeKeypair();
    const contentKeyB64 = await generateContentKey();

    const intakeWrapped = await wrapContentKey(contentKeyB64, publicKeyRaw);
    await expect(matterStyleUnwrap(intakeWrapped, privateKey)).rejects.toThrow();

    const matterWrapped = await matterStyleWrap(contentKeyB64, publicKeyRaw);
    await expect(unwrapContentKey(matterWrapped, privateKey)).rejects.toThrow();
  });

  it('rejects chunk reorder and transplant across submissions, items, and intakes', async () => {
    const contentKey = await importContentKey(await generateContentKey());
    const ids = { intakeId: 'intake-A', itemId: 'item-P', submissionId: 'submission-X', index: 9 };
    const sealed = await sealItemChunk(contentKey, new TextEncoder().encode('chunk-nine'), ids);

    await expect(openItemChunk(contentKey, sealed, { ...ids, index: 10 })).resolves.toEqual({
      ok: false,
      reason: 'auth_failed',
    });
    await expect(openItemChunk(contentKey, sealed, { ...ids, submissionId: 'submission-Y' })).resolves.toEqual({
      ok: false,
      reason: 'auth_failed',
    });
    await expect(openItemChunk(contentKey, sealed, { ...ids, itemId: 'item-Q' })).resolves.toEqual({
      ok: false,
      reason: 'auth_failed',
    });
    await expect(openItemChunk(contentKey, sealed, { ...ids, intakeId: 'intake-B' })).resolves.toEqual({
      ok: false,
      reason: 'auth_failed',
    });
  });

  it('rejects duplicate submission ids through the dedupe helper', () => {
    const seen = new Set(['submission-1']);

    expect(verifySubmissionIdFresh('submission-1', seen)).toEqual({
      ok: false,
      reason: 'duplicate_submission_id',
    });
    expect(verifySubmissionIdFresh('submission-2', seen)).toEqual({ ok: true });
  });

  it('rejects replay relabeling when plaintext, sealed manifest, and chunk AAD ids do not match', () => {
    const sealedManifest: SealedManifest = {
      submission_id: 'sealed-submission',
      item_id: 'item-1',
      content_type: 'application/json',
      file_names: [],
      chunk_hashes: ['hash-1'],
      chunk_count: 1,
    };

    expect(
      verifySubmissionIntegrity('new-plaintext-submission', sealedManifest, ['sealed-submission']),
    ).toEqual({
      ok: false,
      reason: 'submission_id_mismatch',
    });
  });

  it('accepts matching plaintext, sealed manifest, and chunk AAD submission ids', () => {
    const sealedManifest: SealedManifest = {
      submission_id: 'submission-1',
      item_id: 'item-1',
      content_type: 'application/json',
      file_names: [],
      chunk_hashes: ['hash-1', 'hash-2'],
      chunk_count: 2,
    };

    expect(verifySubmissionIntegrity('submission-1', sealedManifest, ['submission-1', 'submission-1'])).toEqual({
      ok: true,
    });
  });

  it('rejects a sealed manifest with a hostile chunk_count or mismatched hashes', async () => {
    const contentKey = await importContentKey(await generateContentKey());
    const ids = { intakeId: 'intake-1', itemId: 'item-1', submissionId: 'sub-1' };

    const hostile: SealedManifest[] = [
      // chunk_count claims 2 but only 1 hash is present.
      { submission_id: 'sub-1', item_id: 'item-1', content_type: 'application/json', file_names: [], chunk_hashes: ['h1'], chunk_count: 2 },
      // negative count.
      { submission_id: 'sub-1', item_id: 'item-1', content_type: 'application/json', file_names: [], chunk_hashes: [], chunk_count: -1 },
      // non-finite count smuggled past the type via a cast.
      { submission_id: 'sub-1', item_id: 'item-1', content_type: 'application/json', file_names: [], chunk_hashes: [], chunk_count: Number.POSITIVE_INFINITY },
    ];

    for (const manifest of hostile) {
      const sealed = await sealManifest(contentKey, manifest, ids);
      await expect(openManifest(contentKey, sealed, ids)).resolves.toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('accepts bounded document detective records and rejects hostile ones', async () => {
    const contentKey = await importContentKey(await generateContentKey());
    const ids = { intakeId: 'intake-1', itemId: 'item-1', submissionId: 'sub-1' };
    const valid: SealedManifest = {
      submission_id: 'sub-1',
      item_id: 'item-1',
      content_type: 'application/json',
      file_names: [],
      chunk_hashes: [],
      chunk_count: 0,
      document_detective: [{
        tier: 'tier1',
        slot_index: 0,
        warning_reason: 'wrong_doc',
        expected: 'drivers_license',
        observed: 'tax_return',
        kept_anyway: true,
      }],
    };
    const sealedValid = await sealManifest(contentKey, valid, ids);
    await expect(openManifest(contentKey, sealedValid, ids)).resolves.toMatchObject({ ok: true });

    const hostile = {
      ...valid,
      document_detective: [{ ...valid.document_detective?.[0], slot_index: Number.POSITIVE_INFINITY }],
    } as SealedManifest;
    const sealedHostile = await sealManifest(contentKey, hostile, ids);
    await expect(openManifest(contentKey, sealedHostile, ids)).resolves.toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a sealed manifest whose declared ids disagree with the envelope ids', async () => {
    const contentKey = await importContentKey(await generateContentKey());
    const sealIds = { intakeId: 'intake-1', itemId: 'item-1', submissionId: 'sub-1' };
    // Manifest content lies about which item/submission it belongs to.
    const manifest: SealedManifest = {
      submission_id: 'other-sub',
      item_id: 'other-item',
      content_type: 'application/json',
      file_names: [],
      chunk_hashes: ['h1'],
      chunk_count: 1,
    };

    const sealed = await sealManifest(contentKey, manifest, sealIds);
    await expect(openManifest(contentKey, sealed, sealIds)).resolves.toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a submission whose presented chunk count disagrees with the manifest', () => {
    const sealedManifest: SealedManifest = {
      submission_id: 'submission-1',
      item_id: 'item-1',
      content_type: 'application/json',
      file_names: [],
      chunk_hashes: ['h1', 'h2'],
      chunk_count: 2,
    };

    // Only one chunk AAD presented for a two-chunk submission.
    expect(verifySubmissionIntegrity('submission-1', sealedManifest, ['submission-1'])).toEqual({
      ok: false,
      reason: 'chunk_count_mismatch',
    });
  });

  it('returns typed non-throwing errors for malformed chunks', async () => {
    const contentKey = await importContentKey(await generateContentKey());
    const ids = { intakeId: 'intake-1', itemId: 'item-1', submissionId: 'sub-1', index: 0 };
    const badVersion = new Uint8Array(1 + IV_BYTES + 16);
    badVersion[0] = 9;

    await expect(openItemChunk(contentKey, 'not*base64', ids)).resolves.toEqual({
      ok: false,
      reason: 'malformed',
    });
    await expect(openItemChunk(contentKey, bytesToB64(new Uint8Array([VERSION, 1, 2])), ids)).resolves.toEqual({
      ok: false,
      reason: 'malformed',
    });
    await expect(openItemChunk(contentKey, bytesToB64(badVersion), ids)).resolves.toEqual({
      ok: false,
      reason: 'bad_version',
    });
  });
});

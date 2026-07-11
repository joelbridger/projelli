import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createCheckpoint, validateCheckpoint } from '@/platform/crm/checkpoints';
import { sealCheckpointPayload } from '@/platform/crm/checkpoints/checkpointCrypto';
import type { CheckpointSigner, RetainedRawRow } from '@/platform/crm/checkpoints/types';
import { generateMatterKey, importMatterKey } from '@/platform/firm/matterCrypto';

const signer: CheckpointSigner = { deviceId: 'validator-a', sign: async () => 'signed' };
const verifier = { verify: async () => true };
const stream = { orgId: 'org-1', matter_id: 'firm_home', docId: 'crm:workflows' };

async function fixture(): Promise<{ checkpoint: Awaited<ReturnType<typeof createCheckpoint>>; rows: RetainedRawRow[]; key: CryptoKey }> {
  const key = await importMatterKey(await generateMatterKey());
  const doc = new Y.Doc();
  const map = doc.getMap<string>('workflow');
  map.set('status', 'open');
  const row1 = Y.encodeStateAsUpdate(doc);
  const before2 = Y.encodeStateVector(doc);
  map.set('assignee', 'advisor-b');
  const row2 = Y.encodeStateAsUpdate(doc, before2);
  const rows = await Promise.all([row1, row2].map(async (update, index) => ({ cursor: index + 1, ciphertextB64: await sealCheckpointPayload(key, update, 1), keyEpoch: 1 })));
  const checkpoint = await createCheckpoint({ stream, frontier: { cursor: 2 }, keyEpoch: 1, generation: 1, doc, contentKey: key, signer, retentionEligible: true, createdAt: '2026-01-01T00:00:00.000Z' });
  return { checkpoint, rows, key };
}

describe('CRM checkpoint reconstruction validation', () => {
  it('accepts a checkpoint only after independent replay matches its frontier, state vector, and canonical hash', async () => {
    const { checkpoint, rows, key } = await fixture();
    const result = await validateCheckpoint({ checkpoint, retainedRows: rows, contentKey: key, keyEpoch: 1, verifier, receiptSigner: signer, validatedAt: '2026-01-02T00:00:00.000Z' });
    expect(result).toEqual(expect.objectContaining({ ok: true, receipt: expect.objectContaining({ validatorDeviceId: 'validator-a', frontier: { cursor: 2 } }) }));
  });

  it('rejects a self-consistent checkpoint when a retained row before frontier F is missing and blocks validation', async () => {
    const { checkpoint, rows, key } = await fixture();
    const result = await validateCheckpoint({ checkpoint, retainedRows: [rows[0]!], contentKey: key, keyEpoch: 1, verifier, receiptSigner: signer });
    expect(result).toEqual(expect.objectContaining({ ok: false, repairAlert: expect.objectContaining({ code: 'missing_raw_row' }) }));
  });
});

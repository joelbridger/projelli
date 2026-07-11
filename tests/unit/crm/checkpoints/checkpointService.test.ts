import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  encryptUpdate,
  generateMatterKey,
  importMatterKey,
} from '@/platform/firm/matterCrypto';
import {
  canPruneCheckpointBase,
  canRemoveTombstoneAfterRetirement,
  createCheckpoint,
  exportUnsentEditsForRebase,
  retireAndRebaseDevice,
  validateCheckpoint,
  type CheckpointSigner,
  type CheckpointVerifier,
  type OrgDeviceRetentionRecord,
  type RetainedRawRow,
} from '@/platform/crm/checkpoints';

const signer: CheckpointSigner = {
  deviceId: 'device-validator-a',
  // The production adapter is Ed25519. This deterministic test signer makes
  // the protocol test independent of browser Ed25519 support.
  sign: async (payload) => btoa(String.fromCharCode(...payload)),
};
const verifier: CheckpointVerifier = {
  verify: async (deviceId, payload, signatureB64) =>
    deviceId === signer.deviceId &&
    signatureB64 === btoa(String.fromCharCode(...payload)),
};

function update(doc: Y.Doc, mutate: () => void): Uint8Array {
  const before = Y.encodeStateVector(doc);
  mutate();
  return Y.encodeStateAsUpdate(doc, before);
}

async function encryptedRow(
  cursor: number,
  updateBytes: Uint8Array,
  key: CryptoKey
): Promise<RetainedRawRow> {
  return {
    cursor,
    ciphertextB64: await encryptUpdate(key, updateBytes, 7),
    keyEpoch: 7,
  };
}

async function fixture() {
  const key = await importMatterKey(await generateMatterKey());
  const doc = new Y.Doc();
  const values = doc.getMap<string>('values');
  const row1 = update(doc, () => values.set('first', 'yes'));
  const row2 = update(doc, () => values.set('second', 'yes'));
  const row3 = update(doc, () => values.set('third', 'yes'));
  const checkpoint = await createCheckpoint({
    stream: { orgId: 'org-a', matter_id: 'matter-a', docId: 'crm:record' },
    frontier: { cursor: 3 },
    keyEpoch: 7,
    generation: 1,
    doc,
    contentKey: key,
    signer,
    retentionEligible: true,
    createdAt: '2026-07-11T00:00:00.000Z',
  });
  return {
    key,
    checkpoint,
    rawUpdates: [row1, row2, row3],
    rows: await Promise.all([
      encryptedRow(1, row1, key),
      encryptedRow(2, row2, key),
      encryptedRow(3, row3, key),
    ]),
  };
}

describe('CRM checkpoint validation', () => {
  it('rejects a self-consistent checkpoint when one applied raw row is missing under its frontier', async () => {
    const { key, rows, rawUpdates } = await fixture();
    // An attacker can make the manifest, state vector, and hash agree with this
    // incomplete snapshot. Only the contiguous raw-row replay exposes row 2.
    const incompleteDoc = new Y.Doc();
    Y.applyUpdate(incompleteDoc, rawUpdates[0]!);
    Y.applyUpdate(incompleteDoc, rawUpdates[2]!);
    const checkpoint = await createCheckpoint({
      stream: { orgId: 'org-a', matter_id: 'matter-a', docId: 'crm:record' },
      frontier: { cursor: 3 },
      keyEpoch: 7,
      generation: 1,
      doc: incompleteDoc,
      contentKey: key,
      signer,
      retentionEligible: true,
    });

    const result = await validateCheckpoint({
      checkpoint,
      retainedRows: [rows[0]!, rows[2]!],
      contentKey: key,
      keyEpoch: 7,
      verifier,
      receiptSigner: signer,
      validatedAt: '2026-07-11T01:00:00.000Z',
    });

    expect(result).toMatchObject({
      ok: false,
      repairAlert: { code: 'missing_raw_row' },
    });
  });

  it('rejects a corrupted encrypted checkpoint chunk before it can become authoritative', async () => {
    const { key, checkpoint, rows } = await fixture();
    const first = checkpoint.chunks[0]!;
    checkpoint.chunks[0] = {
      ...first,
      ciphertextB64: `${first.ciphertextB64.slice(0, -2)}AA`,
    };

    const result = await validateCheckpoint({
      checkpoint,
      retainedRows: rows,
      contentKey: key,
      keyEpoch: 7,
      verifier,
      receiptSigner: signer,
    });

    expect(result).toMatchObject({
      ok: false,
      repairAlert: { code: 'chunk_corrupt' },
    });
  });

  it('emits a signed receipt only after independent replay matches', async () => {
    const { key, checkpoint, rows } = await fixture();

    const result = await validateCheckpoint({
      checkpoint,
      retainedRows: rows,
      contentKey: key,
      keyEpoch: 7,
      verifier,
      receiptSigner: signer,
      validatedAt: '2026-07-11T01:00:00.000Z',
    });

    expect(result).toMatchObject({
      ok: true,
      receipt: { validatorDeviceId: signer.deviceId, generation: 1 },
    });
  });

  it('requires archive and two independent signed receipts before a relay can prune', () => {
    expect(
      canPruneCheckpointBase({
        archived: false,
        retentionEligible: true,
        validationReceipts: [
          { validatorDeviceId: 'a', signatureB64: 'sig-a' },
          { validatorDeviceId: 'b', signatureB64: 'sig-b' },
        ],
      })
    ).toBe(false);
    expect(
      canPruneCheckpointBase({
        archived: true,
        retentionEligible: true,
        validationReceipts: [
          { validatorDeviceId: 'a', signatureB64: 'sig-a' },
          { validatorDeviceId: 'b', signatureB64: 'sig-b' },
        ],
      })
    ).toBe(true);
  });
});

describe('offline device retirement and rebase', () => {
  it('exports old edits for review instead of merging stale state', async () => {
    const key = await importMatterKey(await generateMatterKey());
    const staleEdit = {
      editId: 'old-edit',
      matter_id: 'matter-a',
      docId: 'crm:record',
      ciphertextB64: 'old-ciphertext',
      keyEpoch: 3,
    };
    const actions: string[] = [];
    const result = await retireAndRebaseDevice({
      orgId: 'org-a',
      deviceId: 'offline-device',
      localEdits: [staleEdit],
      exportKey: key,
      exportKeyEpoch: 7,
      currentKeyEpoch: 8,
      approvedEditIds: new Set(),
      dependencies: {
        discardStaleState: async () => {
          actions.push('discard');
        },
        loadValidatedCheckpoint: async () => {
          actions.push('load');
          return {} as never;
        },
        replayApprovedEdit: async () => {
          actions.push('merge');
        },
      },
    });

    expect(result.replayedEditIds).toEqual([]);
    expect(result.exportFile.ciphertextB64).not.toContain('old-ciphertext');
    expect(actions).toEqual(['discard', 'load']);
    await expect(
      exportUnsentEditsForRebase({
        orgId: 'org-a',
        deviceId: 'offline-device',
        edits: [staleEdit],
        exportKey: key,
        keyEpoch: 7,
      })
    ).resolves.toMatchObject({ orgId: 'org-a' });
  });

  it('keeps tombstones until the stale device has been retired safely', () => {
    const base: {
      orgId: string;
      tombstoneCheckpointGeneration: number;
      devices: OrgDeviceRetentionRecord[];
    } = {
      orgId: 'org-a',
      tombstoneCheckpointGeneration: 4,
      devices: [
        {
          orgId: 'org-a',
          deviceId: 'current',
          state: { status: 'current' as const, checkpointGeneration: 4 },
        },
        {
          orgId: 'org-a',
          deviceId: 'offline',
          state: { status: 'retirement_required' as const },
        },
      ],
    };
    expect(canRemoveTombstoneAfterRetirement(base)).toBe(false);
    base.devices[1] = {
      orgId: 'org-a',
      deviceId: 'offline',
      state: { status: 'retired' },
    };
    expect(canRemoveTombstoneAfterRetirement(base)).toBe(true);
  });
});

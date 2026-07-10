import { describe, expect, it, vi } from 'vitest';

import {
  generateContentKey,
  generateIntakeKeypair,
  importContentKey,
  sealItemChunk,
  sealManifest,
  wrapContentKey,
  type SealedManifest,
} from '@/platform/intake/intakeCrypto';
import { hashPlaintextChunk } from '@/platform/intake/chunkHash';
import {
  IntakeSyncClient,
  type IntakeInboxSubmission,
} from './IntakeSyncClient';

const enc = new TextEncoder();

async function sealedSubmission(
  overrides: Partial<{
    intakeId: string;
    itemId: string;
    submissionId: string;
    sessionId: string;
    manifestSubmissionId: string;
    chunkSubmissionId: string;
    chunkIntakeId: string;
    chunkItemId: string;
    chunkIndex: number;
    manifestChunkHashes: string[];
    payload: unknown;
  }> = {}
): Promise<{ submission: IntakeInboxSubmission; privateKey: CryptoKey }> {
  const intakeId = overrides.intakeId ?? 'intake-1';
  const itemId = overrides.itemId ?? 'ssn';
  const submissionId = overrides.submissionId ?? 'submission-1';
  const manifestSubmissionId = overrides.manifestSubmissionId ?? submissionId;
  const chunkSubmissionId = overrides.chunkSubmissionId ?? submissionId;
  const chunkIntakeId = overrides.chunkIntakeId ?? intakeId;
  const chunkItemId = overrides.chunkItemId ?? itemId;
  const chunkIndex = overrides.chunkIndex ?? 0;
  const { privateKey, publicKeyRaw } = await generateIntakeKeypair();
  const contentKeyB64 = await generateContentKey();
  const contentKey = await importContentKey(contentKeyB64);
  const payload = overrides.payload ?? {
    type: 'fact',
    matter_id: 'matter-1',
    subject: 'primary',
    kind: 'ssn',
    value: { t: 'string', v: '123-45-6789' },
    verification: 'client_stated',
  };
  const payloadBytes = enc.encode(JSON.stringify(payload));
  const chunk = await sealItemChunk(
    contentKey,
    payloadBytes,
    {
      intakeId: chunkIntakeId,
      itemId: chunkItemId,
      submissionId: chunkSubmissionId,
      index: chunkIndex,
    }
  );
  const manifest: SealedManifest = {
    submission_id: manifestSubmissionId,
    item_id: itemId,
    content_type: 'application/vnd.lantern.intake.fact+json',
    file_names: [],
    chunk_hashes: overrides.manifestChunkHashes ?? [
      await hashPlaintextChunk(payloadBytes),
    ],
    chunk_count: 1,
  };
  const manifestCiphertext = await sealManifest(contentKey, manifest, {
    intakeId,
    itemId,
    submissionId,
  });
  const wrapped = await wrapContentKey(contentKeyB64, publicKeyRaw);
  return {
    privateKey,
    submission: {
      cursor: 7,
      intake_id: intakeId,
      item_id: itemId,
      submission_id: submissionId,
      session_id: overrides.sessionId ?? 'session-known',
      submitted_at: '2026-07-10T00:00:00.000Z',
      manifest_ciphertext_b64: manifestCiphertext,
      wrapped_content_key_b64: wrapped,
      chunks: [
        {
          intake_id: chunkIntakeId,
          item_id: chunkItemId,
          submission_id: chunkSubmissionId,
          index: chunkIndex,
          ciphertext_b64: chunk,
        },
      ],
    },
  };
}

describe('IntakeSyncClient', () => {
  it('refetches an unacked submission after a local filing failure, then advances after retry', async () => {
    const built = await sealedSubmission();
    const fetchInbox = vi.fn((sinceCursor: number) =>
      Promise.resolve({
        cursor:
          sinceCursor < built.submission.cursor
            ? built.submission.cursor
            : sinceCursor,
        has_more: false,
        submissions:
          sinceCursor < built.submission.cursor ? [built.submission] : [],
      })
    );
    const relay = {
      fetchInbox,
      ackSubmission: vi.fn(() => Promise.resolve()),
    };
    const routeSubmission = vi
      .fn()
      .mockRejectedValueOnce(new Error('local disk failed'))
      .mockResolvedValueOnce({ factId: 'fact-1' });

    const sync = new IntakeSyncClient({
      relay,
      loadPrivateKey: vi.fn(() => Promise.resolve(built.privateKey)),
      hasSubmission: vi.fn(() => Promise.resolve(false)),
      rememberSubmission: vi.fn(() => Promise.resolve()),
      isKnownSession: vi.fn(() => Promise.resolve(true)),
      rememberSession: vi.fn(() => Promise.resolve()),
      flagSubmission: vi.fn(() => Promise.resolve()),
      routeSubmission,
    });

    await sync.syncOnce();
    expect(relay.ackSubmission).not.toHaveBeenCalled();
    expect(sync.getCursor()).toBe(0);
    expect(fetchInbox).toHaveBeenLastCalledWith(0);

    await sync.syncOnce();
    expect(fetchInbox).toHaveBeenNthCalledWith(2, 0);
    expect(routeSubmission).toHaveBeenCalledTimes(2);
    expect(relay.ackSubmission).toHaveBeenCalledWith(
      'intake-1',
      'submission-1',
      7
    );
    expect(sync.getCursor()).toBe(7);
  });

  it('flags replay mismatches before routing or acking', async () => {
    const built = await sealedSubmission({
      manifestSubmissionId: 'sealed-different',
    });
    const relay = {
      fetchInbox: vi.fn(() =>
        Promise.resolve({
          cursor: 7,
          has_more: false,
          submissions: [built.submission],
        })
      ),
      ackSubmission: vi.fn(() => Promise.resolve()),
    };
    const routeSubmission = vi.fn(() => Promise.resolve({ factId: 'fact-1' }));
    const flagSubmission = vi.fn(() => Promise.resolve());

    const sync = new IntakeSyncClient({
      relay,
      loadPrivateKey: vi.fn(() => Promise.resolve(built.privateKey)),
      hasSubmission: vi.fn(() => Promise.resolve(false)),
      rememberSubmission: vi.fn(() => Promise.resolve()),
      isKnownSession: vi.fn(() => Promise.resolve(true)),
      rememberSession: vi.fn(() => Promise.resolve()),
      flagSubmission,
      routeSubmission,
    });

    const result = await sync.syncOnce();

    expect(result.rejected).toBe(1);
    expect(routeSubmission).not.toHaveBeenCalled();
    expect(relay.ackSubmission).not.toHaveBeenCalled();
    expect(flagSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'integrity_mismatch',
        submissionId: 'submission-1',
      })
    );
  });

  it('flags local filing failures before acking so the relay can redeliver', async () => {
    const built = await sealedSubmission();
    const relay = {
      fetchInbox: vi.fn(() =>
        Promise.resolve({
          cursor: 7,
          has_more: false,
          submissions: [built.submission],
        })
      ),
      ackSubmission: vi.fn(() => Promise.resolve()),
    };
    const flagSubmission = vi.fn(() => Promise.resolve());

    const sync = new IntakeSyncClient({
      relay,
      loadPrivateKey: vi.fn(() => Promise.resolve(built.privateKey)),
      hasSubmission: vi.fn(() => Promise.resolve(false)),
      rememberSubmission: vi.fn(() => Promise.resolve()),
      isKnownSession: vi.fn(() => Promise.resolve(true)),
      rememberSession: vi.fn(() => Promise.resolve()),
      flagSubmission,
      routeSubmission: vi.fn(() => Promise.reject(new Error('answer could not be filed safely'))),
    });

    const result = await sync.syncOnce();

    expect(result.rejected).toBe(1);
    expect(relay.ackSubmission).not.toHaveBeenCalled();
    expect(flagSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'routing_failed',
        submissionId: 'submission-1',
        reason: 'answer could not be filed safely',
      })
    );
    expect(sync.getCursor()).toBe(0);
  });

  it('flags chunks transplanted from another item before routing or acking', async () => {
    const built = await sealedSubmission({
      chunkItemId: 'other-item',
    });
    const relay = {
      fetchInbox: vi.fn(() =>
        Promise.resolve({
          cursor: 7,
          has_more: false,
          submissions: [built.submission],
        })
      ),
      ackSubmission: vi.fn(() => Promise.resolve()),
    };
    const routeSubmission = vi.fn(() => Promise.resolve({ factId: 'fact-1' }));
    const flagSubmission = vi.fn(() => Promise.resolve());

    const sync = new IntakeSyncClient({
      relay,
      loadPrivateKey: vi.fn(() => Promise.resolve(built.privateKey)),
      hasSubmission: vi.fn(() => Promise.resolve(false)),
      rememberSubmission: vi.fn(() => Promise.resolve()),
      isKnownSession: vi.fn(() => Promise.resolve(true)),
      rememberSession: vi.fn(() => Promise.resolve()),
      flagSubmission,
      routeSubmission,
    });

    const result = await sync.syncOnce();

    expect(result.rejected).toBe(1);
    expect(routeSubmission).not.toHaveBeenCalled();
    expect(relay.ackSubmission).not.toHaveBeenCalled();
    expect(flagSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'integrity_mismatch',
        submissionId: 'submission-1',
      })
    );
  });

  it('flags out-of-range chunk indexes before routing or acking', async () => {
    const built = await sealedSubmission({
      chunkIndex: 1,
    });
    const relay = {
      fetchInbox: vi.fn(() =>
        Promise.resolve({
          cursor: 7,
          has_more: false,
          submissions: [built.submission],
        })
      ),
      ackSubmission: vi.fn(() => Promise.resolve()),
    };
    const routeSubmission = vi.fn(() => Promise.resolve({ factId: 'fact-1' }));

    const sync = new IntakeSyncClient({
      relay,
      loadPrivateKey: vi.fn(() => Promise.resolve(built.privateKey)),
      hasSubmission: vi.fn(() => Promise.resolve(false)),
      rememberSubmission: vi.fn(() => Promise.resolve()),
      isKnownSession: vi.fn(() => Promise.resolve(true)),
      rememberSession: vi.fn(() => Promise.resolve()),
      flagSubmission: vi.fn(() => Promise.resolve()),
      routeSubmission,
    });

    const result = await sync.syncOnce();

    expect(result.rejected).toBe(1);
    expect(routeSubmission).not.toHaveBeenCalled();
    expect(relay.ackSubmission).not.toHaveBeenCalled();
  });

  it('flags chunk hash mismatches before routing or acking', async () => {
    const built = await sealedSubmission({
      manifestChunkHashes: ['definitely-not-the-real-hash'],
    });
    const relay = {
      fetchInbox: vi.fn(() =>
        Promise.resolve({
          cursor: 7,
          has_more: false,
          submissions: [built.submission],
        })
      ),
      ackSubmission: vi.fn(() => Promise.resolve()),
    };
    const routeSubmission = vi.fn(() => Promise.resolve({ factId: 'fact-1' }));

    const sync = new IntakeSyncClient({
      relay,
      loadPrivateKey: vi.fn(() => Promise.resolve(built.privateKey)),
      hasSubmission: vi.fn(() => Promise.resolve(false)),
      rememberSubmission: vi.fn(() => Promise.resolve()),
      isKnownSession: vi.fn(() => Promise.resolve(true)),
      rememberSession: vi.fn(() => Promise.resolve()),
      flagSubmission: vi.fn(() => Promise.resolve()),
      routeSubmission,
    });

    const result = await sync.syncOnce();

    expect(result.rejected).toBe(1);
    expect(routeSubmission).not.toHaveBeenCalled();
    expect(relay.ackSubmission).not.toHaveBeenCalled();
  });

  it('flags duplicate and new-device submissions instead of overwriting silently', async () => {
    const built = await sealedSubmission({ sessionId: 'session-new' });
    const relay = {
      fetchInbox: vi.fn(() =>
        Promise.resolve({
          cursor: 7,
          has_more: false,
          submissions: [built.submission],
        })
      ),
      ackSubmission: vi.fn(() => Promise.resolve()),
    };
    const flagSubmission = vi.fn(() => Promise.resolve());

    const sync = new IntakeSyncClient({
      relay,
      loadPrivateKey: vi.fn(() => Promise.resolve(built.privateKey)),
      hasSubmission: vi.fn(() => Promise.resolve(true)),
      rememberSubmission: vi.fn(() => Promise.resolve()),
      isKnownSession: vi.fn(() => Promise.resolve(false)),
      rememberSession: vi.fn(() => Promise.resolve()),
      flagSubmission,
      routeSubmission: vi.fn(() => Promise.resolve({ factId: 'fact-1' })),
    });

    const result = await sync.syncOnce();

    expect(result.duplicates).toBe(1);
    expect(flagSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'duplicate' })
    );
    expect(flagSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'new_device' })
    );
    expect(relay.ackSubmission).toHaveBeenCalledOnce();
  });
});

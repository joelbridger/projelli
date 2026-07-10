import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoutedIntakeSubmission } from './IntakeSyncClient';
import { useIntakeStore, type IntakeRecord } from './intakeStore';
import {
  bindIntakeRelayInbox,
  routeIntakeSubmission,
} from './useIntakeInboxSync';

const enc = new TextEncoder();

function intake(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  return {
    intakeId: 'intake-1',
    matterId: 'matter-1',
    clientFirstName: 'Sarah',
    firmName: 'North Star',
    status: 'active',
    expiresAt: '2026-08-09T00:00:00.000Z',
    checklistVersion: 1,
    items: [{ itemId: 'ssn', label: 'Social Security number', state: 'not_started' }],
    receivedItems: [],
    flags: [],
    knownSessionIds: [],
    knownSubmissionIds: [],
    nudges: [],
    ...overrides,
  };
}

function routedSubmission(body: unknown): RoutedIntakeSubmission {
  return {
    intakeId: 'intake-1',
    itemId: 'ssn',
    submissionId: 'submission-1',
    submittedAt: '2026-07-10T10:00:00.000Z',
    manifest: {
      submission_id: 'submission-1',
      item_id: 'ssn',
      content_type: 'application/json',
      file_names: [],
      chunk_hashes: ['hash'],
      chunk_count: 1,
    },
    plaintextBytes: [enc.encode(JSON.stringify(body))],
    sessionId: 'session-1',
  };
}

describe('useIntakeInboxSync wiring helpers', () => {
  beforeEach(() => {
    useIntakeStore.getState().resetForTests();
  });

  it('binds the relay inbox adapter to one intake id', async () => {
    const relay = {
      fetchInbox: vi.fn().mockResolvedValue({ cursor: 2, has_more: false, submissions: [] }),
      ackSubmission: vi.fn().mockResolvedValue(undefined),
    };

    const adapter = bindIntakeRelayInbox(relay, 'intake-1');

    await expect(adapter.fetchInbox(1)).resolves.toEqual({
      cursor: 2,
      has_more: false,
      submissions: [],
    });
    await adapter.ackSubmission('ignored-by-adapter', 'submission-1', 2);

    expect(relay.fetchInbox).toHaveBeenCalledWith('intake-1', 1);
    expect(relay.ackSubmission).toHaveBeenCalledWith('intake-1', 'submission-1', 2);
  });

  it('routes a typed submission into facts, checklist state, received items, and last activity without storing the value', async () => {
    useIntakeStore.getState().upsertIntake(intake());
    const upsertFact = vi.fn().mockResolvedValue({
      fact_id: 'fact-ssn',
    });

    const current = useIntakeStore.getState().intakesById['intake-1'];
    expect(current).toBeDefined();
    if (!current) throw new Error('Expected the intake to be in the store.');

    await expect(routeIntakeSubmission(routedSubmission({
      item_id: 'ssn',
      item_type: 'typed_field',
      subject: 'primary',
      value: '123-45-6789',
    }), {
      intake: current,
      matterFolderPath: '/workspace/Sarah',
      workspaceService: null,
      upsertFact,
    })).resolves.toEqual({ factId: 'fact-ssn' });

    expect(upsertFact).toHaveBeenCalledWith(expect.objectContaining({
      matter_id: 'matter-1',
      subject: 'primary',
      kind: 'ssn',
      sensitivity: 'restricted',
      value: { t: 'string', v: '123-45-6789' },
      provenance: {
        channel: 'intake_link',
        entered_by: 'client',
        at: '2026-07-10T10:00:00.000Z',
      },
      verification: 'client_stated',
    }));
    const stored = useIntakeStore.getState().intakesById['intake-1'];
    expect(stored).toBeDefined();
    if (!stored) throw new Error('Expected the intake to stay in the store.');
    expect(stored.items[0]).toMatchObject({
      itemId: 'ssn',
      label: 'Social Security number',
      state: 'received',
      factId: 'fact-ssn',
      provenance: {
        channel: 'intake_link',
        label: 'provided by client',
        at: '2026-07-10T10:00:00.000Z',
      },
    });
    expect(stored.receivedItems).toEqual([
      expect.objectContaining({
        itemId: 'ssn',
        label: 'Social Security number',
        factId: 'fact-ssn',
      }),
    ]);
    expect(stored.lastClientActivityAt).toBe('2026-07-10T10:00:00.000Z');
    expect(JSON.stringify(stored)).not.toContain('123-45-6789');
    expect(JSON.stringify(stored)).not.toContain('6789');
  });
});

import { describe, expect, it } from 'vitest';

import {
  migratePersistedIntakeState,
  partializeIntakeStateForPersistence,
  sanitizePersistedIntakeState,
  type IntakeRecord,
  useIntakeStore,
} from './intakeStore';

describe('intakeStore persistence', () => {
  it('keeps live link secrets out of persisted intake state', () => {
    const record = {
      intakeId: 'intake-1',
      matterId: 'matter-1',
      clientFirstName: 'Sarah',
      firmName: 'North Star',
      status: 'active',
      link: 'https://forms.example.test/i/intake-1#v1.live-secret.live-public-key',
      linkSecretB64: 'live-secret',
      secret: 'also-live',
      expiresAt: '2026-08-09T00:00:00.000Z',
      checklistVersion: 1,
      items: [{
        itemId: 'ssn',
        label: 'Social Security number',
        state: 'received',
        factId: 'fact-ssn',
        provenance: { channel: 'intake_link', label: 'typed by client', at: '2026-07-10T00:00:00.000Z' },
      }],
      receivedItems: [{
        itemId: 'ssn',
        label: 'Social Security number',
        factId: 'fact-ssn',
        receivedAt: '2026-07-10T00:00:00.000Z',
        provenance: { channel: 'intake_link', label: 'typed by client', at: '2026-07-10T00:00:00.000Z' },
      }],
      flags: [],
      knownSessionIds: ['session-1'],
      knownSubmissionIds: ['submission-1'],
      nudges: [],
      publicKeyRawB64: 'pub',
      checklistCiphertextB64: 'checklist',
      stateCiphertextB64: 'state',
      lastCursor: 14,
    } satisfies IntakeRecord & {
      linkSecretB64: string;
      secret: string;
    };

    const persisted = partializeIntakeStateForPersistence({
      intakesById: { [record.intakeId]: record },
    });
    const persistedRecord = persisted.intakesById[record.intakeId] as Record<string, unknown>;
    const serialized = JSON.stringify(persisted);

    expect(serialized).not.toContain('#v1.');
    expect(serialized).not.toContain('live-secret');
    expect(persistedRecord).not.toHaveProperty('link');
    expect(persistedRecord).not.toHaveProperty('linkSecretB64');
    expect(persistedRecord).not.toHaveProperty('secret');
    expect(persistedRecord).toMatchObject({
      intakeId: 'intake-1',
      matterId: 'matter-1',
      status: 'active',
      checklistVersion: 1,
      lastCursor: 14,
      nudges: [],
    });
  });

  it('scrubs link secrets from older persisted intake state during hydration', () => {
    const sanitized = sanitizePersistedIntakeState({
      intakesById: {
        'intake-legacy': {
          intakeId: 'intake-legacy',
          matterId: 'matter-1',
          clientFirstName: 'Sarah',
          firmName: 'North Star',
          status: 'active',
          link: 'https://forms.example.test/i/intake-legacy#v1.old-secret.old-public-key',
          linkSecretB64: 'old-secret',
          expiresAt: '2026-08-09T00:00:00.000Z',
          checklistVersion: 1,
          items: [],
          receivedItems: [],
          flags: [],
          knownSessionIds: [],
        },
      },
    });

    const record = sanitized.intakesById['intake-legacy'] as Record<string, unknown>;
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain('#v1.');
    expect(serialized).not.toContain('old-secret');
    expect(record).not.toHaveProperty('link');
    expect(record).not.toHaveProperty('linkSecretB64');
    expect(record).toHaveProperty('nudges', []);
    expect(record).toHaveProperty('knownSubmissionIds', []);
  });

  it('migrates v1 records to v2 defaults without resurrecting links', () => {
    const migrated = migratePersistedIntakeState({
      intakesById: {
        'intake-v1': {
          intakeId: 'intake-v1',
          matterId: 'matter-1',
          clientFirstName: 'Sarah',
          firmName: 'North Star',
          status: 'active',
          link: 'https://forms.example.test/i/intake-v1#v1.secret.pub',
          expiresAt: '2026-08-09T00:00:00.000Z',
          checklistVersion: 1,
          items: [],
          receivedItems: [],
          flags: [],
          knownSessionIds: [],
        },
      },
    }, 1);

    const record = migrated.intakesById['intake-v1'] as Record<string, unknown>;
    expect(record).toMatchObject({
      intakeId: 'intake-v1',
      nudges: [],
      knownSubmissionIds: [],
    });
    expect(record).not.toHaveProperty('link');
    expect(JSON.stringify(migrated)).not.toContain('#v1.');
  });
});

describe('intakeStore actions', () => {
  const baseRecord = (): IntakeRecord => ({
    intakeId: 'intake-1',
    matterId: 'matter-1',
    clientFirstName: 'Sarah',
    firmName: 'North Star',
    status: 'active',
    expiresAt: '2026-08-09T00:00:00.000Z',
    checklistVersion: 1,
    items: [],
    receivedItems: [],
    flags: [],
    knownSessionIds: [],
    knownSubmissionIds: [],
    nudges: [],
  });

  it('defaults new intake records to durable cadence and submission fields', () => {
    useIntakeStore.getState().resetForTests();

    useIntakeStore.getState().upsertIntake({
      ...baseRecord(),
      nudges: undefined as never,
      knownSubmissionIds: undefined as never,
    });

    expect(useIntakeStore.getState().intakesById['intake-1']).toMatchObject({
      nudges: [],
      knownSubmissionIds: [],
    });
  });

  it('records nudge attempts and only advances last client activity', () => {
    useIntakeStore.getState().resetForTests();
    useIntakeStore.getState().upsertIntake(baseRecord());

    useIntakeStore.getState().recordNudgeAttempt('intake-1', {
      sequence: 1,
      at: '2026-07-10T00:00:00.000Z',
      missingItemIds: ['ssn'],
      auditPairId: 'audit-1',
      channel: 'email_draft',
    });
    useIntakeStore.getState().setLastClientActivity('intake-1', '2026-07-09T00:00:00.000Z');
    useIntakeStore.getState().setLastClientActivity('intake-1', '2026-07-08T00:00:00.000Z');
    useIntakeStore.getState().setLastClientActivity('intake-1', '2026-07-11T00:00:00.000Z');

    const record = useIntakeStore.getState().intakesById['intake-1'];
    expect(record?.nudges).toEqual([
      {
        sequence: 1,
        at: '2026-07-10T00:00:00.000Z',
        missingItemIds: ['ssn'],
        auditPairId: 'audit-1',
        channel: 'email_draft',
      },
    ]);
    expect(record?.lastClientActivityAt).toBe('2026-07-11T00:00:00.000Z');
  });

  it('remembers routed submissions durably without duplicates', () => {
    useIntakeStore.getState().resetForTests();
    useIntakeStore.getState().upsertIntake(baseRecord());

    useIntakeStore.getState().rememberSubmission('intake-1', 'submission-1');
    useIntakeStore.getState().rememberSubmission('intake-1', 'submission-1');
    useIntakeStore.getState().rememberSubmission('intake-1', 'submission-2');

    expect(useIntakeStore.getState().intakesById['intake-1']?.knownSubmissionIds).toEqual([
      'submission-1',
      'submission-2',
    ]);
  });
});

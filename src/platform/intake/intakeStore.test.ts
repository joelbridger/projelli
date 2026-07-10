import { describe, expect, it } from 'vitest';

import {
  partializeIntakeStateForPersistence,
  sanitizePersistedIntakeState,
  type IntakeRecord,
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
  });
});

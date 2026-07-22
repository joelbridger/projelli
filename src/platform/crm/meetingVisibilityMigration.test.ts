import { describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from './liveRecords';
import {
  MEETING_VISIBILITY_LEGACY_VALUE,
  MEETING_VISIBILITY_LINEAGE_FIELD,
  MEETING_VISIBILITY_MIGRATION_FIELD,
  MEETING_VISIBILITY_MIGRATION_VERSION,
  migrateCanonicalMeetingVisibility,
} from './meetingVisibilityMigration';

const at = '2026-07-22T18:30:00.000Z';

function meeting(id: string, extra: Record<string, unknown> = {}): LiveCrmRecord {
  return {
    id,
    kind: 'meeting',
    matterId: 'matter-a',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...extra,
  };
}

function preferences(extra: Record<string, unknown> = {}): LiveCrmRecord {
  return {
    id: 'meeting-preferences',
    kind: 'meeting_foundation_preferences',
    matterId: 'firm_home',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    visibilityPolicies: [],
    owners: [],
    deferredDescriptors: [],
    ...extra,
  };
}

function memorySaver(initial: readonly LiveCrmRecord[]) {
  let records = structuredClone(initial) as LiveCrmRecord[];
  const save = vi.fn((record: LiveCrmRecord) => {
    records = records.some((item) => item.id === record.id)
      ? records.map((item) => (item.id === record.id ? structuredClone(record) : item))
      : [...records, structuredClone(record)];
    return Promise.resolve(structuredClone(record));
  });
  return { save, records: () => structuredClone(records) };
}

describe('canonical meeting visibility migration', () => {
  it('labels only genuine pre-feature roots and writes the version sentinel last', async () => {
    const old = meeting('old');
    const restricted = meeting('restricted', { visibilityPolicyId: 'private' });
    const existingPreferences = preferences({ owners: [{ id: 'a', label: 'A' }] });
    const memory = memorySaver([old, restricted, existingPreferences]);

    const result = await migrateCanonicalMeetingVisibility(
      memory.records(), memory.save, () => at
    );

    expect(memory.save.mock.calls.map(([record]) => record.id)).toEqual([
      'old',
      'meeting-preferences',
    ]);
    expect(result.find((record) => record.id === 'old')).toMatchObject({
      [MEETING_VISIBILITY_LINEAGE_FIELD]: MEETING_VISIBILITY_LEGACY_VALUE,
    });
    expect(result.find((record) => record.id === 'restricted')).not.toHaveProperty(
      MEETING_VISIBILITY_LINEAGE_FIELD
    );
    expect(result.find((record) => record.id === 'meeting-preferences')).toMatchObject({
      owners: [{ id: 'a', label: 'A' }],
      [MEETING_VISIBILITY_MIGRATION_FIELD]: MEETING_VISIBILITY_MIGRATION_VERSION,
    });
  });

  it('is idempotent after restart once the sentinel exists', async () => {
    const input = [
      meeting('old', {
        [MEETING_VISIBILITY_LINEAGE_FIELD]: MEETING_VISIBILITY_LEGACY_VALUE,
      }),
      preferences({
        [MEETING_VISIBILITY_MIGRATION_FIELD]:
          MEETING_VISIBILITY_MIGRATION_VERSION,
      }),
    ];
    const save = vi.fn<(record: LiveCrmRecord) => Promise<LiveCrmRecord>>();

    await expect(
      migrateCanonicalMeetingVisibility(input, save, () => at)
    ).resolves.toEqual(input);
    expect(save).not.toHaveBeenCalled();
  });

  it('does not write the sentinel when a meeting save fails and safely resumes', async () => {
    const first = meeting('first');
    const second = meeting('second');
    const pref = preferences();
    let durable = [first, second, pref] as LiveCrmRecord[];
    const firstAttempt = vi.fn((record: LiveCrmRecord) => {
      if (record.id === 'second') return Promise.reject(new Error('disk interrupted'));
      durable = durable.map((item) => (item.id === record.id ? record : item));
      return Promise.resolve(record);
    });

    await expect(
      migrateCanonicalMeetingVisibility(durable, firstAttempt, () => at)
    ).rejects.toThrow('disk interrupted');
    expect(firstAttempt.mock.calls.map(([record]) => record.id)).toEqual([
      'first',
      'second',
    ]);
    expect(durable.find((record) => record.id === 'meeting-preferences')).not.toHaveProperty(
      MEETING_VISIBILITY_MIGRATION_FIELD
    );

    const retry = memorySaver(durable);
    await migrateCanonicalMeetingVisibility(retry.records(), retry.save, () => at);
    expect(retry.save.mock.calls.map(([record]) => record.id)).toEqual([
      'second',
      'meeting-preferences',
    ]);
  });
});

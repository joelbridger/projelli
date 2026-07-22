import { describe, expect, it } from 'vitest';

import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { canReadMeetingDerivedRecord } from '@/platform/meeting-visibility';
import {
  migrateLegacyMeetingArtifactVisibility,
  type ClientScopedLivePort,
} from './contract';

function meeting(
  id: string,
  matterId: string,
  householdRef: string
): LiveCrmRecord {
  return {
    id,
    kind: 'meeting',
    matterId,
    householdRef,
    ownerRef: 'advisor-owner',
    visibilityPolicyId: 'private-policy',
  };
}

function artifact(
  id: string,
  meetingId: string,
  matterId: string,
  householdRef: string
): LiveCrmRecord {
  return {
    id,
    kind: 'meeting_artifact',
    meetingId,
    matterId,
    householdRef,
    artifactKind: 'summary',
    schemaVersion: 1,
    producedAt: '2026-07-20T10:00:00.000Z',
    artifactState: 'produced',
    sourceRefs: [],
    provenance: 'local-processing',
    payload: { summary: `private:${id}` },
  };
}

function migrationPort(initial: readonly LiveCrmRecord[]) {
  let records = structuredClone(initial) as LiveCrmRecord[];
  const savedIds: string[] = [];
  let failOnceFor: string | null = null;
  const port: ClientScopedLivePort = {
    records,
    workspaceRoot: '/workspace',
    error: null,
    getActiveClientBoundary: () => null,
    save(record) {
      if (record.id === failOnceFor) {
        failOnceFor = null;
        return Promise.reject(new Error('simulated interrupted migration'));
      }
      savedIds.push(record.id);
      const saved = structuredClone(record);
      records = records.some((candidate) => candidate.id === saved.id)
        ? records.map((candidate) =>
            candidate.id === saved.id ? saved : candidate
          )
        : [...records, saved];
      return Promise.resolve(structuredClone(saved));
    },
    reloadRecords() {
      return Promise.resolve(structuredClone(records));
    },
  };
  return {
    port,
    savedIds,
    records: () => structuredClone(records),
    failNextSaveFor: (id: string) => {
      failOnceFor = id;
    },
  };
}

const preferences: LiveCrmRecord = {
  id: 'meeting-preferences',
  kind: 'meeting_foundation_preferences',
  visibilityPolicies: [
    {
      id: 'private-policy',
      mode: 'explicit-review',
      includedMemberIds: [],
      excludedMemberIds: ['advisor-excluded'],
    },
  ],
};

describe('legacy meeting artifact visibility migration', () => {
  it('repairs only one exact parent, keeps ambiguity hidden, and marks completion last', async () => {
    const exact = artifact(
      'artifact-exact',
      'meeting-exact',
      'matter-1',
      'household-1'
    );
    const ambiguous = artifact(
      'artifact-ambiguous',
      'meeting-duplicate',
      'matter-2',
      'household-2'
    );
    const fixture = migrationPort([
      preferences,
      meeting('meeting-exact', 'matter-1', 'household-1'),
      exact,
      meeting('meeting-duplicate', 'matter-2', 'household-2'),
      meeting('meeting-duplicate', 'matter-2', 'household-2'),
      ambiguous,
    ]);

    const migrated = await migrateLegacyMeetingArtifactVisibility(fixture.port);
    const repaired = migrated.find((record) => record.id === exact.id);
    const stillAmbiguous = migrated.find(
      (record) => record.id === ambiguous.id
    );
    expect(repaired?.['meetingVisibility']).toEqual({
      kind: 'meeting-artifact',
      id: exact.id,
      lineage: 'derived',
      parentRef: { kind: 'meeting-note', id: 'meeting-exact' },
      ownerRef: 'advisor-owner',
      visibilityPolicyId: 'private-policy',
    });
    expect(stillAmbiguous).not.toHaveProperty('meetingVisibility');
    expect(
      canReadMeetingDerivedRecord(
        stillAmbiguous as LiveCrmRecord,
        'meeting-artifact',
        migrated,
        'advisor-owner'
      )
    ).toBe(false);
    expect(fixture.savedIds.at(-1)).toBe('meeting-artifact-visibility-v1');

    const saveCount = fixture.savedIds.length;
    await migrateLegacyMeetingArtifactVisibility(fixture.port);
    expect(fixture.savedIds).toHaveLength(saveCount);
  });

  it('does not mark a partial run and safely resumes without rewriting completed repairs', async () => {
    const first = artifact(
      'artifact-one',
      'meeting-one',
      'matter-1',
      'household-1'
    );
    const second = artifact(
      'artifact-two',
      'meeting-two',
      'matter-2',
      'household-2'
    );
    const fixture = migrationPort([
      preferences,
      meeting('meeting-one', 'matter-1', 'household-1'),
      first,
      meeting('meeting-two', 'matter-2', 'household-2'),
      second,
    ]);
    fixture.failNextSaveFor(second.id);

    await expect(
      migrateLegacyMeetingArtifactVisibility(fixture.port)
    ).rejects.toThrow('simulated interrupted migration');
    expect(
      fixture
        .records()
        .some(
          (record) => record.kind === 'meeting_artifact_visibility_migration'
        )
    ).toBe(false);
    expect(fixture.savedIds.filter((id) => id === first.id)).toHaveLength(1);

    await migrateLegacyMeetingArtifactVisibility(fixture.port);
    expect(fixture.savedIds.filter((id) => id === first.id)).toHaveLength(1);
    expect(fixture.savedIds.filter((id) => id === second.id)).toHaveLength(1);
    expect(fixture.savedIds.at(-1)).toBe('meeting-artifact-visibility-v1');
  });
});

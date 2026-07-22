import { describe, expect, it } from 'vitest';

import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  canReadMeetingDerivedRecord,
  explicitLegacyMeetingVisibility,
  meetingVisibilityRoot,
  resolveMeetingVisibility,
} from '@/platform/meeting-visibility';
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
  it('keeps missing-policy, malformed, and incomplete lineage hidden unless public is explicit', () => {
    const rootRecord = { ...meeting('meeting-public', 'matter-1', 'household-1') };
    delete rootRecord['visibilityPolicyId'];
    const root = meetingVisibilityRoot(rootRecord);
    if (!root) throw new Error('missing root fixture');
    expect(resolveMeetingVisibility({
      subject: root,
      viewerId: 'advisor-owner',
      policies: [],
      resolveParent: () => null,
    })).toMatchObject({ visible: false, reason: 'missing-policy' });

    const derived = {
      ...artifact('artifact-derived', rootRecord.id, 'matter-1', 'household-1'),
      meetingVisibility: {
        kind: 'meeting-artifact' as const,
        id: 'artifact-derived',
        lineage: 'derived' as const,
        ownerRef: 'advisor-owner',
        parentRef: { kind: 'meeting-note' as const, id: rootRecord.id },
      },
    };
    const malformed = {
      ...artifact('artifact-malformed', rootRecord.id, 'matter-1', 'household-1'),
      meetingVisibility: {
        kind: 'task', id: 'artifact-malformed', lineage: 'legacy-unrestricted',
      },
    };
    const incomplete = artifact(
      'artifact-incomplete', rootRecord.id, 'matter-1', 'household-1'
    );
    const explicitPublic = {
      ...artifact('artifact-public', rootRecord.id, 'matter-1', 'household-1'),
      meetingVisibility: explicitLegacyMeetingVisibility(
        'meeting-artifact', 'artifact-public'
      ),
    };
    const records: LiveCrmRecord[] = [
      rootRecord, derived, malformed, incomplete, explicitPublic,
    ];
    expect(canReadMeetingDerivedRecord(
      derived, 'meeting-artifact', records, 'advisor-owner'
    )).toBe(false);
    expect(canReadMeetingDerivedRecord(
      malformed, 'meeting-artifact', records, 'advisor-owner'
    )).toBe(false);
    expect(canReadMeetingDerivedRecord(
      incomplete, 'meeting-artifact', records, 'advisor-owner'
    )).toBe(false);
    expect(canReadMeetingDerivedRecord(
      explicitPublic, 'meeting-artifact', records, null
    )).toBe(true);
  });

  it('writes the explicit public marker when an exact legacy parent has no policy', async () => {
    const publicMeeting = meeting('meeting-public', 'matter-1', 'household-1');
    delete publicMeeting['visibilityPolicyId'];
    const publicArtifact = artifact(
      'artifact-public', publicMeeting.id, 'matter-1', 'household-1'
    );
    const fixture = migrationPort([publicMeeting, publicArtifact]);
    const migrated = await migrateLegacyMeetingArtifactVisibility(fixture.port);
    expect(migrated.find((record) => record.id === publicArtifact.id)).toMatchObject({
      meetingVisibility: {
        kind: 'meeting-artifact',
        id: publicArtifact.id,
        lineage: 'legacy-unrestricted',
      },
    });
  });

  it('repairs only one exact parent, keeps ambiguity hidden, and does not rewrite completed repairs', async () => {
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
    expect(fixture.savedIds).toEqual([exact.id]);

    const saveCount = fixture.savedIds.length;
    await migrateLegacyMeetingArtifactVisibility(fixture.port);
    expect(fixture.savedIds).toHaveLength(saveCount);
  });

  it('safely resumes a partial run without rewriting completed repairs', async () => {
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
    expect(fixture.savedIds.filter((id) => id === first.id)).toHaveLength(1);

    await migrateLegacyMeetingArtifactVisibility(fixture.port);
    expect(fixture.savedIds.filter((id) => id === first.id)).toHaveLength(1);
    expect(fixture.savedIds.filter((id) => id === second.id)).toHaveLength(1);
    expect(fixture.savedIds.at(-1)).toBe(second.id);
  });
});

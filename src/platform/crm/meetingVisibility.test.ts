import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { LiveCrmRecord } from './liveRecords';
import { filterLiveCrmRecordsByMeetingVisibility } from './meetingVisibility';
import {
  MEETING_VISIBILITY_MIGRATION_FIELD,
  MEETING_VISIBILITY_MIGRATION_VERSION,
} from './meetingVisibilityMigration';

const preferences: LiveCrmRecord = {
  id: 'meeting-foundation-preferences',
  kind: 'meeting_foundation_preferences',
  visibilityPolicies: [
    {
      id: 'private-meeting',
      mode: 'explicit-review',
      includedMemberIds: ['included-advisor'],
      excludedMemberIds: ['excluded-advisor'],
    },
  ],
};

const meeting: LiveCrmRecord = {
  id: 'meeting-1',
  kind: 'meeting',
  matterId: 'matter-1',
  ownerRef: 'owner-advisor',
  visibilityPolicyId: 'private-meeting',
};

const artifact: LiveCrmRecord = {
  id: 'artifact-1',
  kind: 'meeting_artifact',
  matterId: 'matter-1',
  meetingId: meeting.id,
};

const task: LiveCrmRecord = {
  id: 'task-1',
  kind: 'task',
  matterId: 'matter-1',
  contextRefs: [{ kind: 'meeting_artifact', id: artifact.id }],
};

const legacy: LiveCrmRecord = {
  id: 'old-note',
  kind: 'note',
  matterId: 'matter-1',
  body: 'An older ordinary CRM note',
};

const idsFor = (
  records: readonly LiveCrmRecord[],
  viewerId: string | null
): readonly string[] =>
  filterLiveCrmRecordsByMeetingVisibility(records, viewerId).map(
    (record) => record.id
  );

describe('CRM meeting visibility boundary', () => {
  const records = [preferences, meeting, artifact, task, legacy];

  it.each(['owner-advisor', 'included-advisor'])(
    'shows restricted meeting-derived CRM records to %s',
    (viewerId) => {
      expect(idsFor(records, viewerId)).toEqual(
        [meeting, artifact, task, legacy].map((record) => record.id)
      );
    }
  );

  it.each(['excluded-advisor', 'not-included', null])(
    'hides every restricted descendant from %s while preserving genuine legacy CRM data',
    (viewerId) => {
      expect(idsFor(records, viewerId)).toEqual([legacy.id]);
    }
  );

  it('fails closed for a malformed restricted root and a missing exact parent', () => {
    const malformedMeeting = { ...meeting, ownerRef: ' owner-advisor' };
    const orphanTask = {
      ...task,
      id: 'orphan-task',
      contextRefs: [{ kind: 'meeting_artifact', id: 'missing-artifact' }],
    };
    expect(
      idsFor(
        [
          preferences,
          malformedMeeting,
          artifact,
          task,
          orphanTask,
          { ...task, id: 'malformed-task', meetingId: ' meeting-1 ' },
          {
            ...task,
            id: 'malformed-ref-task',
            contextRefs: [{ kind: 'meeting', id: '' }],
          },
          legacy,
        ],
        'owner-advisor'
      )
    ).toEqual([legacy.id]);
  });

  it('does not guess lineage from matching words, dates, or paths', () => {
    const unrelated: LiveCrmRecord = {
      id: 'plain-task',
      kind: 'task',
      title: `Follow up after ${meeting.id}`,
      due: '2026-07-22',
      path: `/Meetings/${meeting.id}`,
    };
    expect(
      idsFor([preferences, meeting, unrelated], 'excluded-advisor')
    ).toEqual([unrelated.id]);
  });

  it('keeps a complete old unrestricted meeting chain usable only by explicit legacy classification', () => {
    const { visibilityPolicyId: _retiredPolicy, ...oldMeetingBase } = meeting;
    const oldMeeting = {
      ...oldMeetingBase,
      id: 'old-meeting',
      meetingVisibilityLineage: 'legacy-unrestricted',
    };
    const oldArtifact = {
      ...artifact,
      id: 'old-artifact',
      meetingId: oldMeeting.id,
    };
    const oldTask = {
      ...task,
      id: 'old-task',
      contextRefs: [{ kind: 'meeting_artifact', id: oldArtifact.id }],
    };
    const oldRecords = [oldMeeting, oldArtifact, oldTask];
    expect(idsFor(oldRecords, null)).toEqual(
      oldRecords.map((record) => record.id)
    );
  });

  it('does not reveal a formerly restricted meeting when its policy field disappears', () => {
    const { visibilityPolicyId: _removedPolicy, ...formerRestricted } = meeting;
    const formerArtifact = { ...artifact, meetingId: formerRestricted.id };
    const formerTask = {
      ...task,
      contextRefs: [{ kind: 'meeting_artifact', id: formerArtifact.id }],
    };

    expect(
      idsFor(
        [preferences, formerRestricted, formerArtifact, formerTask, legacy],
        'owner-advisor'
      )
    ).toEqual([legacy.id]);
  });

  it('keeps a corrupted unmarked meeting hidden after migration completed', () => {
    const migratedPreferences = {
      ...preferences,
      [MEETING_VISIBILITY_MIGRATION_FIELD]:
        MEETING_VISIBILITY_MIGRATION_VERSION,
    };
    const { visibilityPolicyId: _removedPolicy, ...corrupted } = meeting;
    expect(idsFor([migratedPreferences, corrupted, legacy], 'owner-advisor')).toEqual([
      legacy.id,
    ]);
  });

  it('uses internal visibility preferences without returning their secret member IDs', () => {
    const visible = filterLiveCrmRecordsByMeetingVisibility(records, 'owner-advisor');
    expect(visible.some((record) => record.kind === 'meeting_foundation_preferences')).toBe(false);
    expect(JSON.stringify(visible)).not.toContain('included-advisor');
    expect(JSON.stringify(visible)).not.toContain('excluded-advisor');
  });

  it('mechanically reserves the unfiltered doorway for meeting preferences only', () => {
    const sourceRoot = path.join(process.cwd(), 'src');
    const tokens = [
      'unfilteredRecordsForInternalMeetingPreferences',
      'reloadUnfilteredRecordsForInternalMeetingPreferences',
    ];
    const uses = new Map<string, number>();
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(absolute);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) {
          const source = readFileSync(absolute, 'utf8');
          const count = tokens.reduce(
            (total, token) => total + source.split(token).length - 1,
            0
          );
          if (count > 0) uses.set(path.relative(sourceRoot, absolute), count);
        }
      }
    };
    walk(sourceRoot);

    expect(Object.fromEntries(uses)).toEqual({
      'features/meetings/foundation/contract.ts': 2,
      'platform/crm/useLiveCrmRecords.ts': 6,
    });
  });

  it('prevents feature code from reopening the raw CRM collection', () => {
    const featureRoot = path.join(process.cwd(), 'src', 'features');
    const offenders: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(absolute);
        else if (
          /\.(ts|tsx)$/.test(entry.name) &&
          !entry.name.includes('.test.') &&
          readFileSync(absolute, 'utf8').includes('loadLiveCrmRecords')
        ) {
          offenders.push(path.relative(featureRoot, absolute));
        }
      }
    };
    walk(featureRoot);
    expect(offenders).toEqual([]);
  });
});

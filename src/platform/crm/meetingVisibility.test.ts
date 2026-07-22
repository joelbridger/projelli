import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { LiveCrmRecord } from './liveRecords';
import {
  filterLiveCrmRecordsByMeetingVisibility,
  visibleLiveCrmRecordIds,
} from './meetingVisibility';
import {
  derivedMeetingVisibility,
  meetingVisibilityParentForRecord,
  meetingVisibilityRoot,
} from '@/platform/meeting-visibility';
import {
  createMeetingWorkflowProposal,
  createTemplate,
  mergeCrmTaskRecord,
  startWorkflow,
} from '@/features/crm-home';
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

function realNestedWriterRecords() {
  const root = meetingVisibilityRoot(meeting);
  if (!root) throw new Error('fixture meeting root is invalid');
  const nestedArtifact: LiveCrmRecord = {
    id: 'nested-artifact',
    kind: 'meeting_artifact',
    matterId: 'matter-1',
    meetingVisibility: derivedMeetingVisibility(
      'meeting-artifact',
      'nested-artifact',
      root
    ),
  };
  const nestedTask = mergeCrmTaskRecord(
    {
      id: 'nested-task',
      title: 'Private follow-up',
      assigneeUserId: 'owner-advisor',
      status: 'open',
      priority: 'normal',
      tagIds: [],
    },
    undefined,
    'matter-1',
    nestedArtifact
  );
  const taskParent = meetingVisibilityParentForRecord(nestedTask);
  if (!taskParent) throw new Error('fixture task parent is invalid');
  const nestedActivity: LiveCrmRecord = {
    id: 'nested-activity',
    kind: 'activityEvent',
    matterId: 'matter-1',
    verb: 'task.created',
    summary: 'Created private follow-up',
    meetingVisibility: derivedMeetingVisibility(
      'activity',
      'nested-activity',
      taskParent
    ),
  };
  const template = createTemplate('Private service', ['Follow up']);
  const nestedProposal = createMeetingWorkflowProposal(
    nestedActivity,
    template,
    { id: 'household-1', matterId: 'matter-1', label: 'River household' }
  );
  const proposalParent = meetingVisibilityParentForRecord(nestedProposal);
  if (!proposalParent) throw new Error('fixture proposal parent is invalid');
  const nestedWorkflow = startWorkflow(
    template,
    { id: 'household-1', matterId: 'matter-1', label: 'River household' },
    { id: 'nested-workflow', visibilityParent: proposalParent }
  );
  return [
    preferences,
    meeting,
    nestedArtifact,
    nestedTask,
    nestedActivity,
    nestedProposal,
    nestedWorkflow,
    legacy,
  ] as const;
}

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

  it.each(['owner-advisor', 'included-advisor'])(
    'shows nested-only records made by the real task and workflow writers to %s',
    (viewerId) => {
      const records = realNestedWriterRecords();
      expect(idsFor(records, viewerId)).toEqual(
        records
          .filter((record) => record.kind !== 'meeting_foundation_preferences')
          .map((record) => record.id)
      );
    }
  );

  it('removes all real nested descendants from search and Ask allow IDs after exclusion or revocation', () => {
    const records = realNestedWriterRecords();
    const privateIds = records
      .filter((record) => record !== preferences && record !== legacy)
      .map((record) => record.id);
    expect(visibleLiveCrmRecordIds(records, 'excluded-advisor')).toEqual([
      legacy.id,
    ]);
    const revoked = records.map((record) =>
      record === preferences
        ? {
            ...record,
            visibilityPolicies: [
              {
                id: 'private-meeting',
                mode: 'explicit-review',
                includedMemberIds: [],
                excludedMemberIds: [],
              },
            ],
          }
        : record
    );
    const revokedAllowIds = visibleLiveCrmRecordIds(
      revoked as readonly LiveCrmRecord[],
      'included-advisor'
    );
    expect(revokedAllowIds).toEqual([legacy.id]);
    expect(revokedAllowIds).not.toEqual(expect.arrayContaining(privateIds));
  });

  it('fails closed for malformed or conflicting nested visibility instead of treating it as legacy', () => {
    const records = realNestedWriterRecords();
    const nestedTask = records.find((record) => record.id === 'nested-task');
    if (!nestedTask) throw new Error('missing nested task fixture');
    const malformed = {
      ...nestedTask,
      id: 'malformed-nested-task',
      meetingVisibility: {
        ...(nestedTask['meetingVisibility'] as Record<string, unknown>),
        id: ' malformed-nested-task ',
      },
    };
    const conflicting = {
      ...nestedTask,
      id: 'conflicting-nested-task',
      meetingId: 'different-meeting',
      meetingVisibility: {
        ...(nestedTask['meetingVisibility'] as Record<string, unknown>),
        id: 'conflicting-nested-task',
      },
    };
    expect(
      idsFor([...records, malformed, conflicting], 'owner-advisor')
    ).not.toEqual(expect.arrayContaining([malformed.id, conflicting.id]));
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

  it('accepts the real saved legacy artifact shape only through one explicitly legacy parent chain', () => {
    const { visibilityPolicyId: _retiredPolicy, ...oldMeetingBase } = meeting;
    const oldMeeting: LiveCrmRecord = {
      ...oldMeetingBase,
      id: 'saved-old-meeting',
      meetingVisibilityLineage: 'legacy-unrestricted',
    };
    const savedArtifact: LiveCrmRecord = {
      id: 'saved-old-artifact',
      kind: 'meeting_artifact',
      matterId: 'matter-1',
      meetingId: oldMeeting.id,
      meetingVisibility: {
        kind: 'meeting-artifact',
        id: 'saved-old-artifact',
        lineage: 'legacy-unrestricted',
      },
    };
    expect(idsFor([oldMeeting, savedArtifact], null)).toEqual([
      oldMeeting.id,
      savedArtifact.id,
    ]);
    expect(idsFor([savedArtifact], null)).toEqual([]);
    expect(
      idsFor(
        [preferences, meeting, { ...savedArtifact, meetingId: meeting.id }],
        'owner-advisor'
      )
    ).not.toContain(savedArtifact.id);
    expect(
      idsFor([oldMeeting, { ...oldMeeting }, savedArtifact], null)
    ).not.toContain(savedArtifact.id);
  });

  it.each([null, 'broken', [], false])(
    'hides every supported record kind when nested visibility is malformed as %j',
    (brokenVisibility) => {
      const malformed: readonly LiveCrmRecord[] = [
        {
          id: 'bad-artifact',
          kind: 'meeting_artifact',
          meetingId: meeting.id,
          meetingVisibility: brokenVisibility,
        },
        {
          id: 'bad-task',
          kind: 'task',
          source: { origin: 'user', sources: [] },
          meetingVisibility: brokenVisibility,
        },
        {
          id: 'bad-activity',
          kind: 'activityEvent',
          verb: 'task.created',
          meetingVisibility: brokenVisibility,
        },
        {
          id: 'bad-proposal',
          kind: 'proposalRecord',
          source: { origin: 'meeting', sources: [] },
          meetingVisibility: brokenVisibility,
        },
        {
          id: 'bad-workflow',
          kind: 'crm_workflow_instance',
          meetingVisibility: brokenVisibility,
        },
      ];
      expect(
        idsFor([preferences, meeting, ...malformed], 'owner-advisor')
      ).toEqual([meeting.id]);
    }
  );

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
    expect(
      idsFor([migratedPreferences, corrupted, legacy], 'owner-advisor')
    ).toEqual([legacy.id]);
  });

  it('uses internal visibility preferences without returning their secret member IDs', () => {
    const visible = filterLiveCrmRecordsByMeetingVisibility(
      records,
      'owner-advisor'
    );
    expect(
      visible.some((record) => record.kind === 'meeting_foundation_preferences')
    ).toBe(false);
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
        } else if (
          /\.(ts|tsx)$/.test(entry.name) &&
          !entry.name.includes('.test.')
        ) {
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
      'platform/crm/useLiveCrmRecords.ts': 7,
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

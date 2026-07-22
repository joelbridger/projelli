import { describe, expect, it } from 'vitest';
import type { LiveCrmRecord } from './liveRecords';
import { filterLiveCrmRecordsByMeetingVisibility } from './meetingVisibility';

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
        records.map((record) => record.id)
      );
    }
  );

  it.each(['excluded-advisor', 'not-included', null])(
    'hides every restricted descendant from %s while preserving genuine legacy CRM data',
    (viewerId) => {
      expect(idsFor(records, viewerId)).toEqual([preferences.id, legacy.id]);
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
    ).toEqual([preferences.id, legacy.id]);
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
    ).toEqual([preferences.id, unrelated.id]);
  });

  it('keeps a complete old unrestricted meeting chain usable only by explicit legacy classification', () => {
    const { visibilityPolicyId: _retiredPolicy, ...oldMeetingBase } = meeting;
    const oldMeeting = { ...oldMeetingBase, id: 'old-meeting' };
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
});

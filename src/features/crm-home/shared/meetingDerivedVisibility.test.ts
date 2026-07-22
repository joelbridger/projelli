import { describe, expect, it } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  canReadMeetingDerivedRecord,
  derivedMeetingVisibility,
  meetingVisibilityRoot,
} from '@/platform/meeting-visibility';

function records(): LiveCrmRecord[] {
  const meeting: LiveCrmRecord = {
    id: 'meeting-secret',
    kind: 'meeting',
    ownerRef: 'advisor-owner',
    visibilityPolicyId: 'policy-secret',
  };
  const root = meetingVisibilityRoot(meeting);
  if (!root) throw new Error('Expected a meeting visibility root.');
  const artifact: LiveCrmRecord = {
    id: 'artifact-secret',
    kind: 'meeting_artifact',
    title: 'Secret transfer discussion',
    meetingVisibility: derivedMeetingVisibility(
      'meeting-artifact',
      'artifact-secret',
      root
    ),
  };
  const artifactSubject = artifact['meetingVisibility'] as ReturnType<
    typeof derivedMeetingVisibility
  >;
  return [
    {
      id: 'preferences',
      kind: 'meeting_foundation_preferences',
      visibilityPolicies: [
        {
          id: 'policy-secret',
          mode: 'explicit-review',
          includedMemberIds: ['advisor-included'],
          excludedMemberIds: ['coworker-excluded'],
        },
      ],
    },
    meeting,
    artifact,
    {
      id: 'task-secret',
      kind: 'task',
      title: 'Secret transfer discussion',
      body: 'Secret account number',
      meetingVisibility: derivedMeetingVisibility(
        'task',
        'task-secret',
        artifactSubject
      ),
    },
    {
      id: 'activity-secret',
      kind: 'activityEvent',
      at: '2026-07-22T10:00:00.000Z',
      summary: 'Secret transfer discussion',
      meetingVisibility: derivedMeetingVisibility(
        'activity',
        'activity-secret',
        artifactSubject
      ),
    },
    {
      id: 'proposal-secret',
      kind: 'proposalRecord',
      title: 'Secret transfer discussion',
      rationale: 'Secret account number',
      meetingVisibility: derivedMeetingVisibility(
        'proposal',
        'proposal-secret',
        artifactSubject
      ),
    },
    {
      id: 'workflow-secret',
      kind: 'crm_workflow_instance',
      meetingVisibility: derivedMeetingVisibility(
        'workflow',
        'workflow-secret',
        derivedMeetingVisibility('proposal', 'proposal-secret', artifactSubject)
      ),
    },
  ];
}

describe('CRM meeting-derived read boundary', () => {
  it.each([
    ['task-secret', 'task'],
    ['activity-secret', 'activity'],
    ['proposal-secret', 'proposal'],
    ['workflow-secret', 'workflow'],
  ] as const)('hides %s from an excluded coworker', (id, kind) => {
    const snapshot = records();
    const record = snapshot.find((candidate) => candidate.id === id);
    if (!record) throw new Error(`Expected ${id}.`);
    expect(
      canReadMeetingDerivedRecord(
        record,
        kind,
        snapshot,
        'coworker-excluded'
      )
    ).toBe(false);
    expect(
      canReadMeetingDerivedRecord(record, kind, snapshot, 'advisor-owner')
    ).toBe(true);
    expect(
      canReadMeetingDerivedRecord(record, kind, snapshot, 'advisor-included')
    ).toBe(true);
  });

  it('hides missing, conflicting, and malformed parent lineage', () => {
    const snapshot = records();
    const task = snapshot.find((record) => record.id === 'task-secret');
    if (!task) throw new Error('Expected the restricted task.');
    const missing = {
      ...task,
      meetingVisibility: {
        ...(task['meetingVisibility'] as object),
        parentRef: { kind: 'meeting-artifact', id: 'missing-artifact' },
      },
    };
    const conflicting = {
      ...task,
      meetingVisibility: {
        ...(task['meetingVisibility'] as object),
        ownerRef: 'different-owner',
      },
    };
    const malformed = {
      ...task,
      meetingVisibility: { kind: 'task', id: task.id, lineage: 'derived' },
    };

    for (const candidate of [missing, conflicting, malformed]) {
      expect(
        canReadMeetingDerivedRecord(
          candidate,
          'task',
          snapshot,
          'advisor-owner'
        )
      ).toBe(false);
    }
  });

  it('rejects stored visibility whose kind or id does not match its record', () => {
    const snapshot = records();
    const task = snapshot.find((record) => record.id === 'task-secret');
    if (!task) throw new Error('Expected the restricted task.');
    for (const meetingVisibility of [
      { ...(task['meetingVisibility'] as object), kind: 'activity' },
      { ...(task['meetingVisibility'] as object), id: 'different-task' },
    ]) {
      expect(
        canReadMeetingDerivedRecord(
          { ...task, meetingVisibility },
          'task',
          snapshot,
          'advisor-owner'
        )
      ).toBe(false);
    }
  });
});

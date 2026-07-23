import { describe, expect, it, vi } from 'vitest';
import {
  BLESSED_MEETING_PANEL_IDS,
  defaultMeetingPanelComposition,
  getMeetingPanelComposition,
} from '@/features/meetings';
import {
  canReadExactMeetingReviewArtifact,
  createExactMeetingTaskDelivery,
  hasMatchingCompleteMeetingReviewIdentity,
  registerMeetingNotesReviewCompatibilityPanels,
} from './meetingNotesReviewBindings';
import type { TaskRecordStore } from '@/features/crm-tasks';

describe('meeting Tasks/CRM compatibility bindings', () => {
  it('keeps the stable delivery key through a lost task-save reply and retry', async () => {
    let savedId: string | null = null;
    const create = vi.fn<TaskRecordStore['create']>((input) => {
      expect(input.meetingDeliveryKey).toBe('meeting-delivery-abc123');
      if (!savedId) {
        savedId = 'task-meeting-delivery-abc123';
        return Promise.reject(new Error('reply lost'));
      }
      return Promise.resolve({ id: savedId } as Awaited<
        ReturnType<TaskRecordStore['create']>
      >);
    });
    const delivery = createExactMeetingTaskDelivery({ create });
    const request = {
      deliveryKey: 'meeting-delivery-abc123',
      title: 'Call the CPA',
      body: 'Confirm taxes.',
      householdRef: {
        kind: 'household' as const,
        id: 'household-a',
        matterId: 'matter-a',
      },
      assigneeUserId: null,
      status: 'open' as const,
      priority: 'normal' as const,
      contextRefs: [] as const,
      meetingVisibilityParent: {
        kind: 'meeting-artifact' as const,
        id: 'artifact-a',
        lineage: 'legacy-unrestricted' as const,
      },
    };
    await expect(delivery.create(request)).rejects.toThrow('reply lost');
    await expect(delivery.create(request)).resolves.toMatchObject({
      id: 'task-meeting-delivery-abc123',
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map((call) => call[0].meetingDeliveryKey)).toEqual([
      'meeting-delivery-abc123',
      'meeting-delivery-abc123',
    ]);
  });
  it('never treats two missing or partial identities as a matching pair', () => {
    const cases = [
      [
        { id: '', householdRef: '', matterId: '' },
        { householdRef: '', matterId: '' },
      ],
      [
        { id: 'meeting-a', householdRef: '', matterId: 'matter-a' },
        { householdRef: '', matterId: 'matter-a' },
      ],
      [
        { id: 'meeting-a', householdRef: 'household-a', matterId: '' },
        { householdRef: 'household-a', matterId: '' },
      ],
    ] as const;

    for (const [meeting, client] of cases) {
      expect(hasMatchingCompleteMeetingReviewIdentity(meeting, client)).toBe(
        false
      );
    }
    expect(
      hasMatchingCompleteMeetingReviewIdentity(
        {
          id: 'meeting-a',
          householdRef: 'household-a',
          matterId: 'matter-a',
        },
        { householdRef: 'household-a', matterId: 'matter-a' }
      )
    ).toBe(true);
  });

  it('fills the exact F2 slots as contributions without adding base descriptors', () => {
    expect(
      defaultMeetingPanelComposition.panels.map((panel) => panel.id)
    ).not.toContain(BLESSED_MEETING_PANEL_IDS[4]);
    expect(
      defaultMeetingPanelComposition.panels.map((panel) => panel.id)
    ).not.toContain(BLESSED_MEETING_PANEL_IDS[5]);

    registerMeetingNotesReviewCompatibilityPanels();
    const ids = getMeetingPanelComposition().panels.map((panel) => panel.id);
    expect(ids).toContain(BLESSED_MEETING_PANEL_IDS[4]);
    expect(ids).toContain(BLESSED_MEETING_PANEL_IDS[5]);
    expect(
      ids.filter((id) => id === BLESSED_MEETING_PANEL_IDS[4])
    ).toHaveLength(1);
    expect(
      ids.filter((id) => id === BLESSED_MEETING_PANEL_IDS[5])
    ).toHaveLength(1);
  });

  it('uses the current signed-in viewer and policy for every real artifact read', () => {
    const artifact = {
      id: 'artifact-private',
      meetingId: 'meeting-private',
      householdRef: 'household-a',
      matterId: 'matter-a',
      kind: 'action-update-proposal' as const,
      schemaVersion: 2,
      state: 'produced' as const,
      producedAt: '2026-07-22T10:00:00.000Z',
      payload: {},
      meetingVisibility: {
        kind: 'meeting-artifact' as const,
        id: 'artifact-private',
        lineage: 'derived' as const,
        ownerRef: 'advisor-owner',
        visibilityPolicyId: 'private-policy',
        parentRef: { kind: 'meeting-note' as const, id: 'meeting-private' },
      },
    };
    const meeting = {
      id: 'meeting-private',
      ownerRef: 'advisor-owner',
      visibilityPolicyId: 'private-policy',
    };
    const policies = [{
      id: 'private-policy',
      mode: 'explicit-review' as const,
      includedMemberIds: ['advisor-included'],
      excludedMemberIds: ['advisor-excluded'],
    }];
    const canRead = (viewerId: string | null) =>
      canReadExactMeetingReviewArtifact({ artifact, meeting, policies, viewerId });

    expect(canRead('advisor-owner')).toBe(true);
    expect(canRead('advisor-included')).toBe(true);
    expect(canRead('advisor-excluded')).toBe(false);
    expect(canRead(null)).toBe(false);
    // An accountless meeting is explicitly unassigned, never converted into
    // an empty-string owner or treated as owner-private review material.
    expect(
      canReadExactMeetingReviewArtifact({
        artifact,
        meeting: { ...meeting, ownerRef: null },
        policies,
        viewerId: 'advisor-owner',
      })
    ).toBe(false);
    // A viewer switch recomputes from the new firm identity; no old allow leaks.
    expect([canRead('advisor-owner'), canRead('advisor-excluded')]).toEqual([
      true,
      false,
    ]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  makeExactMeetingNotesReviewRepository,
  readExactMeetingReviewFactsForActions,
  type ExactMeetingReviewArtifact,
  type ExactMeetingReviewArtifactReader,
  type ExactMeetingTaskDelivery,
  type NotesReviewCrmDelivery,
} from './notesReviewDelivery';
import type { ExactMeetingTaskReviewItem } from '@/ui/notesReview';

const client = {
  householdRef: 'household-a',
  matterId: 'matter-shared',
  displayName: 'Alpha Household',
};

function artifact(
  overrides: Partial<ExactMeetingReviewArtifact> = {}
): ExactMeetingReviewArtifact {
  return {
    id: 'artifact-a',
    meetingId: 'meeting-a',
    householdRef: client.householdRef,
    matterId: client.matterId,
    kind: 'action-update-proposal',
    schemaVersion: 2,
    state: 'produced',
    producedAt: '2026-07-20T10:00:00.000Z',
    payload: {
      proposal: {
        id: 'task-a',
        kind: 'task',
        title: 'Call the CPA',
        detail: 'Confirm estimated taxes.',
        ownerRef: 'advisor-a',
        dueDate: '2026-08-01',
        transcriptRef: 'meeting:meeting-a#42000',
      },
    },
    ...overrides,
  };
}

function crmArtifact(
  overrides: Partial<ExactMeetingReviewArtifact> = {}
): ExactMeetingReviewArtifact {
  return artifact({
    id: 'artifact-crm',
    payload: {
      proposal: {
        id: 'crm-a',
        kind: 'crm-update',
        title: 'Update risk preference',
        detail: 'Client confirmed balanced growth.',
        transcriptRef: 'meeting:meeting-a#88000',
        entityRef: 'household:household-a',
        fields: [
          {
            field: 'risk_tolerance',
            label: 'Risk tolerance',
            valueType: 'text',
            before: 'Conservative',
            proposed: 'Balanced growth',
          },
        ],
      },
    },
    ...overrides,
  });
}

function ports(
  records: readonly ExactMeetingReviewArtifact[] = [artifact(), crmArtifact()],
  identity: {
    readonly meetingId: string;
    readonly client: typeof client;
  } = { meetingId: 'meeting-a', client }
) {
  const events: string[] = [];
  const listForMeeting = vi.fn(() => records);
  const reader: ExactMeetingReviewArtifactReader = {
    listForMeeting,
  };
  const taskCreate = vi.fn<ExactMeetingTaskDelivery['create']>(() => {
    events.push('task-write');
    return Promise.resolve({ id: 'task-created' });
  });
  const task: ExactMeetingTaskDelivery = {
    create: taskCreate,
  };
  const crmIsConnected = vi.fn(() => {
    events.push('crm-connect-read');
    return Promise.resolve(true);
  });
  const crmSaveProposal = vi.fn(() => {
    events.push('crm-save');
    return Promise.resolve();
  });
  const crmPrepareProposal = vi.fn(() => {
    events.push('crm-prepare');
    return Promise.resolve();
  });
  const crmApproveProposal = vi.fn(() => {
    events.push('crm-write');
    return Promise.resolve({ remoteId: 'remote-1', deduped: false });
  });
  const crm: NotesReviewCrmDelivery = {
    isConnected: crmIsConnected,
    saveProposal: crmSaveProposal,
    prepareProposal: crmPrepareProposal,
    approveProposal: crmApproveProposal,
  };
  const approveArtifact = vi.fn(() => {
    events.push('artifact-approval');
    return Promise.resolve(artifact({ state: 'approved' }));
  });
  const repository = makeExactMeetingNotesReviewRepository({
    meetingId: identity.meetingId,
    client: identity.client,
    artifacts: reader,
    approveArtifact,
    taskDelivery: task,
    crmDelivery: crm,
    now: () => '2026-07-20T10:05:00.000Z',
  });
  return {
    repository,
    listForMeeting,
    taskCreate,
    crmIsConnected,
    crmSaveProposal,
    crmPrepareProposal,
    crmApproveProposal,
    approveArtifact,
    events,
  };
}

const proposedTask: ExactMeetingTaskReviewItem<typeof client> = {
  id: 'task-a',
  artifactId: 'artifact-a',
  meetingId: 'meeting-a',
  client,
  kind: 'task',
  title: 'Call the CPA',
  detail: 'Confirm estimated taxes.',
  ownerRef: 'advisor-a',
  dueDate: '2026-08-01',
  transcriptRef: 'meeting:meeting-a#42000',
  approvalState: 'proposed',
};

const incompleteIdentities = [
  ['empty meeting ID', '', 'household-a', 'matter-shared'],
  ['empty household', 'meeting-a', '', 'matter-shared'],
  ['empty matter', 'meeting-a', 'household-a', ''],
  ['empty meeting and household', '', '', 'matter-shared'],
  ['empty meeting and matter', '', 'household-a', ''],
  ['empty household and matter', 'meeting-a', '', ''],
  ['all identity values empty', '', '', ''],
  ['whitespace-only identity values', '  ', '\t', '\n'],
] as const;

describe('exact meeting notes review reader', () => {
  it.each(incompleteIdentities)(
    'fails closed for %s before any read, approval, task, or CRM call',
    async (_label, meetingId, householdRef, matterId) => {
      const malformedClient = { ...client, householdRef, matterId };
      const lane = ports(undefined, {
        meetingId,
        client: malformedClient,
      });
      const malformedItem = {
        ...proposedTask,
        meetingId,
        client: malformedClient,
      };

      await expect(lane.repository.readFacts()).rejects.toThrow(
        'missing its complete meeting and client identity'
      );
      await expect(lane.repository.list('task')).rejects.toThrow(
        'missing its complete meeting and client identity'
      );
      await expect(lane.repository.approve(malformedItem)).rejects.toThrow(
        'missing its complete meeting and client identity'
      );

      expect(lane.listForMeeting).not.toHaveBeenCalled();
      expect(lane.approveArtifact).not.toHaveBeenCalled();
      expect(lane.taskCreate).not.toHaveBeenCalled();
      expect(lane.crmIsConnected).not.toHaveBeenCalled();
      expect(lane.crmSaveProposal).not.toHaveBeenCalled();
      expect(lane.crmPrepareProposal).not.toHaveBeenCalled();
      expect(lane.crmApproveProposal).not.toHaveBeenCalled();
    }
  );

  it('joins only the exact meeting plus household/matter pair and exposes the same facts to Actions', async () => {
    const wrongMeeting = artifact({
      id: 'wrong-meeting',
      meetingId: 'meeting-b',
    });
    const wrongHousehold = artifact({
      id: 'wrong-household',
      householdRef: 'household-b',
    });
    const wrongMatter = artifact({ id: 'wrong-matter', matterId: 'matter-b' });
    const lane = ports([
      artifact(),
      crmArtifact(),
      wrongMeeting,
      wrongHousehold,
      wrongMatter,
    ]);

    const facts = await readExactMeetingReviewFactsForActions(lane.repository);
    expect(facts).toMatchObject({
      meetingId: 'meeting-a',
      client,
      proposedCount: 2,
      approvedCount: 0,
    });
    expect(facts.tasks.map((item) => item.artifactId)).toEqual(['artifact-a']);
    expect(facts.crmUpdates.map((item) => item.artifactId)).toEqual([
      'artifact-crm',
    ]);
    expect(lane.listForMeeting).toHaveBeenCalledWith('meeting-a', [
      'action-update-proposal',
    ]);
  });

  it('does not write to approval, task, or CRM storage while reading proposals', async () => {
    const lane = ports();
    await lane.repository.list('task');
    await lane.repository.list('crm-update');
    expect(lane.approveArtifact).not.toHaveBeenCalled();
    expect(lane.taskCreate).not.toHaveBeenCalled();
    expect(lane.crmSaveProposal).not.toHaveBeenCalled();
    expect(lane.crmPrepareProposal).not.toHaveBeenCalled();
    expect(lane.crmApproveProposal).not.toHaveBeenCalled();
  });

  it('records approval for the exact artifact before creating the edited task', async () => {
    const lane = ports();
    const item = (await lane.repository.list('task'))[0];
    if (!item || item.kind !== 'task') throw new Error('expected task');
    const receipt = await lane.repository.approve({
      ...item,
      title: 'Call the tax advisor',
      ownerRef: 'advisor-b',
      dueDate: '2026-08-05',
    });

    expect(lane.events).toEqual(['artifact-approval', 'task-write']);
    expect(lane.approveArtifact).toHaveBeenCalledWith('artifact-a', {
      from: 'produced',
      to: 'approved',
      at: '2026-07-20T10:05:00.000Z',
    });
    const createdTask = lane.taskCreate.mock.calls[0]?.[0];
    expect(createdTask).toMatchObject({
      title: 'Call the tax advisor',
      assigneeUserId: 'advisor-b',
      due: '2026-08-05',
      householdRef: {
        id: 'household-a',
        matterId: 'matter-shared',
      },
    });
    expect(receipt.status).toBe('created');
  });

  it('keeps typed CRM before values immutable and sends edited proposed values only after approval', async () => {
    const lane = ports();
    const item = (await lane.repository.list('crm-update'))[0];
    if (!item || item.kind !== 'crm-update') throw new Error('expected CRM');
    const edited = {
      ...item,
      fields: item.fields.map((field) => ({
        ...field,
        proposed: 'Moderate' as const,
      })),
    };
    await lane.repository.approve(edited);

    expect(lane.events).toEqual([
      'crm-connect-read',
      'artifact-approval',
      'crm-save',
      'crm-prepare',
      'crm-write',
    ]);
    expect(lane.crmSaveProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'field',
        matterId: 'matter-shared',
        field: 'risk_tolerance',
        existingValue: 'Conservative',
        newValue: 'Moderate',
        finalValue: 'Moderate',
        sourceRef: 'meeting:meeting-a#88000',
      })
    );

    await expect(
      lane.repository.approve({
        ...item,
        fields: item.fields.map((field) => ({ ...field, before: 'Invented' })),
      })
    ).rejects.toThrow('before values');
  });

  it('rejects a CRM proposal whose producer omitted the real before value', async () => {
    const malformed = artifact({
      payload: {
        proposal: {
          id: 'crm-bad',
          kind: 'crm-update',
          title: 'Update status',
          detail: 'New status.',
          transcriptRef: 'meeting:meeting-a#1',
          entityRef: 'household:household-a',
          fields: [
            {
              field: 'status',
              label: 'Status',
              valueType: 'text',
              proposed: 'Active',
            },
          ],
        },
      },
    });
    const lane = ports([malformed]);
    await expect(lane.repository.list('crm-update')).rejects.toThrow(
      'missing its real before value'
    );
    expect(lane.approveArtifact).not.toHaveBeenCalled();
    expect(lane.crmSaveProposal).not.toHaveBeenCalled();
  });

  it('refuses an item copied from another meeting before recording approval', async () => {
    const lane = ports();
    const item = (await lane.repository.list('task'))[0];
    if (!item) throw new Error('expected task');
    await expect(
      lane.repository.approve({ ...item, meetingId: 'meeting-b' })
    ).rejects.toThrow('does not belong');
    expect(lane.approveArtifact).not.toHaveBeenCalled();
    expect(lane.taskCreate).not.toHaveBeenCalled();
  });

  it('reports a destination failure as already approved rather than proposed again', async () => {
    const lane = ports();
    lane.taskCreate.mockRejectedValueOnce(new Error('Task store unavailable.'));
    const item = (await lane.repository.list('task'))[0];
    if (!item) throw new Error('expected task');

    await expect(lane.repository.approve(item)).rejects.toMatchObject({
      approvalRecorded: true,
      message:
        'Approval was recorded, but delivery failed: Task store unavailable.',
    });
    expect(lane.events).toEqual(['artifact-approval']);
    expect(lane.approveArtifact).toHaveBeenCalledTimes(1);
  });
});

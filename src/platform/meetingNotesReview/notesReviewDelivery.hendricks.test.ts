import { describe, expect, it, vi } from 'vitest';
import { makeNativeHendricksReviewRepository } from './notesReviewDelivery';

const client = { matterId: 'matter_sample_garcia_v_meridian', householdRef: 'sample-hendricks-household' };
const task = { id: 'builtin-hendricks-task-v1', kind: 'meeting_artifact', matterId: client.matterId, householdRef: client.householdRef, meetingId: 'sample-hendricks-annual-review', state: 'produced', payload: { id: 'builtin-hendricks-task-v1', kind: 'task', title: 'Task', detail: 'Detail', transcriptRef: 'source#1', sourceLabel: 'Source', ownerRef: null, dueDate: null } };
const crm = { id: 'builtin-hendricks-crm-v1', kind: 'meeting_artifact', matterId: client.matterId, householdRef: client.householdRef, meetingId: 'sample-hendricks-annual-review', state: 'produced', payload: { id: 'builtin-hendricks-crm-v1', kind: 'crm-update', title: 'CRM', detail: 'Detail', transcriptRef: 'source#1', sourceLabel: 'Source', entityRef: client.householdRef, field: 'annualReviewNote', valueType: 'text', before: '', proposed: 'Changed' } };

describe('native Hendricks review panel route', () => {
  it('does not write before approval and writes each local destination once after approval', async () => {
    const records = [structuredClone(task), structuredClone(crm)];
    const deliverTask = vi.fn(async () => ({ id: 'task-receipt' }));
    const deliverCrm = vi.fn(async () => ({ id: 'crm-receipt' }));
    const repository = makeNativeHendricksReviewRepository({
      meetingId: task.meetingId, client,
      port: {
        view: async () => ({ artifacts: structuredClone(records) }),
        approve: async (id) => { const row = records.find((item) => item.id === id); if (!row) throw new Error('missing'); row.state = 'approved'; return { artifacts: structuredClone(records) }; },
        deliverTask, deliverCrm,
      },
    });
    const [proposedTask] = await repository.list('task');
    const [proposedCrm] = await repository.list('crm-update');
    expect(deliverTask).not.toHaveBeenCalled();
    expect(deliverCrm).not.toHaveBeenCalled();
    await repository.approve(proposedTask!);
    await repository.approve(proposedCrm!);
    expect(deliverTask).toHaveBeenCalledTimes(1);
    expect(deliverCrm).toHaveBeenCalledTimes(1);
  });

  it('refuses a copied renderer payload before native approval or delivery', async () => {
    const approve = vi.fn();
    const deliverTask = vi.fn();
    const repository = makeNativeHendricksReviewRepository({
      meetingId: task.meetingId, client,
      port: { view: async () => ({ artifacts: [task, crm] }), approve, deliverTask, deliverCrm: vi.fn() },
    });
    const [item] = await repository.list('task');
    await expect(repository.approve({ ...item!, detail: 'forged' })).rejects.toThrow('changed');
    expect(approve).not.toHaveBeenCalled();
    expect(deliverTask).not.toHaveBeenCalled();
  });
});

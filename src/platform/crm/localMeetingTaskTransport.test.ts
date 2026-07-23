import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: native.invoke,
}));

import { createLocalMeetingTask } from './localMeetingTaskTransport';

describe('createLocalMeetingTask', () => {
  beforeEach(() => native.invoke.mockReset());

  it('submits only the encrypted artifact identity and approved revision', async () => {
    native.invoke.mockResolvedValue({
      artifactId: 'artifact-a',
      proposalRevision: 'proposal-a',
      deliveryKey: 'meeting-delivery-1a7qczu',
      taskId: 'task-meeting-delivery-1a7qczu',
      status: 'created',
    });

    await expect(createLocalMeetingTask({
      artifactId: 'artifact-a',
      proposalRevision: 'proposal-a',
    })).resolves.toMatchObject({ status: 'created' });
    expect(native.invoke).toHaveBeenCalledWith('crm_local_meeting_task_create', {
      request: {
        artifactId: 'artifact-a',
        proposalRevision: 'proposal-a',
      },
    });
    expect(Object.keys(native.invoke.mock.calls[0]?.[1]?.request ?? [])).toEqual([
      'artifactId',
      'proposalRevision',
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const isTauri = vi.hoisted(() => vi.fn(() => true));
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri }));

import { createLocalMeetingTask } from './localMeetingTaskTransport';

describe('createLocalMeetingTask', () => {
  beforeEach(() => {
    invoke.mockReset();
    isTauri.mockReturnValue(true);
  });

  it('sends only the approved artifact identity and revision', async () => {
    invoke.mockResolvedValue({ status: 'created' });
    await createLocalMeetingTask({ artifactId: 'artifact-a', proposalRevision: 'proposal-a' });
    expect(invoke).toHaveBeenCalledWith('crm_local_meeting_task_create', {
      request: { artifactId: 'artifact-a', proposalRevision: 'proposal-a' },
    });
  });

  it('never creates browser Tasks', async () => {
    isTauri.mockReturnValue(false);
    await expect(createLocalMeetingTask({ artifactId: 'a', proposalRevision: 'p' })).rejects.toThrow('desktop app');
    expect(invoke).not.toHaveBeenCalled();
  });
});

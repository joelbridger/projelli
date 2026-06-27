import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));

import { invoke } from '@tauri-apps/api/core';

describe('calendly-commands', () => {
  beforeEach(() => vi.clearAllMocks());

  it('points the Calendly backend at the workspace', async () => {
    (invoke as any).mockResolvedValue(undefined);
    const { calendlySetWorkspace } = await import('@/platform/utils/calendly-commands');
    await calendlySetWorkspace('/home/u/ws');
    expect(invoke).toHaveBeenCalledWith('calendly_set_workspace', { path: '/home/u/ws' });
  });

  it('connects with a pasted token', async () => {
    (invoke as any).mockResolvedValue({ email: 'a@example.com', userUri: 'https://api.calendly.com/users/u1' });
    const { calendlyConnect } = await import('@/platform/utils/calendly-commands');
    const result = await calendlyConnect('pat');
    expect(invoke).toHaveBeenCalledWith('calendly_connect', { token: 'pat' });
    expect(result.email).toBe('a@example.com');
  });

  it('sync forwards the meeting matter map', async () => {
    (invoke as any).mockResolvedValue({ meetingsIndexed: 1, recordsIndexed: 1 });
    const { calendlySyncAll } = await import('@/platform/utils/calendly-commands');
    const map = [{ meetingKey: 'amelia@example.com', matterId: 'matter-a' }];
    await calendlySyncAll(map);
    expect(invoke).toHaveBeenCalledWith('calendly_sync_all', { matterMap: map });
  });

  it('exports the progress event name', async () => {
    const { CALENDLY_SYNC_EVENT } = await import('@/platform/utils/calendly-commands');
    expect(CALENDLY_SYNC_EVENT).toBe('calendly-sync-progress');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

import { invoke } from '@tauri-apps/api/core';
import {
  wealthboxConnect,
  wealthboxDisconnect,
  wealthboxIsConnected,
  wealthboxListContacts,
  wealthboxSync,
} from '@/platform/utils/wealthbox-commands';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('wealthbox command wrappers', () => {
  it('connect validates and stores through the Rust command', async () => {
    mockInvoke.mockResolvedValueOnce({ connected: true, accountName: 'Advisor' });
    await expect(wealthboxConnect('tok_123')).resolves.toEqual({
      connected: true,
      accountName: 'Advisor',
    });
    expect(mockInvoke).toHaveBeenCalledWith('wealthbox_connect', { token: 'tok_123' });
  });

  it('checks connection status', async () => {
    mockInvoke.mockResolvedValueOnce(true);
    await expect(wealthboxIsConnected()).resolves.toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('wealthbox_is_connected');
  });

  it('disconnects through the Rust command', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await wealthboxDisconnect();
    expect(mockInvoke).toHaveBeenCalledWith('wealthbox_disconnect');
  });

  it('lists lightweight contacts only', async () => {
    mockInvoke.mockResolvedValueOnce([{ id: 'c1', name: 'Avery Stone', type: 'person' }]);
    await expect(wealthboxListContacts()).resolves.toEqual([
      { id: 'c1', name: 'Avery Stone', type: 'person' },
    ]);
    expect(mockInvoke).toHaveBeenCalledWith('wealthbox_list_contacts');
  });

  it('syncs contact mappings with existing matter ids', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await wealthboxSync([{ wealthboxContactId: 'c1', matterId: 'matter_a' }]);
    expect(mockInvoke).toHaveBeenCalledWith('wealthbox_sync', {
      mappings: [{ wealthboxContactId: 'c1', matterId: 'matter_a' }],
    });
  });
});

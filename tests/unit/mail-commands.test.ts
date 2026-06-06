import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(), isTauri: () => true,
}));
import { invoke } from '@tauri-apps/api/core';
import { mailBeginLogin, mailIsConnected } from '@/utils/mail-commands';

describe('mail-commands', () => {
  beforeEach(() => vi.clearAllMocks());
  it('begins login and returns the device-code prompt', async () => {
    (invoke as any).mockResolvedValue({ userCode: 'WXYZ', verificationUri: 'https://microsoft.com/devicelogin', deviceCode: 'DC', intervalSecs: 5 });
    const p = await mailBeginLogin();
    expect(invoke).toHaveBeenCalledWith('mail_begin_login');
    expect(p.userCode).toBe('WXYZ');
  });
  it('reports connection state', async () => {
    (invoke as any).mockResolvedValue(true);
    expect(await mailIsConnected()).toBe(true);
    expect(invoke).toHaveBeenCalledWith('mail_is_connected');
  });
});

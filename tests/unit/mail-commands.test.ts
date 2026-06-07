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
  it('points the mail backend at the workspace', async () => {
    (invoke as any).mockResolvedValue(undefined);
    const { mailSetWorkspace } = await import('@/utils/mail-commands');
    await mailSetWorkspace('/home/u/ws');
    expect(invoke).toHaveBeenCalledWith('mail_set_workspace', { path: '/home/u/ws' });
  });
  it('mail-index-chunk event constant is exported', async () => {
    const { MAIL_INDEX_CHUNK_EVENT } = await import('@/utils/mail-commands');
    expect(MAIL_INDEX_CHUNK_EVENT).toBe('mail-index-chunk');
  });
  it('mailFdeStatus invokes mail_fde_status', async () => {
    (invoke as any).mockResolvedValue({ status: 'on', platform: 'macOS', detail: null });
    const { mailFdeStatus } = await import('@/utils/mail-commands');
    const result = await mailFdeStatus();
    expect(invoke).toHaveBeenCalledWith('mail_fde_status');
    expect(result.status).toBe('on');
  });
});

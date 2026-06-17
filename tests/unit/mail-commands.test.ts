import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(), isTauri: () => true,
}));
import { invoke } from '@tauri-apps/api/core';
import { mailBeginLogin, mailIsConnected } from '@/platform/utils/mail-commands';

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
    const { mailSetWorkspace } = await import('@/platform/utils/mail-commands');
    await mailSetWorkspace('/home/u/ws');
    expect(invoke).toHaveBeenCalledWith('mail_set_workspace', { path: '/home/u/ws' });
  });
  it('mail-index-chunk event constant is exported', async () => {
    const { MAIL_INDEX_CHUNK_EVENT } = await import('@/platform/utils/mail-commands');
    expect(MAIL_INDEX_CHUNK_EVENT).toBe('mail-index-chunk');
  });
  it('mailFdeStatus invokes mail_fde_status', async () => {
    (invoke as any).mockResolvedValue({ status: 'on', platform: 'macOS', detail: null });
    const { mailFdeStatus } = await import('@/platform/utils/mail-commands');
    const result = await mailFdeStatus();
    expect(invoke).toHaveBeenCalledWith('mail_fde_status');
    expect(result.status).toBe('on');
  });

  it('mailGetMessage fetches one decrypted message by id', async () => {
    const msg = {
      id: 'AAMk-1', subject: 'Hi', from: 'a@b.com', to: [], cc: [],
      date: null, provider: 'm365', body: 'body', hasAttachments: false, attachments: [],
    };
    (invoke as any).mockResolvedValue(msg);
    const { mailGetMessage } = await import('@/platform/utils/mail-commands');
    const result = await mailGetMessage('mail:AAMk-1');
    expect(invoke).toHaveBeenCalledWith('mail_get_message', { id: 'mail:AAMk-1' });
    expect(result.subject).toBe('Hi');
  });

  it('mailSyncAll forwards the matter map to the backend', async () => {
    (invoke as any).mockResolvedValue(undefined);
    const { mailSyncAll } = await import('@/platform/utils/mail-commands');
    const map = [{ provider: 'm365', account: 'default', folderId: 'inbox', matterId: 'matter_a' }];
    await mailSyncAll(map);
    // The resolved mail->matter mapping is passed so mail is scoped at index time.
    expect(invoke).toHaveBeenCalledWith('mail_sync_all', { matterMap: map });
  });

  it('mailSyncAll defaults to an empty matter map', async () => {
    (invoke as any).mockResolvedValue(undefined);
    const { mailSyncAll } = await import('@/platform/utils/mail-commands');
    await mailSyncAll();
    expect(invoke).toHaveBeenCalledWith('mail_sync_all', { matterMap: [] });
  });

  it('mailRetagFolderMatter re-tags a folder to a matter', async () => {
    (invoke as any).mockResolvedValue(3);
    const { mailRetagFolderMatter } = await import('@/platform/utils/mail-commands');
    const count = await mailRetagFolderMatter('m365', 'default', 'inbox', 'matter_a');
    expect(invoke).toHaveBeenCalledWith('mail_retag_folder_matter', {
      provider: 'm365', account: 'default', folderId: 'inbox', matterId: 'matter_a',
    });
    expect(count).toBe(3);
  });

  it('mailConnectedAccounts lists connected accounts', async () => {
    (invoke as any).mockResolvedValue([{ provider: 'm365', account: 'default', label: 'Microsoft 365' }]);
    const { mailConnectedAccounts } = await import('@/platform/utils/mail-commands');
    const accts = await mailConnectedAccounts();
    expect(invoke).toHaveBeenCalledWith('mail_connected_accounts');
    expect(accts[0]?.provider).toBe('m365');
  });
});

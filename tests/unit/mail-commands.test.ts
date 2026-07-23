import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(), isTauri: () => true,
}));
import { invoke } from '@tauri-apps/api/core';
import { mailBeginLogin, mailIsConnected } from '@/platform/utils/mail-commands';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import {
  isPendingMailRagRetagSource,
  setPendingMailRagRetagSources,
} from '@/platform/rag/pendingMailRagRetagHold';

const invokeMock = vi.mocked(invoke);

describe('mail-commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ rootPath: null });
    setPendingMailRagRetagSources('/test-workspace', []);
  });
  it('begins login and returns the device-code prompt', async () => {
    invokeMock.mockResolvedValue({ userCode: 'WXYZ', verificationUri: 'https://microsoft.com/devicelogin', deviceCode: 'DC', intervalSecs: 5 });
    const p = await mailBeginLogin();
    expect(invoke).toHaveBeenCalledWith('mail_begin_login');
    expect(p.userCode).toBe('WXYZ');
  });
  it('reports connection state', async () => {
    invokeMock.mockResolvedValue(true);
    expect(await mailIsConnected()).toBe(true);
    expect(invoke).toHaveBeenCalledWith('mail_is_connected');
  });
  it('points the mail backend at the workspace', async () => {
    invokeMock.mockResolvedValue(undefined);
    const { mailSetWorkspace } = await import('@/platform/utils/mail-commands');
    await mailSetWorkspace('/home/u/ws');
    expect(invoke).toHaveBeenCalledWith('mail_set_workspace', { path: '/home/u/ws' });
  });
  it('mail-index-chunk event constant is exported', async () => {
    const { MAIL_INDEX_CHUNK_EVENT } = await import('@/platform/utils/mail-commands');
    expect(MAIL_INDEX_CHUNK_EVENT).toBe('mail-index-chunk');
  });
  it('mailFdeStatus invokes mail_fde_status', async () => {
    invokeMock.mockResolvedValue({ status: 'on', platform: 'macOS', detail: null });
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
    invokeMock.mockResolvedValue(msg);
    const { mailGetMessage } = await import('@/platform/utils/mail-commands');
    const result = await mailGetMessage('mail:AAMk-1');
    expect(invoke).toHaveBeenCalledWith('mail_get_message', { id: 'mail:AAMk-1' });
    expect(result.subject).toBe('Hi');
  });

  it('mailSyncAll forwards the matter map to the backend', async () => {
    invokeMock.mockResolvedValue(undefined);
    const { mailSyncAll } = await import('@/platform/utils/mail-commands');
    const map = [{ provider: 'm365', account: 'default', folderId: 'inbox', matterId: 'matter_a' }];
    await mailSyncAll(map);
    // The resolved mail->matter mapping is passed so mail is scoped at index time.
    // onlyProvider defaults to null (sync every connected provider).
    expect(invoke).toHaveBeenCalledWith('mail_sync_all', { matterMap: map, onlyProvider: null });
  });

  it('mailSyncAll defaults to an empty matter map and a null provider scope', async () => {
    invokeMock.mockResolvedValue(undefined);
    const { mailSyncAll } = await import('@/platform/utils/mail-commands');
    await mailSyncAll();
    expect(invoke).toHaveBeenCalledWith('mail_sync_all', { matterMap: [], onlyProvider: null });
  });

  it('mailSyncAll forwards a single-provider scope when given', async () => {
    invokeMock.mockResolvedValue(undefined);
    const { mailSyncAll } = await import('@/platform/utils/mail-commands');
    await mailSyncAll([], 'gmail');
    // Connecting one account scopes the sync to that provider so it never runs
    // (or fails on) another account's credentials.
    expect(invoke).toHaveBeenCalledWith('mail_sync_all', { matterMap: [], onlyProvider: 'gmail' });
  });

  it('mailRetagFolderMatter re-tags a folder to a matter', async () => {
    invokeMock.mockResolvedValue(3);
    const { mailRetagFolderMatter } = await import('@/platform/utils/mail-commands');
    const count = await mailRetagFolderMatter('m365', 'default', 'inbox', 'matter_a');
    expect(invoke).toHaveBeenCalledWith('mail_retag_folder_matter', {
      provider: 'm365', account: 'default', folderId: 'inbox', matterId: 'matter_a',
    });
    expect(count).toBe(3);
  });

  it('mailRetagMessagesMatter sends one batch IPC request', async () => {
    useWorkspaceStore.setState({ rootPath: '/test-workspace' });
    invokeMock.mockImplementation((command: string) => {
      if (command === 'mail_retag_messages_matter') {
        return Promise.resolve({ filedCount: 513, searchRepairPending: false });
      }
      if (command === 'mail_list_pending_rag_retags') return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const { mailRetagMessagesMatter } = await import('@/platform/utils/mail-commands');
    await expect(mailRetagMessagesMatter(['one', 'two'], 'matter_a')).resolves.toEqual({
      filedCount: 513,
      searchRepairPending: false,
    });
    expect(invoke).toHaveBeenCalledWith('mail_retag_messages_matter', {
      messageIds: ['one', 'two'], matterId: 'matter_a', expectedWorkspace: '/test-workspace',
    });
  });

  it('holds a live filing until it has read the durable repair markers', async () => {
    useWorkspaceStore.setState({ rootPath: '/test-workspace' });
    invokeMock.mockImplementation((command: string) => {
      if (command === 'mail_retag_messages_matter') {
        return Promise.resolve({ filedCount: 2, searchRepairPending: false });
      }
      if (command === 'mail_list_pending_rag_retags') {
        return Promise.resolve([{ messageId: 'one', sourceId: 'mail:one', matterId: 'matter_a' }]);
      }
      return Promise.resolve(undefined);
    });
    const { mailRetagMessagesMatter } = await import('@/platform/utils/mail-commands');

    await expect(mailRetagMessagesMatter(['one', 'two'], 'matter_a')).resolves.toEqual({
      filedCount: 2,
      searchRepairPending: false,
    });

    expect(isPendingMailRagRetagSource('/test-workspace', 'mail:one')).toBe(true);
    expect(isPendingMailRagRetagSource('/test-workspace', 'mail:two')).toBe(false);
  });

  it('keeps a second live filing held while the first refreshes durable markers', async () => {
    useWorkspaceStore.setState({ rootPath: '/test-workspace' });
    let resolveFirst: ((value: { filedCount: number; searchRepairPending: boolean }) => void) | undefined;
    let resolveSecond: ((value: { filedCount: number; searchRepairPending: boolean }) => void) | undefined;
    invokeMock.mockImplementation((command: string, args?: { messageIds?: string[] }) => {
      if (command === 'mail_retag_messages_matter') {
        if (args?.messageIds?.[0] === 'one') {
          return new Promise(resolve => { resolveFirst = resolve; });
        }
        return new Promise(resolve => { resolveSecond = resolve; });
      }
      if (command === 'mail_list_pending_rag_retags') return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const { mailRetagMessagesMatter } = await import('@/platform/utils/mail-commands');

    const first = mailRetagMessagesMatter(['one'], 'matter_a');
    const second = mailRetagMessagesMatter(['two'], 'matter_b');
    await vi.waitFor(() => expect(resolveSecond).toBeDefined());
    resolveFirst?.({ filedCount: 1, searchRepairPending: false });
    await first;

    expect(isPendingMailRagRetagSource('/test-workspace', 'mail:two')).toBe(true);
    resolveSecond?.({ filedCount: 1, searchRepairPending: false });
    await second;
    expect(isPendingMailRagRetagSource('/test-workspace', 'mail:two')).toBe(false);
  });

  it('pins a single interactive filing to the workspace captured before IPC', async () => {
    useWorkspaceStore.setState({ rootPath: '/test-workspace' });
    invokeMock.mockImplementation((command: string) => {
      if (command === 'mail_retag_message_matter') {
        return Promise.resolve({ filedCount: 1, searchRepairPending: false });
      }
      if (command === 'mail_list_pending_rag_retags') return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const { mailRetagMessageMatter } = await import('@/platform/utils/mail-commands');

    await expect(mailRetagMessageMatter('one', 'matter_a')).resolves.toEqual({
      filedCount: 1,
      searchRepairPending: false,
    });
    expect(invoke).toHaveBeenCalledWith('mail_retag_message_matter', {
      messageId: 'one', matterId: 'matter_a', expectedWorkspace: '/test-workspace',
    });
  });

  it('mailConnectedAccounts lists connected accounts', async () => {
    invokeMock.mockResolvedValue([{ provider: 'm365', account: 'default', label: 'Microsoft 365' }]);
    const { mailConnectedAccounts } = await import('@/platform/utils/mail-commands');
    const accts = await mailConnectedAccounts();
    expect(invoke).toHaveBeenCalledWith('mail_connected_accounts');
    expect(accts[0]?.provider).toBe('m365');
  });

  it('mailSend blocks oversized attachments before invoking the backend', async () => {
    const { mailSend } = await import('@/platform/utils/mail-commands');
    await expect(mailSend(
      'm365',
      'default',
      ['client@example.com'],
      [],
      [],
      'Subject',
      'Body',
      undefined,
      [{
        name: 'meeting audio.wav',
        contentType: 'audio/wav',
        contentBase64: 'A'.repeat(Math.ceil(((3 * 1024 * 1024) + 1) / 3) * 4),
      }],
    )).rejects.toThrow('meeting audio.wav');
    expect(invoke).not.toHaveBeenCalledWith('mail_send', expect.anything());
  });

  it('importing or constructing the existing-draft wrapper never sends', async () => {
    const { mailSendExistingDraft } = await import('@/platform/utils/mail-commands');
    const request = {
      provider: 'gmail' as const,
      account: 'default',
      draftId: 'draft-1',
      to: ['client@example.com'],
      cc: [],
      bcc: [],
      subject: 'Private follow-up',
      approvedBodyFingerprint: 'a'.repeat(64),
    };
    expect(typeof mailSendExistingDraft).toBe('function');
    expect(request.draftId).toBe('draft-1');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('uses the exact existing-draft IPC command, arguments, and result shape', async () => {
    invokeMock.mockResolvedValue({
      status: 'outcome-unknown',
      provider: 'gmail',
      reason: 'provider-response-lost',
      doNotRetryAutomatically: true,
    });
    const { mailSendExistingDraft } = await import('@/platform/utils/mail-commands');
    const request = {
      provider: 'gmail' as const,
      account: 'default',
      draftId: 'draft/with+reserved=',
      to: ['client@example.com'],
      cc: ['cc@example.com'],
      bcc: ['bcc@example.com'],
      subject: 'Private follow-up',
      approvedBodyFingerprint: 'b'.repeat(64),
    };
    await expect(mailSendExistingDraft(request)).resolves.toEqual({
      status: 'outcome-unknown',
      provider: 'gmail',
      reason: 'provider-response-lost',
      doNotRetryAutomatically: true,
    });
    expect(invoke).toHaveBeenCalledWith('mail_send_existing_draft', request);
  });

  it('makes a deterministic approved body fingerprint without IPC', async () => {
    const { mailApprovedBodyFingerprint } = await import('@/platform/utils/mail-commands');
    await expect(mailApprovedBodyFingerprint('approved body')).resolves.toBe(
      '97868a14ac2766398b1d4b1746c5e84da494e947cf24c602580cbd5cdcaf181a'
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});

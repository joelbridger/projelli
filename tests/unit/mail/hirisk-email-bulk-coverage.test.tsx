import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: vi.fn(),
  mailGetMessage: vi.fn(),
  mailConnectedAccounts: vi.fn(),
  mailRetagFolderMatter: vi.fn(),
  mailRetagMessageMatter: vi.fn(),
  mailRetagMessagesMatter: vi.fn(),
  mailSend: vi.fn(),
  MAIL_SYNC_EVENT: 'mail-sync-progress',
}));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: vi.fn(),
  useMatters: vi.fn(),
}));

vi.mock('@/platform/firm/privilegeStore', () => ({
  usePrivilegeStore: vi.fn(),
  usePrivilegeForSource: vi.fn(),
}));

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: vi.fn() },
  isMemoryEnabled: vi.fn(),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: vi.fn((matter: { name: string; client?: string }) =>
    matter.client ? `${matter.name} - ${matter.client}` : matter.name,
  ),
}));

vi.mock('@/platform/utils/diagnostics', () => ({
  sendDiagnosticEvent: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => undefined),
}));

import {
  mailListMessages,
  mailGetMessage,
  mailConnectedAccounts,
  mailRetagMessageMatter,
  mailRetagMessagesMatter,
  mailRetagFolderMatter,
} from '@/platform/utils/mail-commands';
import { useActiveMatter, useMatters } from '@/platform/matter/matterStore';
import { usePrivilegeStore, usePrivilegeForSource } from '@/platform/firm/privilegeStore';
import { isMemoryEnabled } from '@/platform/rag/MemoryService';
import { EmailWorkspace } from '@/features/email/EmailWorkspace';

const mockMailListMessages = mailListMessages as ReturnType<typeof vi.fn>;
const mockMailGetMessage = mailGetMessage as unknown as ReturnType<typeof vi.fn>;
const mockMailConnectedAccounts = mailConnectedAccounts as ReturnType<typeof vi.fn>;
const mockMailRetagMessageMatter = mailRetagMessageMatter as ReturnType<typeof vi.fn>;
const mockMailRetagMessagesMatter = mailRetagMessagesMatter as ReturnType<typeof vi.fn>;
const mockMailRetagFolderMatter = mailRetagFolderMatter as ReturnType<typeof vi.fn>;
const mockUseActiveMatter = useActiveMatter as ReturnType<typeof vi.fn>;
const mockUseMatters = useMatters as ReturnType<typeof vi.fn>;
const mockUsePrivilegeForSource = usePrivilegeForSource as ReturnType<typeof vi.fn>;
const mockIsMemoryEnabled = isMemoryEnabled as ReturnType<typeof vi.fn>;

const messages = [
  {
    id: 'msg-alpha',
    subject: 'Contract draft - please review',
    fromAddr: 'alice@example.com',
    fromName: 'Alice Chen',
    snippet: 'See attached draft for your review.',
    receivedDateTime: '2026-06-10T09:00:00Z',
    provider: 'm365',
    account: 'default',
    folderId: 'inbox',
    hasAttachments: true,
  },
  {
    id: 'msg-beta',
    subject: 'Deposition schedule',
    fromAddr: 'bob@lawfirm.com',
    fromName: 'Bob Nguyen',
    snippet: 'Scheduling deposition for next Tuesday.',
    receivedDateTime: '2026-06-09T14:30:00Z',
    provider: 'm365',
    account: 'default',
    folderId: 'inbox',
    hasAttachments: false,
  },
];

async function waitForInitialEmailLoad() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

describe('High-risk email coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();

    mockMailConnectedAccounts.mockResolvedValue([
      { provider: 'm365', account: 'default', label: 'Work' },
    ]);
    mockMailListMessages.mockResolvedValue({
      items: messages,
      total: messages.length,
    });
    mockMailGetMessage.mockImplementation((sourceId: string) => {
      const id = sourceId.startsWith('mail:') ? sourceId.slice('mail:'.length) : sourceId;
      const item = messages.find((candidate) => candidate.id === id) ?? messages[0]!;
      return Promise.resolve({
        id: item.id,
        subject: item.subject,
        from: item.fromName ? `${item.fromName} <${item.fromAddr}>` : item.fromAddr,
        to: ['advisor@example.com'],
        cc: [],
        date: item.receivedDateTime,
        provider: item.provider,
        account: item.account,
        body: item.snippet,
        hasAttachments: item.hasAttachments,
        attachments: [],
        matterId: null,
      });
    });
    mockMailRetagMessageMatter.mockResolvedValue(undefined);
    mockMailRetagMessagesMatter.mockResolvedValue(2);
    mockMailRetagFolderMatter.mockResolvedValue(0);
    mockUseActiveMatter.mockReturnValue(null);
    mockUseMatters.mockReturnValue([
      {
        id: 'matter-acme',
        name: 'Acme v. Beta',
        client: 'Acme Corp',
        folderPaths: [],
        createdAt: '2026-06-01T00:00:00Z',
      },
      {
        id: 'matter-gamma',
        name: 'Gamma Patent',
        client: 'Gamma Inc',
        folderPaths: [],
        createdAt: '2026-06-02T00:00:00Z',
      },
    ]);
    (usePrivilegeStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(vi.fn());
    mockUsePrivilegeForSource.mockReturnValue('none');
    mockIsMemoryEnabled.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('EMAIL-31 files multiple selected emails to the chosen matter and clears selection', async () => {
    render(<EmailWorkspace />);
    await waitForInitialEmailLoad();

    expect(screen.getAllByTestId(/^email-rail-row-/)).toHaveLength(2);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Contract draft - please review' }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Deposition schedule' }));

    expect(screen.getByTestId('bulk-action-bar')).toHaveTextContent('2 selected');

    fireEvent.click(screen.getByTestId('bulk-file-to-matter'));
    expect(screen.getByTestId('bulk-matter-picker-search')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('bulk-matter-choice-matter-acme'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockMailRetagMessagesMatter).toHaveBeenCalledTimes(1);
    expect(mockMailRetagMessagesMatter).toHaveBeenCalledWith(
      ['msg-alpha', 'msg-beta'],
      'matter-acme',
    );
    expect(mockMailRetagMessageMatter).not.toHaveBeenCalled();
    expect(mockMailRetagFolderMatter).not.toHaveBeenCalled();
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });
});

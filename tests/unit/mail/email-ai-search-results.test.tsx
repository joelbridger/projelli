/// <reference types="@testing-library/jest-dom" />
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: vi.fn(),
  mailGetMessage: vi.fn(),
  mailConnectedAccounts: vi.fn(),
  mailRetagFolderMatter: vi.fn(),
  mailRetagMessageMatter: vi.fn(),
  mailSend: vi.fn(),
  MAIL_SYNC_EVENT: 'mail-sync-progress',
}));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: vi.fn(() => null),
  useMatters: vi.fn(() => []),
  useMatterStore: vi.fn(),
}));

vi.mock('@/platform/firm/privilegeStore', () => ({
  usePrivilegeStore: vi.fn(() => vi.fn()),
  usePrivilegeForSource: vi.fn(() => 'none'),
}));

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: vi.fn() },
  isMemoryEnabled: vi.fn(() => true),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: vi.fn((m: { name: string }) => m.name),
}));

vi.mock('@/platform/utils/diagnostics', () => ({
  sendDiagnosticEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  mailListMessages,
  mailGetMessage,
  mailConnectedAccounts,
} from '@/platform/utils/mail-commands';
import { MemoryService } from '@/platform/rag/MemoryService';
import { EmailWorkspace } from '@/features/email/EmailWorkspace';

const mockMailListMessages = mailListMessages as ReturnType<typeof vi.fn>;
const mockMailGetMessage = mailGetMessage as unknown as ReturnType<typeof vi.fn>;
const mockMailConnectedAccounts = mailConnectedAccounts as ReturnType<typeof vi.fn>;
const mockRetrieve = MemoryService.retrieve as ReturnType<typeof vi.fn>;

const MAIL_ITEM = {
  id: 'msg-ask-1',
  subject: 'Deposition follow-up from opposing counsel',
  fromAddr: 'opposing@example.com',
  fromName: 'Opposing Counsel',
  snippet: 'The deposition date moved to Tuesday.',
  receivedDateTime: '2026-06-17T16:00:00Z',
  provider: 'm365',
  account: 'default',
  folderId: 'inbox',
  hasAttachments: false,
};

async function waitForInitialLoad() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

async function openEmailActionsMenu() {
  fireEvent.pointerDown(screen.getByTestId('email-more-actions'), { button: 0 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('EmailWorkspace AI search results', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockMailConnectedAccounts.mockResolvedValue([
      { provider: 'm365', account: 'default', label: 'Work' },
    ]);
    mockMailListMessages.mockResolvedValue({ items: [MAIL_ITEM], total: 1 });
    mockMailGetMessage.mockResolvedValue({
      id: MAIL_ITEM.id,
      subject: MAIL_ITEM.subject,
      from: `${MAIL_ITEM.fromName} <${MAIL_ITEM.fromAddr}>`,
      to: ['advisor@example.com'],
      cc: [],
      date: MAIL_ITEM.receivedDateTime,
      provider: MAIL_ITEM.provider,
      account: MAIL_ITEM.account,
      body: MAIL_ITEM.snippet,
      hasAttachments: MAIL_ITEM.hasAttachments,
      attachments: [],
      matterId: null,
    });
    mockRetrieve.mockResolvedValue([
      {
        id: 'hit-mail-1',
        path: 'mail:msg-ask-1',
        sourceId: 'mail:msg-ask-1',
        chunkText: 'The email says the deposition date moved to Tuesday.',
        score: 0.91,
      },
      {
        id: 'hit-file-1',
        path: '/matters/notes.md',
        sourceId: '/matters/notes.md',
        chunkText: 'A non-email hit should not render here.',
        score: 0.99,
      },
    ]);
  });

  it('renders AI search hit cards from mocked email memory results', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    await openEmailActionsMenu();
    vi.useRealTimers();
    fireEvent.click(screen.getByTestId('mode-ask'));
    fireEvent.click(screen.getByTestId('email-search-input-toggle'));
    fireEvent.change(screen.getByTestId('email-search-input'), {
      target: { value: 'what happened with the deposition?' },
    });

    expect(await screen.findByTestId('ask-hit-card')).toBeInTheDocument();

    expect(mockRetrieve).toHaveBeenCalledWith(
      'what happened with the deposition?',
      10,
      { kind: 'allMatters' },
      false,
    );
    expect(screen.getByTestId('ask-hit-card')).toHaveTextContent('Deposition follow-up from opposing counsel');
    expect(screen.getByTestId('ask-hit-card')).toHaveTextContent('The email says the deposition date moved to Tuesday.');
    expect(screen.queryByText('A non-email hit should not render here.')).not.toBeInTheDocument();
  });
});

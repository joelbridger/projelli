/**
 * ComposeEscapeClose — unit test.
 *
 * Verifies that pressing Escape while the compose modal is open dismisses it,
 * matching the behaviour of the X close button.
 */

/// <reference types="@testing-library/jest-dom" />
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ── Module mocks (mirrors ReimaginedEmailWorkspace.test.tsx) ────────────────

vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: vi.fn(),
  mailGetMessage: vi.fn(),
  mailConnectedAccounts: vi.fn(),
  mailRetagFolderMatter: vi.fn(),
  mailRetagMessageMatter: vi.fn(),
  mailSend: vi.fn(),
}));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: vi.fn(),
  useMatters: vi.fn(),
  useMatterStore: vi.fn(),
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
  matterLabel: vi.fn((m: { name: string }) => m.name),
}));

// ── Imports after mocks ─────────────────────────────────────────────────────

import {
  mailListMessages,
  mailGetMessage,
  mailConnectedAccounts,
  mailSend,
} from '@/platform/utils/mail-commands';
import { useActiveMatter, useMatters } from '@/platform/matter/matterStore';
import { usePrivilegeStore, usePrivilegeForSource } from '@/platform/firm/privilegeStore';
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import { EmailWorkspace } from '@/features/email/EmailWorkspace';

// ── Fixture data ────────────────────────────────────────────────────────────

const FIXTURE_ACCOUNTS = [{ provider: 'm365', account: 'default', label: 'Work' }];

const FIXTURE_ITEMS = [
  {
    id: 'msg-001',
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
];

const FIXTURE_MATTERS = [
  {
    id: 'matter-1',
    name: 'Acme v. Beta',
    client: 'Acme Corp',
    folderPaths: [],
    createdAt: '2026-01-01T00:00:00Z',
  },
];

// ── Setup ───────────────────────────────────────────────────────────────────

const mockSetPrivilege = vi.fn();

function setupDefaultMocks() {
  vi.clearAllMocks();

  (mailConnectedAccounts as ReturnType<typeof vi.fn>).mockResolvedValue(FIXTURE_ACCOUNTS);
  (mailListMessages as ReturnType<typeof vi.fn>).mockResolvedValue({
    items: FIXTURE_ITEMS,
    total: FIXTURE_ITEMS.length,
  });
  (mailGetMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: FIXTURE_ITEMS[0]!.id,
    subject: FIXTURE_ITEMS[0]!.subject,
    from: `${FIXTURE_ITEMS[0]!.fromName} <${FIXTURE_ITEMS[0]!.fromAddr}>`,
    to: ['advisor@example.com'],
    cc: [],
    date: FIXTURE_ITEMS[0]!.receivedDateTime,
    provider: FIXTURE_ITEMS[0]!.provider,
    account: FIXTURE_ITEMS[0]!.account,
    body: FIXTURE_ITEMS[0]!.snippet,
    hasAttachments: FIXTURE_ITEMS[0]!.hasAttachments,
    attachments: [],
    matterId: null,
  });
  (mailSend as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('sent-ok');
  (useActiveMatter as ReturnType<typeof vi.fn>).mockReturnValue(null);
  (useMatters as ReturnType<typeof vi.fn>).mockReturnValue(FIXTURE_MATTERS);
  (usePrivilegeStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockSetPrivilege);
  (usePrivilegeForSource as ReturnType<typeof vi.fn>).mockReturnValue('none');
  (isMemoryEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
  (MemoryService.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue([]);
}

async function waitForInitialLoad() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

beforeEach(() => {
  setupDefaultMocks();
  vi.useFakeTimers();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Compose modal — Escape key closes it', () => {

  it('closes the compose modal when Escape is pressed while it is open', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    // Compose modal should not be visible yet.
    expect(screen.queryByTestId('compose-close')).not.toBeInTheDocument();
    expect(screen.queryByTestId('compose-to')).not.toBeInTheDocument();

    // Open the compose modal.
    fireEvent.click(screen.getByTestId('compose-btn'));

    expect(screen.getByTestId('compose-close')).toBeInTheDocument();
    expect(screen.getByTestId('compose-to')).toBeInTheDocument();

    // Press Escape — modal should close.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(screen.queryByTestId('compose-close')).not.toBeInTheDocument();
    expect(screen.queryByTestId('compose-to')).not.toBeInTheDocument();
  });

  it('does not error when Escape is pressed while compose is closed', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    // Escape with no modal open — should be a no-op.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(screen.queryByTestId('compose-close')).not.toBeInTheDocument();
  });

});

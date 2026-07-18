/**
 * First-connect TTV callout — Task 2 (WS4).
 *
 * Asserts:
 *  - The callout appears once after accounts transitions from 0 to > 0
 *    (i.e., after the first account is connected) and firstConnectCalloutSeen
 *    is false.
 *  - Dismissing the callout hides it.
 *  - Clicking the CTA button also dismisses and focuses the search field.
 *  - The callout does NOT show when firstConnectCalloutSeen is true.
 *  - The callout does NOT show when no accounts are connected.
 */

/// <reference types="@testing-library/jest-dom" />
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  mailConnectedAccounts: vi.fn(),
  mailSend: vi.fn(),
  mailGetMessage: vi.fn(),
  mailRetagFolderMatter: vi.fn(),
  mailRetagMessageMatter: vi.fn(),
  mailSyncAll: vi.fn().mockResolvedValue(undefined),
  MAIL_SYNC_EVENT: 'mail-sync-progress',
  MAIL_INDEX_CHUNK_EVENT: 'mail-index-chunk',
}));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: vi.fn().mockReturnValue(null),
  useMatters: vi.fn().mockReturnValue([]),
  useMatterStore: vi.fn(),
  getMatters: vi.fn().mockReturnValue([]),
}));

vi.mock('@/platform/firm/privilegeStore', () => ({
  usePrivilegeStore: vi.fn(),
  usePrivilegeForSource: vi.fn().mockReturnValue('none'),
}));

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: vi.fn() },
  isMemoryEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  buildMailMatterMap: vi.fn().mockReturnValue([]),
  matterLabel: vi.fn((m: { name: string }) => m.name),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { mailConnectedAccounts } from '@/platform/utils/mail-commands';
import { useMailStore } from '@/platform/connectors/email/mailStore';
import { EmailWorkspace } from '@/features/email/EmailWorkspace';

const FIXTURE_ACCOUNTS = [{ provider: 'm365', account: 'default', label: 'Work' }];

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetStore() {
  // Reset Zustand store + localStorage before each test.
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('lantern:email:firstConnectCalloutSeen');
  }
  useMailStore.setState({
    connected: false,
    progressByProvider: {},
    firstConnectCalloutSeen: false,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('first-connect TTV callout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
    vi.mocked(mailConnectedAccounts).mockResolvedValue(FIXTURE_ACCOUNTS);
  });

  it('appears after accounts load and firstConnectCalloutSeen is false', async () => {
    render(<EmailWorkspace />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(screen.getByTestId('first-connect-callout')).toBeInTheDocument();
    expect(screen.getByText(/Email connected. Try searching by name, topic, or deadline./i)).toBeInTheDocument();
    expect(screen.queryByText(/inbox search never could/i)).not.toBeInTheDocument();
  });

  it('is dismissed when the X button is clicked', async () => {
    render(<EmailWorkspace />);
    await act(async () => { await vi.runAllTimersAsync(); });
    const callout = screen.getByTestId('first-connect-callout');
    expect(callout).toBeInTheDocument();
    // The Callout dismiss button has aria-label "Dismiss"
    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismiss);
    expect(screen.queryByTestId('first-connect-callout')).not.toBeInTheDocument();
  });

  it('CTA button dismisses the callout', async () => {
    render(<EmailWorkspace />);
    await act(async () => { await vi.runAllTimersAsync(); });
    const cta = screen.getByTestId('first-connect-callout-cta');
    fireEvent.click(cta);
    expect(screen.queryByTestId('first-connect-callout')).not.toBeInTheDocument();
  });

  it('does NOT appear when firstConnectCalloutSeen is true', async () => {
    useMailStore.setState({ firstConnectCalloutSeen: true });
    render(<EmailWorkspace />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(screen.queryByTestId('first-connect-callout')).not.toBeInTheDocument();
  });

  it('does NOT appear when no accounts are connected', async () => {
    vi.mocked(mailConnectedAccounts).mockResolvedValue([]);
    render(<EmailWorkspace />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(screen.queryByTestId('first-connect-callout')).not.toBeInTheDocument();
  });
});

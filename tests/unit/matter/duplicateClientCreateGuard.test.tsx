/**
 * QA-24 (P1) — the "Create client" button must be idempotent under a
 * double/triple-click burst. Persona-C's klutz exploration found that
 * triple-clicking "Create client" fires the create handler three times before
 * React re-renders, so all three submissions see the same stale matters
 * snapshot and race onto one folder (see tests/integration/newClientScoping.test.ts
 * for the store-level backstop). This file tests the UI-level defense: the
 * dialog itself must swallow re-entrant clicks from the same submit burst.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { setMatterAuditEmitter, useMatterStore } from '@/platform/matter/matterStore';

const auditMocks = vi.hoisted(() => ({
  append: vi.fn(),
}));

vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: async () => ({ items: [], total: 0 }),
  mailIsConnected: async () => false,
  gmailIsConnected: async () => false,
  mailImapIsConnected: async () => false,
  mailConnectedAccounts: async () => [],
  mailClearMatterFilings: async () => 0,
}));

vi.mock('@/platform/hooks/useApiKeys', () => ({
  useApiKeys: () => ({ apiKeys: [] }),
}));

vi.mock('@/platform/hooks/useFirm', () => ({
  useFirm: () => ({
    isSignedIn: false,
    hasActiveSeat: false,
    role: null,
    org: null,
    email: null,
    seatId: null,
    entitlement: { aiEnabled: false },
    isOffline: false,
    isLoading: false,
    error: null,
    assuredProviders: [],
    signIn: async () => ({ ok: true }),
    activateSeat: async () => ({ ok: true }),
    signOut: async () => undefined,
  }),
  useAssuredAvailable: () => false,
}));

vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: (sel: (s: { rootPath: string | null; fileTree: unknown[] }) => unknown) =>
    sel({ rootPath: '/test-workspace', fileTree: [] }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => { throw new Error('not in test'); }),
  isTauri: () => false,
}));

vi.mock('@/platform/audit/AuditService', () => ({
  AuditService: class { append = auditMocks.append; },
  auditEventToEntry: (event: { type: string; payload: Record<string, unknown> }) => ({
    action: event.type,
    description: event.type,
    model: undefined,
    inputs: {},
    outputs: {},
    userDecision: 'auto',
    metadata: event.payload,
  }),
  isAuditEncrypted: () => false,
}));

vi.mock('@/platform/firm/matterKeyService', () => ({
  getOrCreateMatterKey: async () => 'key',
  publishMatterKeyToMembers: async () => ({ published: 0, skippedWalled: 0 }),
  obtainMatterKey: async () => null,
}));

vi.mock('@/platform/firm/deviceKeys', () => ({
  registerDevice: async () => undefined,
  _resetDeviceCache: () => undefined,
  getOrCreateDeviceKeypair: async () => ({ deviceId: 'test', publicJwk: {} }),
}));

vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: async () => vi.fn(),
}));

// getActiveWorkspaceService is called by ensureClientFolderOnDisk (fire-and-forget
// disk write) — return null so it no-ops cleanly in this DOM-only test.
vi.mock('@/platform/fs/activeWorkspaceService', () => ({
  getActiveWorkspaceService: () => null,
}));

import { MatterManagerDialog } from '@/features/matters/MatterManagerDialog';

function resetStore() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
  auditMocks.append.mockClear();
  setMatterAuditEmitter(auditMocks.append);
}

describe('MatterManagerDialog — QA-24: Create client button is idempotent under rapid re-clicks', () => {
  beforeEach(resetStore);

  it('firing the create handler 3 times in the SAME commit (no re-render between them) creates only ONE matter', () => {
    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    const nameInput = screen.getByTestId('matter-new-client');
    fireEvent.change(nameInput, { target: { value: 'Klutz Test Client' } });

    const createButton = screen.getByTestId('matter-create-button');
    // A real fast triple-click (or a scripted/CDP-driven multi-click) can
    // dispatch all three click events before React gets a chance to commit a
    // re-render — reproduced here by batching all three fireEvent.click calls
    // inside ONE act() so React defers flushing until after all three onClick
    // invocations have run against the SAME stale closure/state.
    act(() => {
      fireEvent.click(createButton);
      fireEvent.click(createButton);
      fireEvent.click(createButton);
    });

    expect(useMatterStore.getState().matters).toHaveLength(1);
  });

  it('keeps the Create button disabled while a submission is in flight, even once the fields are refilled', () => {
    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    const nameInput = screen.getByTestId('matter-new-client');
    fireEvent.change(nameInput, { target: { value: 'Another Client' } });

    const createButton = screen.getByTestId('matter-create-button');
    fireEvent.click(createButton);
    expect(useMatterStore.getState().matters).toHaveLength(1);

    // The dialog clears the fields after a successful create — refill them
    // immediately (before the submitting flag's timer resets) to prove the
    // button is disabled because a submission is STILL in flight, not merely
    // because the fields happen to be empty right after a create.
    fireEvent.change(nameInput, { target: { value: 'Yet Another Client' } });
    expect(createButton).toBeDisabled();

    // And a click while still "in flight" must not create a second matter.
    fireEvent.click(createButton);
    expect(useMatterStore.getState().matters).toHaveLength(1);
  });
});

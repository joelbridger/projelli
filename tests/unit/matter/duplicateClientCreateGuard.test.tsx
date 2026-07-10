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
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { setMatterAuditEmitter, useMatterStore } from '@/platform/matter/matterStore';

const auditMocks = vi.hoisted(() => ({
  append: vi.fn(),
}));
const intakeMocks = vi.hoisted(() => ({
  createAdvisorIntake: vi.fn(async () => ({
    link: 'https://forms.example.test/i/intake-1#secret',
    tokenB64: 'token',
    linkSecretB64: 'secret',
    publicKeyRaw: new Uint8Array(65),
    privateKey: {} as CryptoKey,
    checklistCiphertextB64: 'checklist',
    stateCiphertextB64: 'state',
    intakeId: 'intake-1',
  })),
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

vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: (sel: (s: {
    seatToken: string;
    accessToken: string;
    session: { org: { name: string } };
  }) => unknown) => sel({
    seatToken: 'seat-test',
    accessToken: 'access-test',
    session: { org: { name: 'North Star Planning' } },
  }),
}));

vi.mock('@/platform/intake/createIntake', () => ({
  createAdvisorIntake: intakeMocks.createAdvisorIntake,
}));

// getActiveWorkspaceService is called by ensureClientFolderOnDisk (fire-and-forget
// disk write) — return null so it no-ops cleanly in this DOM-only test.
vi.mock('@/platform/fs/activeWorkspaceService', () => ({
  getActiveWorkspaceService: () => null,
}));

import { NewClientDialog } from '@/features/matters/NewClientDialog';

function resetStore() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
  auditMocks.append.mockClear();
  intakeMocks.createAdvisorIntake.mockClear();
  setMatterAuditEmitter(auditMocks.append);
}

// Creating a client now lives in the small NewClientDialog (feedback line 14),
// so the idempotency guarantee moved with it.
describe('NewClientDialog — QA-24: Create is idempotent under rapid re-clicks', () => {
  beforeEach(resetStore);

  it('firing the create-link handler 3 times in the SAME commit creates only ONE matter', async () => {
    render(<NewClientDialog open={true} onOpenChange={() => undefined} />);

    const nameInput = screen.getByTestId('new-client-name');
    fireEvent.change(nameInput, { target: { value: 'Klutz Test Client' } });
    fireEvent.click(screen.getByTestId('new-client-next'));
    fireEvent.click(screen.getByTestId('new-client-review'));

    const createButton = screen.getByTestId('new-client-create');
    // A real fast triple-click can dispatch all three click events before React
    // commits a re-render — reproduced here by batching all three clicks inside
    // ONE act() so React defers flushing until after all three onClick calls
    // have run against the SAME stale closure/state.
    act(() => {
      fireEvent.click(createButton);
      fireEvent.click(createButton);
      fireEvent.click(createButton);
    });

    await waitFor(() => expect(useMatterStore.getState().matters).toHaveLength(1));
    expect(useMatterStore.getState().matters).toHaveLength(1);
    expect(intakeMocks.createAdvisorIntake).toHaveBeenCalledOnce();
  });

  it('pressing Enter on the name step advances without creating a matter', () => {
    render(<NewClientDialog open={true} onOpenChange={() => undefined} />);

    const nameInput = screen.getByTestId('new-client-name');
    fireEvent.change(nameInput, { target: { value: 'Enter Client' } });
    act(() => {
      fireEvent.keyDown(nameInput, { key: 'Enter' });
      fireEvent.keyDown(nameInput, { key: 'Enter' });
    });

    expect(screen.getByText('Compose onboarding checklist')).toBeInTheDocument();
    expect(useMatterStore.getState().matters).toHaveLength(0);
  });
});

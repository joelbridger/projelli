/**
 * archiveMatterUi.test.tsx
 *
 * Acceptance tests for the "archive a matter" UI feature.
 *
 * Tests:
 *   (a) Archived matter does NOT appear in the active list.
 *   (b) The archived section + restore control appear when there is an archived matter.
 *   (c) Clicking the archive button on an active matter archives it (store + UI).
 *   (d) Clicking restore on an archived matter restores it to the active list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useMatterStore } from '@/platform/matter/matterStore';

// ── Mail commands (async probes used by GetStartedCard) ────────────────────────
vi.mock('@/platform/utils/mail-commands', () => ({
  mailIsConnected: async () => false,
  gmailIsConnected: async () => false,
  mailImapIsConnected: async () => false,
  mailConnectedAccounts: async () => [],
  // deleteMatter clears a deleted matter's email filings (BUG-042).
  mailClearMatterFilings: async () => 0,
}));

// ── useApiKeys ──────────────────────────────────────────────────────────────────
vi.mock('@/platform/hooks/useApiKeys', () => ({
  useApiKeys: () => ({ apiKeys: [] }),
}));

// ── useFirm (no firm session in these tests) ───────────────────────────────────
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

// ── Workspace store (empty tree) ───────────────────────────────────────────────
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: (sel: (s: { rootPath: string | null; fileTree: unknown[] }) => unknown) =>
    sel({ rootPath: null, fileTree: [] }),
}));

// ── Tauri keychain ─────────────────────────────────────────────────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => { throw new Error('not in test'); }),
  isTauri: () => false,
}));

// ── AuditService ───────────────────────────────────────────────────────────────
vi.mock('@/platform/audit/AuditService', () => ({
  AuditService: class { append() { /* noop */ } },
  isAuditEncrypted: () => false,
}));

// ── firm key service ───────────────────────────────────────────────────────────
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

// ── Import component after mocks ───────────────────────────────────────────────
import { MatterManagerDialog } from '@/features/matters/MatterManagerDialog';

function resetStore() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: seed the store with one active + one archived matter, render the dialog
// ─────────────────────────────────────────────────────────────────────────────

function seedAndRender() {
  useMatterStore.getState().createMatter({ name: 'Active Matter', client: 'Client A' });
  useMatterStore.getState().createMatter({ name: 'Archived Matter', client: 'Client B' });
  const matters = useMatterStore.getState().matters;
  const activeMatter = matters[0]!;
  const archivedMatter = matters[1]!;
  // Archive the second matter
  useMatterStore.getState().setMatterArchived(archivedMatter.id, true);
  render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);
  return { activeMatter, archivedMatter };
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) Archived matter does NOT appear in the active list
// ─────────────────────────────────────────────────────────────────────────────

describe('MatterManagerDialog — archive: archived matter hidden from active list', () => {
  beforeEach(resetStore);

  it('the archived matter row is NOT in the active matter list', () => {
    const { activeMatter, archivedMatter } = seedAndRender();

    // Active matter row should be visible in the main list
    expect(screen.getByTestId(`matter-row-${activeMatter.id}`)).toBeInTheDocument();

    // Archived matter row should NOT be in the active list
    expect(screen.queryByTestId(`matter-row-${archivedMatter.id}`)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Archived section + restore control appear when there is an archived matter
// ─────────────────────────────────────────────────────────────────────────────

describe('MatterManagerDialog — archive: archived section shown', () => {
  beforeEach(resetStore);

  it('shows the archived section when there are archived matters', () => {
    seedAndRender();

    expect(screen.getByTestId('archived-matters-section')).toBeInTheDocument();
    expect(screen.getByTestId('archived-matters-toggle')).toBeInTheDocument();
  });

  it('does NOT show the archived section when no matters are archived', () => {
    useMatterStore.getState().createMatter({ name: 'Normal', client: 'Client' });

    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    expect(screen.queryByTestId('archived-matters-section')).not.toBeInTheDocument();
  });

  it('expanding the archived section shows the restore button', () => {
    const { archivedMatter } = seedAndRender();

    // Click the toggle to expand
    const toggle = screen.getByTestId('archived-matters-toggle');
    fireEvent.click(toggle);

    // Restore button should now be visible
    expect(screen.getByTestId(`matter-restore-${archivedMatter.id}`)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) Clicking archive on an active matter moves it to archived
// ─────────────────────────────────────────────────────────────────────────────

describe('MatterManagerDialog — archive: clicking Archive archives the matter', () => {
  beforeEach(resetStore);

  it('archive button calls setMatterArchived and the matter disappears from active list', () => {
    useMatterStore.getState().createMatter({ name: 'To Archive', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    // Active row should be present
    expect(screen.getByTestId(`matter-row-${matter.id}`)).toBeInTheDocument();

    // Click archive button
    const archiveBtn = screen.getByTestId(`matter-archive-${matter.id}`);
    fireEvent.click(archiveBtn);

    // Matter should now be archived in the store
    const stored = useMatterStore.getState().matters.find((m) => m.id === matter.id);
    expect(stored?.archived).toBe(true);

    // Row should be gone from active list
    expect(screen.queryByTestId(`matter-row-${matter.id}`)).not.toBeInTheDocument();

    // Archived section should now appear
    expect(screen.getByTestId('archived-matters-section')).toBeInTheDocument();
  });

  it('archiving the active matter clears the active selection', () => {
    useMatterStore.getState().createMatter({ name: 'Active', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;
    useMatterStore.getState().setActiveMatter(matter.id);

    expect(useMatterStore.getState().activeMatterId).toBe(matter.id);

    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);
    const archiveBtn = screen.getByTestId(`matter-archive-${matter.id}`);
    fireEvent.click(archiveBtn);

    // Active matter id should be cleared
    expect(useMatterStore.getState().activeMatterId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) Clicking restore brings an archived matter back to the active list
// ─────────────────────────────────────────────────────────────────────────────

describe('MatterManagerDialog — archive: clicking Restore restores the matter', () => {
  beforeEach(resetStore);

  it('clicking restore removes archived flag and matter reappears in active list', () => {
    const { archivedMatter } = seedAndRender();

    // Expand the archived section
    const toggle = screen.getByTestId('archived-matters-toggle');
    fireEvent.click(toggle);

    // Click restore
    const restoreBtn = screen.getByTestId(`matter-restore-${archivedMatter.id}`);
    fireEvent.click(restoreBtn);

    // Matter should no longer be archived in the store
    const stored = useMatterStore.getState().matters.find((m) => m.id === archivedMatter.id);
    expect(stored?.archived).toBeFalsy();

    // Matter row should now appear in active list
    expect(screen.getByTestId(`matter-row-${archivedMatter.id}`)).toBeInTheDocument();

    // Archived section should be gone (no archived matters left)
    expect(screen.queryByTestId('archived-matters-section')).not.toBeInTheDocument();
  });
});

/**
 * QA-74 (P1 trust-breaker): the Wealthbox connector reports success
 * ("Connected to Northcrest") and completes the "Import N households"
 * confirmation cleanly, but the Client Map never gains any of the imported
 * households — the count stays exactly what it was before.
 *
 * This test drives the REAL `WealthboxConnect` component end-to-end (typing
 * the token, clicking Connect, confirming the import dialog) against the
 * REAL `useMatterStore`, mocking only the Tauri command boundary
 * (`wealthbox-commands`) and the Tauri event subscription (`useCrmSync`).
 * If the connect -> import flow is wired correctly, the matter store must
 * gain exactly one new matter per household reported by `crmListHouseholds`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn().mockRejectedValue(new Error('invoke should not be called directly in this test')),
}));

// useCrmSync only subscribes to a Tauri event to mirror progress text; it is
// not part of the import flow under test.
vi.mock('@/platform/connectors/crm/useCrmSync', () => ({ useCrmSync: () => {} }));

const crmMocks = vi.hoisted(() => ({
  crmConnect: vi.fn(),
  crmIsConnected: vi.fn(),
  crmDisconnect: vi.fn(),
  crmListHouseholds: vi.fn(),
  crmSyncAll: vi.fn(),
  crmCancelSync: vi.fn(),
  createCrmRunId: vi.fn(() => 'test-run'),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  ...crmMocks,
  CRM_SYNC_EVENT: 'crm-sync-progress',
}));

import { WealthboxConnect } from '@/platform/connectors/crm/WealthboxConnect';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

function seedExistingMatters(count: number) {
  const matters = Array.from({ length: count }, (_, i) => ({
    id: `pre-existing-${String(i)}`,
    name: `Pre-existing Client ${String(i)}`,
    client: `Pre-existing Client ${String(i)}`,
    folderPaths: [],
    mailFolderPaths: [],
    crmHouseholdKeys: [],
    onedriveFolderKeys: [],
    boxFolderKeys: [],
    esignKeys: [],
    jotformKeys: [],
    sharefileFolderKeys: [],
    meetingKeys: [],
    zocksKeys: [],
    addeparKeys: [],
    privileged: false,
    mcpAccessGranted: false,
    createdAt: '2026-01-01T00:00:00Z',
  }));
  useMatterStore.setState({
    matters,
    activeMatterId: null,
    snapshots: {},
    cache: {},
    statusByMatterId: {},
  });
}

describe('WealthboxConnect — QA-74 import must populate the Client Map', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    seedExistingMatters(9);
    useWorkspaceStore.setState({ rootPath: null, fileTree: [] });

    crmMocks.crmIsConnected.mockResolvedValue(false);
    crmMocks.crmConnect.mockResolvedValue({ name: 'Northcrest', plan: 'basic', email: 'advisor@northcrest.com' });
    crmMocks.crmListHouseholds.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => ({ id: `wb-household-${String(i)}`, name: `New Household ${String(i)}` }))
    );
    crmMocks.crmSyncAll.mockResolvedValue({ householdsProcessed: 40, recordsIndexed: 400 });
    crmMocks.crmCancelSync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('creates one new matter per imported household after Connect + confirm', async () => {
    expect(useMatterStore.getState().matters).toHaveLength(9);

    render(<WealthboxConnect />);

    const input = await screen.findByPlaceholderText(/wealthbox api key/i);
    fireEvent.change(input, { target: { value: 'test-token-123' } });
    fireEvent.click(screen.getByRole('button', { name: /connect wealthbox/i }));

    // The confirm dialog appears once crmListHouseholds resolves with 40.
    // The Import choice lives in the raised ConfirmDialog, above the connector
    // panel. Target its stable control rather than the old inline button.
    const confirmButton = await screen.findByTestId('confirm-dialog-confirm');
    fireEvent.click(confirmButton);

    // The backend sync call is the last step of runSync(); wait for it.
    await waitFor(() => expect(crmMocks.crmSyncAll).toHaveBeenCalledTimes(1));

    // THE ACTUAL BUG: the Client Map (backed by useMatterStore) must now show
    // 9 + 40 = 49 matters, one per imported household.
    await waitFor(() => {
      expect(useMatterStore.getState().matters).toHaveLength(49);
    });

    const createdNames = useMatterStore
      .getState()
      .matters.filter((m) => m.createdFromCrm)
      .map((m) => m.client);
    expect(createdNames).toHaveLength(40);
    expect(createdNames).toContain('New Household 0');
    expect(createdNames).toContain('New Household 39');
  });
});

describe('WealthboxConnect — QA-74 regressions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    seedExistingMatters(9);
    useWorkspaceStore.setState({ rootPath: null, fileTree: [] });

    crmMocks.crmIsConnected.mockResolvedValue(false);
    crmMocks.crmConnect.mockResolvedValue({ name: 'Northcrest', plan: 'basic', email: 'advisor@northcrest.com' });
    crmMocks.crmListHouseholds.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => ({ id: `wb-household-${String(i)}`, name: `New Household ${String(i)}` }))
    );
    crmMocks.crmSyncAll.mockResolvedValue({ householdsProcessed: 40, recordsIndexed: 400 });
    crmMocks.crmCancelSync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('un-archives a matter reused via an existing crmHouseholdKeys link', async () => {
    // Seed ONE archived matter that already claims a Wealthbox household id —
    // e.g. from an earlier disconnect that didn't fully scrub the mapping, or
    // a matter the advisor archived after the fact. `resolveMatterForHousehold`
    // resolves this to 'reuse' (Priority 1) — since the household is already
    // linked, there's no error, no new row, and crmSyncAll succeeds cleanly
    // indexing its data. But if the matter is never un-archived, it stays
    // permanently invisible on the Client Map (`useActiveMatters` filters it
    // out) even though the sync reports full success — QA-74's exact symptom,
    // with zero backend error involved.
    useMatterStore.setState({
      matters: [
        {
          id: 'archived-household-0',
          name: 'Archived Household 0',
          client: 'Archived Household 0',
          folderPaths: [],
          mailFolderPaths: [],
          crmHouseholdKeys: ['wb-household-0'],
          onedriveFolderKeys: [],
          boxFolderKeys: [],
          esignKeys: [],
          jotformKeys: [],
          sharefileFolderKeys: [],
          meetingKeys: [],
          zocksKeys: [],
          addeparKeys: [],
          privileged: false,
          mcpAccessGranted: false,
          archived: true,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
      activeMatterId: null,
      snapshots: {},
      cache: {},
      statusByMatterId: {},
    });
    crmMocks.crmListHouseholds.mockResolvedValue([{ id: 'wb-household-0', name: 'Archived Household 0' }]);
    crmMocks.crmSyncAll.mockResolvedValue({ householdsProcessed: 1, recordsIndexed: 10 });

    render(<WealthboxConnect />);
    const input = await screen.findByPlaceholderText(/wealthbox api key/i);
    fireEvent.change(input, { target: { value: 'test-token-123' } });
    fireEvent.click(screen.getByRole('button', { name: /connect wealthbox/i }));

    const confirmButton = await screen.findByTestId('confirm-dialog-confirm');
    fireEvent.click(confirmButton);

    await waitFor(() => expect(crmMocks.crmSyncAll).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      const matter = useMatterStore.getState().matters.find((m) => m.id === 'archived-household-0');
      expect(matter?.archived).not.toBe(true);
    });
  });

  it('un-archives a matter LINKED by unique name match to an archived file-client', async () => {
    // A second, distinct code path to the same bug (independent review
    // finding): `resolveMatterForHousehold` searches ALL matters, including
    // archived ones. When a household's name uniquely matches an ARCHIVED
    // matter that has NO crmHouseholdKeys yet, resolution is 'link' (not
    // 'reuse') — the household key gets attached, the backend indexes it
    // successfully, but the matter stays archived and invisible on the
    // Client Map. Same QA-74 symptom via the 'link' branch instead of the
    // 'reuse' branch.
    useMatterStore.setState({
      matters: [
        {
          id: 'archived-file-client-0',
          name: 'Smith Family',
          client: 'Smith Family',
          folderPaths: [],
          mailFolderPaths: [],
          crmHouseholdKeys: [],
          onedriveFolderKeys: [],
          boxFolderKeys: [],
          esignKeys: [],
          jotformKeys: [],
          sharefileFolderKeys: [],
          meetingKeys: [],
          zocksKeys: [],
          addeparKeys: [],
          privileged: false,
          mcpAccessGranted: false,
          archived: true,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
      activeMatterId: null,
      snapshots: {},
      cache: {},
      statusByMatterId: {},
    });
    crmMocks.crmListHouseholds.mockResolvedValue([{ id: 'wb-household-smith', name: 'Smith Family' }]);
    crmMocks.crmSyncAll.mockResolvedValue({ householdsProcessed: 1, recordsIndexed: 10 });

    render(<WealthboxConnect />);
    const input = await screen.findByPlaceholderText(/wealthbox api key/i);
    fireEvent.change(input, { target: { value: 'test-token-123' } });
    fireEvent.click(screen.getByRole('button', { name: /connect wealthbox/i }));

    const confirmButton = await screen.findByTestId('confirm-dialog-confirm');
    fireEvent.click(confirmButton);

    await waitFor(() => expect(crmMocks.crmSyncAll).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      const matter = useMatterStore.getState().matters.find((m) => m.id === 'archived-file-client-0');
      expect(matter?.crmHouseholdKeys).toContain('wb-household-smith');
      expect(matter?.archived).not.toBe(true);
    });
  });

  it('does not roll back already-created Client Map matters when the backend sync step fails', async () => {
    // crmSyncAll (Step 4: backend RAG indexing) fails — e.g. a transient
    // Wealthbox API hiccup over a long paginated 40-household ingest (the
    // real Wealthbox client has NO retry at all for non-429 failures — see
    // src-tauri/src/commands/crm/client.rs get_json). The households were
    // already confirmed and turned into real matters in Step 3; that local
    // decision must survive a downstream indexing hiccup, not be wiped.
    crmMocks.crmSyncAll.mockRejectedValue(new Error('Wealthbox request failed (HTTP 503)'));

    render(<WealthboxConnect />);
    const input = await screen.findByPlaceholderText(/wealthbox api key/i);
    fireEvent.change(input, { target: { value: 'test-token-123' } });
    fireEvent.click(screen.getByRole('button', { name: /connect wealthbox/i }));

    const confirmButton = await screen.findByTestId('confirm-dialog-confirm');
    fireEvent.click(confirmButton);

    await waitFor(() => expect(crmMocks.crmSyncAll).toHaveBeenCalledTimes(1));

    // The Client Map must still show the 40 newly-imported households even
    // though the backend indexing step failed.
    await waitFor(() => {
      expect(useMatterStore.getState().matters).toHaveLength(49);
    });
  });
});

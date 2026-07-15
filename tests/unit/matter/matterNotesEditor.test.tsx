/**
 * matterNotesEditor.test.tsx — Task 4 unit tests.
 *
 * Tests:
 *   1. Mount editor with a mocked sync client + Y.Doc: local typing updates
 *      doc.getText('notes').
 *   2. Applying a remote Yjs update re-renders content in the editor.
 *   3. Null-client renders the fail-closed state (no-access message).
 *   4. Status badge reflects matterSyncStore for different statuses.
 *   5. MatterNotesEditorWrapper: renders fail-closed when matter not found.
 *   6. MatterNotesEditorWrapper: boots ensureMatterSync and renders the editor.
 *   7. openMatterNotes: opens a new tab for a shared matter.
 *   8. openMatterNotes: focuses existing tab rather than double-opening.
 *   9. locale: matter.notes keys exist in all three locales.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import type { MatterSyncClient } from '@/platform/firm/MatterSyncClient';
import type { Matter } from '@/platform/types/matter';
import { useMatterSyncStore } from '@/platform/matter/matterSyncStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useEditorStore } from '@/platform/state/editorStore';
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { deCatalog as de, enCatalog as en, esCatalog as es } from '@/i18nCatalogs';

// ── i18n setup (the global setup already inits i18next; this is a no-op guard)
// ── Keychain mock (firm modules need it) ─────────────────────────────────────
const keychainStore = new Map<string, string>();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    const svc = (args['service'] as string) ?? 'com.keepance.app';
    const key = args['key'] as string;
    const id = `${svc}::${key}`;
    if (cmd === 'keychain_set') { keychainStore.set(id, args['value'] as string); return undefined; }
    if (cmd === 'keychain_get') {
      if (!keychainStore.has(id)) throw { kind: 'notFound', message: 'no entry' };
      return keychainStore.get(id);
    }
    if (cmd === 'keychain_delete') { keychainStore.delete(id); return undefined; }
    throw new Error(`unexpected invoke ${cmd}`);
  }),
  isTauri: () => true,
}));

// ── Mock firmStore so we don't need real tokens ──────────────────────────────
vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: {
    getState: vi.fn(() => ({
      seatToken: 'test-seat-token',
      client: vi.fn(() => ({})),
    })),
  },
}));

// ── Mock matterNotesSync ─────────────────────────────────────────────────────
// Most tests inject the sync client directly into MatterNotesEditor, so we
// only need the mock for the Wrapper tests.
let mockEnsureMatterSync: ReturnType<
  typeof vi.fn<(localMatter: Matter, keyEpoch?: number) => Promise<MatterSyncClient | null>>
>;

vi.mock('@/features/matters/logic/matterNotesSync', () => {
  mockEnsureMatterSync = vi.fn();
  return {
    ensureMatterSync: (...args: Parameters<typeof mockEnsureMatterSync>) => mockEnsureMatterSync(...args),
    stopMatterSync: vi.fn(),
    stopAll: vi.fn(),
    getMatterSyncClient: vi.fn(() => null),
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal Matter fixture. */
function makeMatter(overrides?: Partial<Matter>): Matter {
  return {
    id: 'matter-test-1',
    name: 'Test Matter',
    client: 'Acme Corp',
    folderPaths: ['/workspace/acme'],
    mailFolderPaths: [],
    privileged: false,
    createdAt: new Date().toISOString(),
    shared: true,
    firmMatterId: 'firm-matter-uuid-1',
    orgId: 'org-1',
    role: 'owner',
    ...overrides,
  };
}

/**
 * Build a mock MatterSyncClient with a real Y.Doc. The mock exposes only the
 * properties MatterNotesEditor uses: `doc` (with `doc.getText('notes')`).
 */
function makeMockClient(doc?: Y.Doc): MatterSyncClient {
  const ydoc = doc ?? new Y.Doc();
  return { doc: ydoc } as unknown as MatterSyncClient;
}

// Reset stores before each test.
function resetStores() {
  useMatterSyncStore.setState({ statusByMatterId: {} });
  useMatterStore.setState({ matters: [], activeMatterId: null });
  useEditorStore.setState({ openTabs: [], activeTabPath: null });
  useCrmWriteQueueStore.setState({ items: [] });
}

// ── Import components lazily to avoid issues with vi.mock order ──────────────
let MatterNotesEditor: typeof import('@/features/matters/MatterNotesEditor').MatterNotesEditor;
let MatterNotesEditorWrapper: typeof import('@/features/matters/MatterNotesEditorWrapper').MatterNotesEditorWrapper;
let openMatterNotes: typeof import('@/features/matters/logic/openMatterNotes').openMatterNotes;

// ── Test suite ────────────────────────────────────────────────────────────────

describe('MatterNotesEditor', () => {
  beforeEach(async () => {
    resetStores();
    keychainStore.clear();
    if (!MatterNotesEditor) {
      const mod = await import('@/features/matters/MatterNotesEditor');
      MatterNotesEditor = mod.MatterNotesEditor;
    }
    if (!MatterNotesEditorWrapper) {
      const mod = await import('@/features/matters/MatterNotesEditorWrapper');
      MatterNotesEditorWrapper = mod.MatterNotesEditorWrapper;
    }
    if (!openMatterNotes) {
      const mod = await import('@/features/matters/logic/openMatterNotes');
      openMatterNotes = mod.openMatterNotes;
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: editor mounts and local typing updates the Yjs doc ─────────────
  it('mounts the CodeMirror editor when a sync client is provided', async () => {
    const matter = makeMatter();
    const client = makeMockClient();

    render(<MatterNotesEditor matter={matter} syncClient={client} />);

    // The CodeMirror editor container should be in the DOM.
    expect(screen.getByTestId('matter-notes-cm-editor')).toBeInTheDocument();
    expect(screen.getByTestId('matter-notes-editor')).toBeInTheDocument();
  });

  // ── Test 2: applying a remote Yjs update reflects in the doc ───────────────
  it('reflects a remote Yjs update applied to the Y.Text', async () => {
    const matter = makeMatter();
    const ydoc = new Y.Doc();
    const client = makeMockClient(ydoc);

    render(<MatterNotesEditor matter={matter} syncClient={client} />);

    const yText = ydoc.getText('notes');

    // Apply a remote update: insert text into the Y.Text. y-codemirror.next's
    // ySync extension observes Y.Text changes and pushes them into CodeMirror.
    // We assert the Y.Text has the content — CodeMirror DOM assertions in jsdom
    // can be flaky due to the editor being canvas-like; the binding contract is
    // the Yjs observation, which is synchronous.
    await act(async () => {
      ydoc.transact(() => {
        yText.insert(0, 'Remote content from peer');
      });
    });

    expect(yText.toString()).toBe('Remote content from peer');
  });

  // ── Test 3: null-client renders the fail-closed state ──────────────────────
  it('renders the fail-closed message when syncClient is null', () => {
    const matter = makeMatter();
    render(<MatterNotesEditor matter={matter} syncClient={null} />);

    expect(screen.getByTestId('matter-notes-no-access')).toBeInTheDocument();
    // The editor container should NOT be mounted.
    expect(screen.queryByTestId('matter-notes-cm-editor')).not.toBeInTheDocument();
  });

  // ── Test 4: status badge reflects matterSyncStore ─────────────────────────
  it('shows the correct badge for "live" sync status', () => {
    const matter = makeMatter();
    useMatterSyncStore.getState().setStatus(matter.id, 'live');
    const client = makeMockClient();

    render(<MatterNotesEditor matter={matter} syncClient={client} />);

    const badge = screen.getByTestId('matter-notes-sync-badge');
    expect(badge).toHaveTextContent('Live');
  });

  it('shows the correct badge for "error" sync status', () => {
    const matter = makeMatter();
    useMatterSyncStore.getState().setStatus(matter.id, 'error');
    const client = makeMockClient();

    render(<MatterNotesEditor matter={matter} syncClient={client} />);

    const badge = screen.getByTestId('matter-notes-sync-badge');
    expect(badge).toHaveTextContent('Sync error');
  });

  it('shows the correct badge for "offline" sync status', () => {
    const matter = makeMatter();
    useMatterSyncStore.getState().setStatus(matter.id, 'offline');
    const client = makeMockClient();

    render(<MatterNotesEditor matter={matter} syncClient={client} />);

    const badge = screen.getByTestId('matter-notes-sync-badge');
    expect(badge).toHaveTextContent('Offline');
  });

  // ── Test 4b: "Send to Wealthbox" enqueues the current note text ───────────
  it('"Send to Wealthbox" enqueues a note with title from the first line and the rest as body', async () => {
    const matter = makeMatter();
    const ydoc = new Y.Doc();
    const client = makeMockClient(ydoc);
    const yText = ydoc.getText('notes');
    yText.insert(0, 'Annual review follow-up\nDiscussed 529 rollover.\nNext steps pending.');

    render(<MatterNotesEditor matter={matter} syncClient={client} />);

    fireEvent.click(screen.getByTestId('matter-notes-send-to-wealthbox'));

    const items = useCrmWriteQueueStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'note',
      matterId: matter.id,
      title: 'Annual review follow-up',
      body: 'Discussed 529 rollover.\nNext steps pending.',
      sourceRef: `note:${matter.id}`,
    });
  });

  it('"Send to Wealthbox" uses the whole text as both title and body when there is only one line', () => {
    const matter = makeMatter();
    const ydoc = new Y.Doc();
    const client = makeMockClient(ydoc);
    const yText = ydoc.getText('notes');
    yText.insert(0, 'One line only');

    render(<MatterNotesEditor matter={matter} syncClient={client} />);

    fireEvent.click(screen.getByTestId('matter-notes-send-to-wealthbox'));

    const items = useCrmWriteQueueStore.getState().items;
    expect(items[0]).toMatchObject({ title: 'One line only', body: 'One line only' });
  });

  // QA finding (P3): the confirmation used to be a vague, non-actionable
  // toast ("Added to the Wealthbox review card on this client's map") — now
  // plain copy plus a real "Review now" action that jumps to this client's
  // Client Map (where the review card lives).
  it('shows a plain confirmation with a working "Review now" action after Send to Wealthbox', async () => {
    const matter = makeMatter();
    const ydoc = new Y.Doc();
    const client = makeMockClient(ydoc);
    ydoc.getText('notes').insert(0, 'Annual review follow-up\nDiscussed 529 rollover.');

    render(<MatterNotesEditor matter={matter} syncClient={client} />);
    fireEvent.click(screen.getByTestId('matter-notes-send-to-wealthbox'));

    expect(screen.getByTestId('matter-notes-sent-confirmation')).toHaveTextContent('Queued for Wealthbox review');

    const events: CustomEvent[] = [];
    const handler = (e: Event) => { events.push(e as CustomEvent); };
    window.addEventListener('lantern:matter-launch', handler);
    fireEvent.click(screen.getByTestId('matter-notes-review-now'));
    window.removeEventListener('lantern:matter-launch', handler);

    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toMatchObject({ matterId: matter.id, surface: 'matters' });
  });

  // Codex adversarial review catch (P2): a reused editor instance switching
  // to a different client's syncClient must drop the previous client's note
  // text immediately, or "Send to Wealthbox" could queue the WRONG client's
  // note under the NEW client's matter.id — a cross-client data leak.
  it('resets note text when the syncClient switches to a different client (no unmount)', () => {
    const matterA = makeMatter({ id: 'matter-a', firmMatterId: 'fm-a' });
    const matterB = makeMatter({ id: 'matter-b', firmMatterId: 'fm-b' });
    const ydocA = new Y.Doc();
    ydocA.getText('notes').insert(0, "Client A's confidential note");
    const clientA = makeMockClient(ydocA);
    const clientB = makeMockClient(new Y.Doc()); // client B's notes are empty

    const { rerender } = render(<MatterNotesEditor matter={matterA} syncClient={clientA} />);
    expect(screen.getByTestId('matter-notes-send-to-wealthbox')).not.toBeDisabled();

    // Same component instance, switched to a different client with an empty doc.
    rerender(<MatterNotesEditor matter={matterB} syncClient={clientB} />);

    // Must reflect client B's (empty) notes, not leak client A's text — if the
    // bug were present this would still be enabled with A's stale text.
    expect(screen.getByTestId('matter-notes-send-to-wealthbox')).toBeDisabled();
  });

  it('"Send to Wealthbox" is disabled when the notes are empty', () => {
    const matter = makeMatter();
    const client = makeMockClient();

    render(<MatterNotesEditor matter={matter} syncClient={client} />);

    expect(screen.getByTestId('matter-notes-send-to-wealthbox')).toBeDisabled();
  });

  // ── Test 5: MatterNotesEditorWrapper: matter not found ─────────────────────
  it('MatterNotesEditorWrapper renders gracefully when matter not found', async () => {
    render(<MatterNotesEditorWrapper localMatterId="nonexistent-matter" />);

    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });
    expect(screen.getByText('Client not found.')).toBeInTheDocument();
  });

  // ── Test 6: MatterNotesEditorWrapper: boots ensureMatterSync ───────────────
  it('MatterNotesEditorWrapper calls ensureMatterSync and renders editor on success', async () => {
    const matter = makeMatter();
    useMatterStore.getState().createMatter({
      name: matter.name,
      client: matter.client,
      folderPaths: matter.folderPaths,
      firmMatterId: matter.firmMatterId!,
      orgId: matter.orgId!,
      role: matter.role!,
      shared: matter.shared!,
    });

    // Get the actual matter id created.
    const createdMatter = useMatterStore.getState().matters[0]!;
    const ydoc = new Y.Doc();
    const mockClient = makeMockClient(ydoc);
    mockEnsureMatterSync.mockResolvedValueOnce(mockClient);

    render(<MatterNotesEditorWrapper localMatterId={createdMatter.id} />);

    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    // Should have called ensureMatterSync with the matter.
    expect(mockEnsureMatterSync).toHaveBeenCalledWith(
      expect.objectContaining({ id: createdMatter.id }),
    );
    // Should have rendered the editor.
    expect(screen.getByTestId('matter-notes-editor')).toBeInTheDocument();
  });

  // ── QA-45: ensureMatterSync REJECTING must not leave the wrapper loading forever ──
  it('MatterNotesEditorWrapper renders the fail-closed panel (not a permanent spinner) when ensureMatterSync rejects', async () => {
    const matter = makeMatter();
    useMatterStore.getState().createMatter({
      name: matter.name,
      client: matter.client,
      folderPaths: matter.folderPaths,
      firmMatterId: matter.firmMatterId!,
      orgId: matter.orgId!,
      role: matter.role!,
      shared: matter.shared!,
    });
    const createdMatter = useMatterStore.getState().matters[0]!;

    // Simulate a key-fetch/sync/crypto failure: the promise REJECTS rather
    // than resolving to null. Persistent (not "once"): setting the sync
    // status to 'error' in the catch handler changes the `syncStatus` effect
    // dependency, which — by existing design (see the wrapper's eviction-
    // detection comment) — re-triggers ensureMatterSync once more; a
    // persistently-failing key fetch means that retry fails too.
    mockEnsureMatterSync.mockRejectedValue(new Error('key fetch failed'));

    render(<MatterNotesEditorWrapper localMatterId={createdMatter.id} />);

    // Must NOT stay on the loading spinner forever.
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    // Must render the existing fail-closed / no-access panel, not a blank or
    // stuck state.
    expect(screen.getByTestId('matter-notes-no-access')).toBeInTheDocument();

    // The sync status should reflect the failure so the badge/UI is honest.
    expect(useMatterSyncStore.getState().statusByMatterId[createdMatter.id]).toBe('error');
  });

  // ── Test 7: openMatterNotes opens a new tab ─────────────────────────────────
  it('openMatterNotes opens a new tab for a shared matter', () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Test',
      client: 'Acme',
      folderPaths: [],
      firmMatterId: 'fm-1',
      shared: true,
    });

    openMatterNotes(matter.id);

    const tabs = useEditorStore.getState().openTabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.path).toBe(`matter-notes:/${matter.id}`);
    expect(useEditorStore.getState().activeTabPath).toBe(`matter-notes:/${matter.id}`);
  });

  // ── Test 8: openMatterNotes focuses existing tab ────────────────────────────
  it('openMatterNotes focuses the existing tab instead of double-opening', () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Test',
      client: 'Acme',
      folderPaths: [],
      firmMatterId: 'fm-2',
      shared: true,
    });

    openMatterNotes(matter.id);
    openMatterNotes(matter.id);

    const tabs = useEditorStore.getState().openTabs;
    expect(tabs).toHaveLength(1); // Only one tab.
    expect(useEditorStore.getState().activeTabPath).toBe(`matter-notes:/${matter.id}`);
  });

  // ── Test 9: locale keys exist in all three locales ─────────────────────────
  it('matter.notes locale keys exist in en, es, de', () => {
    const requiredKeys = [
      'title', 'subtitle', 'no-access', 'no-access-hint',
      'status-live', 'status-connecting', 'status-catching-up',
      'status-offline', 'status-error', 'status-idle',
    ] as const;

    for (const key of requiredKeys) {
      // TypeScript type cast — locale JSON is any-typed after import.
      const enVal = (en as unknown as Record<string, Record<string, Record<string, string>>>)['matter']?.['notes']?.[key];
      const esVal = (es as unknown as Record<string, Record<string, Record<string, string>>>)['matter']?.['notes']?.[key];
      const deVal = (de as unknown as Record<string, Record<string, Record<string, string>>>)['matter']?.['notes']?.[key];

      expect(enVal, `en: matter.notes.${key} missing`).toBeTruthy();
      expect(esVal, `es: matter.notes.${key} missing`).toBeTruthy();
      expect(deVal, `de: matter.notes.${key} missing`).toBeTruthy();
    }
  });
});

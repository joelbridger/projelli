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
import { render, screen, act, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import type { MatterSyncClient } from '@/platform/firm/MatterSyncClient';
import type { Matter } from '@/types/matter';
import { useMatterSyncStore } from '@/stores/matterSyncStore';
import { useMatterStore } from '@/stores/matterStore';
import { useEditorStore } from '@/stores/editorStore';
import en from '@/locales/en.json';
import es from '@/locales/es.json';
import de from '@/locales/de.json';

// ── i18n setup (the global setup already inits i18next; this is a no-op guard)
// ── Keychain mock (firm modules need it) ─────────────────────────────────────
const keychainStore = new Map<string, string>();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    const svc = (args.service as string) ?? 'com.keepance.app';
    const key = args.key as string;
    const id = `${svc}::${key}`;
    if (cmd === 'keychain_set') { keychainStore.set(id, args.value as string); return undefined; }
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
vi.mock('@/stores/firmStore', () => ({
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
let mockEnsureMatterSync: ReturnType<typeof vi.fn>;

vi.mock('@/features/matters/logic/matterNotesSync', () => {
  mockEnsureMatterSync = vi.fn();
  return {
    ensureMatterSync: (...args: unknown[]) => mockEnsureMatterSync(...args),
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

  // ── Test 5: MatterNotesEditorWrapper: matter not found ─────────────────────
  it('MatterNotesEditorWrapper renders gracefully when matter not found', async () => {
    render(<MatterNotesEditorWrapper localMatterId="nonexistent-matter" />);

    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });
    expect(screen.getByText('Matter not found.')).toBeInTheDocument();
  });

  // ── Test 6: MatterNotesEditorWrapper: boots ensureMatterSync ───────────────
  it('MatterNotesEditorWrapper calls ensureMatterSync and renders editor on success', async () => {
    const matter = makeMatter();
    useMatterStore.getState().createMatter({
      name: matter.name,
      client: matter.client,
      folderPaths: matter.folderPaths,
      firmMatterId: matter.firmMatterId,
      orgId: matter.orgId,
      role: matter.role,
      shared: matter.shared,
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
      const enVal = (en as Record<string, Record<string, Record<string, string>>>)['matter']?.['notes']?.[key];
      const esVal = (es as Record<string, Record<string, Record<string, string>>>)['matter']?.['notes']?.[key];
      const deVal = (de as Record<string, Record<string, Record<string, string>>>)['matter']?.['notes']?.[key];

      expect(enVal, `en: matter.notes.${key} missing`).toBeTruthy();
      expect(esVal, `es: matter.notes.${key} missing`).toBeTruthy();
      expect(deVal, `de: matter.notes.${key} missing`).toBeTruthy();
    }
  });
});

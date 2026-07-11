import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OneDriveConnect } from '@/platform/connectors/onedrive/OneDriveConnect';
import { AuditService } from '@/platform/audit/AuditService';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import type { OneDriveSyncReport } from '@/platform/utils/onedrive-commands';
import { ONEDRIVE_SYNC_TIMEOUT_MS } from '@/platform/connectors/onedrive/onedriveTimeout';
import { useOneDriveStore } from '@/platform/connectors/onedrive/onedriveStore';

const oneDriveCancel = vi.fn();
const oneDriveConnect = vi.fn();
const oneDriveConnectCancel = vi.fn();
const oneDriveDisconnect = vi.fn();
const oneDriveIsConnected = vi.fn();
const oneDriveListFolders = vi.fn();
const oneDriveSync = vi.fn();

vi.mock('@/platform/utils/onedrive-commands', () => ({
  ONEDRIVE_SYNC_EVENT: 'onedrive-sync-progress',
  oneDriveCancel: (...args: unknown[]) => oneDriveCancel(...args),
  oneDriveConnect: (...args: unknown[]) => oneDriveConnect(...args),
  oneDriveConnectCancel: (...args: unknown[]) => oneDriveConnectCancel(...args),
  oneDriveDisconnect: (...args: unknown[]) => oneDriveDisconnect(...args),
  oneDriveIsConnected: (...args: unknown[]) => oneDriveIsConnected(...args),
  oneDriveListFolders: (...args: unknown[]) => oneDriveListFolders(...args),
  oneDriveSync: (...args: unknown[]) => oneDriveSync(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@/platform/matter/matterStore', () => ({
  getMatters: vi.fn().mockReturnValue([]),
  useMatterStore: (
    selector: (s: { addOneDriveFolderKey: () => void; addFolderPath: () => void }) => unknown
  ) => selector({ addOneDriveFolderKey: vi.fn(), addFolderPath: vi.fn() }),
}));

vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => ({ rootPath: null }) },
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  buildOneDriveMatterMap: vi.fn().mockReturnValue([]),
  isLinkableOneDriveClientFolder: vi.fn().mockReturnValue(false),
  resolveMatterForOneDriveFolder: vi.fn().mockReturnValue({ action: 'skip' }),
  oneDriveDestFolderForMatter: vi.fn().mockReturnValue(null),
}));

// Real Tauri isn't present under jsdom; force the connected panel to render.
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));

function report(overrides: Partial<OneDriveSyncReport> = {}): OneDriveSyncReport {
  return {
    seen: 0,
    downloaded: 0,
    imported: 0,
    indexed: 0,
    skippedUnchanged: 0,
    removed: 0,
    pendingPdf: 0,
    unsupported: 0,
    repaired: 0,
    deltaReset: false,
    cancelled: false,
    errors: [],
    ...overrides,
  };
}

const OFFLINE_BLOCK = 'Offline Mode is on. Lantern cannot connect to the internet.';

describe('OneDriveConnect Sync now button', () => {
  let logDurable: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.getState().resetAll();
    oneDriveIsConnected.mockResolvedValue(true);
    oneDriveListFolders.mockResolvedValue([]);
    oneDriveConnect.mockResolvedValue(undefined);
    oneDriveDisconnect.mockResolvedValue(undefined);
    oneDriveCancel.mockResolvedValue(undefined);
    oneDriveConnectCancel.mockResolvedValue(undefined);
    logDurable = vi
      .spyOn(AuditService.prototype, 'logDurable')
      .mockResolvedValue({} as never);
  });

  it('fires the sync when clicked, from a freshly rendered connected state with no explicit confidentiality choice persisted yet', async () => {
    // Regression for the bug: OneDriveConnect used to call the fail-closed
    // `assertLocalOnlyAllowsExternal`, which blocks any external op unless the
    // confidentiality mode was EXPLICITLY persisted as 'direct'/'assured' —
    // exactly the state of a fresh install, or a seeded/test workspace like
    // the one that first surfaced this bug, where localStorage is empty and
    // nothing has explicitly recorded a choice yet. The reactive UI (the
    // button itself, and the local-only banner) correctly shows "not
    // local-only" from the schema default, so the button rendered enabled
    // with no warning — but clicking it silently hit the stricter guard and
    // errored out with a misleading "Local-only mode is on" message. Empty
    // localStorage here reproduces exactly that unconfirmed-choice state.
    oneDriveSync.mockResolvedValue(report({ seen: 3, imported: 2, indexed: 2 }));

    render(<OneDriveConnect />);

    const button = await screen.findByRole('button', { name: 'Sync now' });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    await waitFor(() => {
      expect(oneDriveSync).toHaveBeenCalled();
    });
    expect(await screen.findByText(/imported 2 files into your client folders/i)).toBeTruthy();
    expect(screen.queryByText(/local-only mode is on/i)).toBeNull();
    await waitFor(() => {
      expect(logDurable).toHaveBeenCalledWith(
        'onedrive.sync',
        expect.stringContaining('imported 2 file'),
        expect.objectContaining({ outputs: expect.objectContaining({ imported: 2 }) })
      );
    });
  });

  it('leaves Local AI only free to start a connector sync', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');
    oneDriveSync.mockResolvedValue(report({ seen: 3, imported: 2, indexed: 2 }));

    render(<OneDriveConnect />);

    const button = await screen.findByRole('button', { name: 'Sync now' });
    fireEvent.click(button);

    await waitFor(() => expect(oneDriveSync).toHaveBeenCalled());
  });

  it('stops before bulk sync when Offline Mode turns on during folder listing', async () => {
    // The native command is the source of truth, including during any UI
    // hydration window. A refusal during the pre-sync listing must prevent
    // the later bulk sync from beginning.
    oneDriveListFolders.mockRejectedValue(new Error(OFFLINE_BLOCK));

    render(<OneDriveConnect />);

    const button = await screen.findByRole('button', { name: 'Sync now' });
    fireEvent.click(button);

    expect(await screen.findByText((_, element) => element?.textContent === `OneDrive sync ran into a problem: ${OFFLINE_BLOCK}`)).toBeTruthy();
    expect(oneDriveSync).not.toHaveBeenCalled();
  });
});

describe('OneDriveConnect settle-guarantee (fix/onedrive-sync-silence)', () => {
  let logDurable: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.getState().resetAll();
    // The onedriveStore Zustand singleton isn't mocked in this file (the
    // component reads/writes it directly), so its `progress` slice must be
    // reset per test — otherwise a prior test's terminal status (e.g. the
    // 'error' this round's P2-a fix now sets) leaks into the next test's
    // initial render.
    useOneDriveStore.setState({ progress: null });
    oneDriveIsConnected.mockResolvedValue(true);
    oneDriveConnect.mockResolvedValue(undefined);
    oneDriveDisconnect.mockResolvedValue(undefined);
    oneDriveCancel.mockResolvedValue(undefined);
    oneDriveConnectCancel.mockResolvedValue(undefined);
    logDurable = vi
      .spyOn(AuditService.prototype, 'logDurable')
      .mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a permanently-hanging oneDriveSync call ends in an honest timeout error and an audit row, never total silence (bench pass-3 regression)', async () => {
    oneDriveListFolders.mockResolvedValue([]);
    // The exact regression: the awaited invoke() never resolves or rejects.
    oneDriveSync.mockReturnValue(new Promise<OneDriveSyncReport>(() => {}));

    render(<OneDriveConnect />);
    const button = await screen.findByRole('button', { name: 'Sync now' });

    // Switch to fake timers only now that the component has settled into its
    // connected/idle state — flipping them on before the initial
    // oneDriveIsConnected() effect resolves starves testing-library's own
    // internal polling of real time.
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.click(button);
      // Let the folder-discovery phase (a resolved promise) flush.
      await Promise.resolve();
      await Promise.resolve();
    });

    // Spinner engages immediately — covers both the folder-discovery phase
    // and the (here, stuck) sync phase, not just a Rust-emitted event.
    expect(screen.getByText(/Importing/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Syncing...' })).toBeTruthy();
    expect(screen.queryByText(/ran into a problem/i)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ONEDRIVE_SYNC_TIMEOUT_MS + 50);
    });

    // Honest, visible outcome — never an eternal, silent "Syncing...".
    expect(screen.getByText(/ran into a problem/i)).toBeTruthy();
    expect(screen.getByText(/timed out/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy();
    // And the append-only audit trail recorded the attempt honestly.
    expect(logDurable).toHaveBeenCalledWith(
      'onedrive.sync',
      'OneDrive sync failed.',
      expect.objectContaining({ outputs: expect.objectContaining({ error: 'network' }) })
    );
  }, 15000);

  it('clears a stuck Rust "syncing" progress signal when the frontend timeout backstop fires (round-2 review P2-a)', async () => {
    // round-2 review finding: if onedrive_sync had ALREADY emitted its
    // initial {status:'syncing'} progress event before the command genuinely
    // stalled (no Rust-side terminal event ever coming), the old code only
    // called setError() in the catch — `progress.status` stayed 'syncing'
    // forever, and since `syncing` is derived as
    // `localSyncing || progress?.status === 'syncing'`, the spinner and the
    // disabled button never cleared even though localSyncing had already
    // flipped false. The fix must force the derived state to a terminal one.
    oneDriveListFolders.mockResolvedValue([]);
    oneDriveSync.mockReturnValue(new Promise<OneDriveSyncReport>(() => {}));

    render(<OneDriveConnect />);
    const button = await screen.findByRole('button', { name: 'Sync now' });
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Simulate the Rust command having already emitted its initial "syncing"
    // progress event (exactly what onedrive_sync does before any await that
    // could stall) — this is the specific race the fix must survive.
    act(() => {
      useOneDriveStore.getState().setProgress({ status: 'syncing', seen: 3 });
    });
    expect(screen.getByRole('button', { name: 'Syncing...' })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ONEDRIVE_SYNC_TIMEOUT_MS + 50);
    });

    // Terminal, visible outcome — the stuck 'syncing' signal must not win.
    expect(screen.getByText(/ran into a problem/i)).toBeTruthy();
    expect(screen.queryByText(/Importing/i)).toBeNull();
    const finalButton = screen.getByRole('button', { name: 'Sync now' });
    expect(finalButton).toBeTruthy();
    expect(finalButton).not.toBeDisabled();
  }, 15000);

  it('shows the Importing spinner during the folder-discovery phase, before onedrive_sync even starts', async () => {
    let resolveListFolders: (folders: []) => void = () => {};
    oneDriveListFolders.mockReturnValue(
      new Promise((resolve) => {
        resolveListFolders = resolve;
      })
    );
    oneDriveSync.mockResolvedValue(report({ seen: 1, imported: 1, indexed: 1 }));

    render(<OneDriveConnect />);
    const button = await screen.findByRole('button', { name: 'Sync now' });
    fireEvent.click(button);

    // Folder discovery is still pending — oneDriveSync must not have run yet —
    // but the UI must already show a visible in-progress signal, not silence.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Syncing...' })).toBeTruthy();
    });
    expect(oneDriveSync).not.toHaveBeenCalled();

    resolveListFolders([]);
    await waitFor(() => {
      expect(oneDriveSync).toHaveBeenCalled();
    });
    expect(await screen.findByText(/imported 1 file/i)).toBeTruthy();
  });

  it('clicking Stop during the folder-discovery phase ends the sync honestly, not as a red error', async () => {
    let resolveListFolders: (err: Error) => void = () => {};
    oneDriveListFolders.mockReturnValue(
      new Promise((_resolve, reject) => {
        resolveListFolders = reject;
      })
    );

    render(<OneDriveConnect />);
    const button = await screen.findByRole('button', { name: 'Sync now' });
    fireEvent.click(button);

    const stopButton = await screen.findByRole('button', { name: 'Stop' });
    fireEvent.click(stopButton);
    expect(oneDriveCancel).toHaveBeenCalled();

    // Simulate the Rust command honoring the cancel and rejecting with the
    // same sentinel oneDriveConnect() already uses for a user-initiated stop.
    await act(async () => {
      resolveListFolders(new Error('cancelled'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy();
    });
    expect(screen.queryByText(/ran into a problem/i)).toBeNull();
    expect(oneDriveSync).not.toHaveBeenCalled();
    // The stop is a VISIBLE outcome, not a silent return to idle — reuses the
    // same "Import stopped." copy a stop mid-sync already shows.
    expect(screen.getByText(/import stopped/i)).toBeTruthy();
    // Still an honest, audited attempt even though nothing was imported.
    expect(logDurable).toHaveBeenCalledWith(
      'onedrive.sync',
      'OneDrive sync failed.',
      expect.objectContaining({ outputs: expect.objectContaining({ error: 'cancelled' }) })
    );
  });

  it('a stop during folder discovery does not leave a stale "Imported..." result from a PRIOR successful sync visible', async () => {
    // Second-round Codex review finding: stopping mid-listing set the
    // cancelled `progress` state but never cleared a previous run's
    // `lastReport`, so an old "Imported N files..." success line could still
    // render right alongside the new "Import stopped." — making the just-
    // stopped attempt look like it had succeeded with stale counts.
    oneDriveListFolders.mockResolvedValueOnce([]);
    oneDriveSync.mockResolvedValueOnce(report({ seen: 5, imported: 5, indexed: 5 }));

    render(<OneDriveConnect />);
    const button = await screen.findByRole('button', { name: 'Sync now' });
    fireEvent.click(button);
    expect(await screen.findByText(/imported 5 files into your client folders/i)).toBeTruthy();

    let resolveListFolders: (err: Error) => void = () => {};
    oneDriveListFolders.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        resolveListFolders = reject;
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    const stopButton = await screen.findByRole('button', { name: 'Stop' });
    fireEvent.click(stopButton);

    await act(async () => {
      resolveListFolders(new Error('cancelled'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/import stopped/i)).toBeTruthy();
    });
    expect(screen.queryByText(/imported 5 files/i)).toBeNull();
  });
});

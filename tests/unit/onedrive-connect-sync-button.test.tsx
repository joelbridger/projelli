import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OneDriveConnect } from '@/platform/connectors/onedrive/OneDriveConnect';
import { AuditService } from '@/platform/audit/AuditService';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import type { OneDriveSyncReport } from '@/platform/utils/onedrive-commands';

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
    ...overrides,
  };
}

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

  it('still blocks the sync when the confidentiality mode is genuinely local-only', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');

    render(<OneDriveConnect />);

    expect(
      await screen.findByText(/local-only mode is on, so oneDrive sync is paused/i)
    ).toBeTruthy();
    const button = await screen.findByRole('button', { name: 'Sync now' });
    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(oneDriveSync).not.toHaveBeenCalled();
  });
});

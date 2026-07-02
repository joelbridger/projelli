import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxConnect } from '@/platform/connectors/box/BoxConnect';
import { AuditService } from '@/platform/audit/AuditService';
import type { BoxSyncReport } from '@/platform/utils/box-commands';

const boxCancel = vi.fn();
const boxConnect = vi.fn();
const boxDisconnect = vi.fn();
const boxIsConnected = vi.fn();
const boxListFolders = vi.fn();
const boxStatus = vi.fn();
const boxSync = vi.fn();

vi.mock('@/platform/utils/box-commands', () => ({
  BOX_SYNC_EVENT: 'box-sync-progress',
  boxCancel: (...args: unknown[]) => boxCancel(...args),
  boxConnect: (...args: unknown[]) => boxConnect(...args),
  boxDisconnect: (...args: unknown[]) => boxDisconnect(...args),
  boxIsConnected: (...args: unknown[]) => boxIsConnected(...args),
  boxListFolders: (...args: unknown[]) => boxListFolders(...args),
  boxStatus: (...args: unknown[]) => boxStatus(...args),
  boxSync: (...args: unknown[]) => boxSync(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@/platform/matter/matterStore', () => ({
  getMatters: vi.fn().mockReturnValue([]),
  useMatterStore: (selector: (s: { addBoxFolderKey: () => void }) => unknown) =>
    selector({ addBoxFolderKey: vi.fn() }),
}));

vi.mock('@/platform/privacy/localOnlyGuard', () => ({
  isLocalOnlyMode: vi.fn().mockReturnValue(false),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  buildBoxMatterMap: vi.fn().mockReturnValue([]),
  isTopLevelBoxClientFolder: vi.fn().mockReturnValue(false),
  resolveMatterForBoxFolder: vi.fn().mockReturnValue({ action: 'skip' }),
}));

// Real Tauri isn't present under jsdom; force the connected panel to render.
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));

function report(overrides: Partial<BoxSyncReport> = {}): BoxSyncReport {
  return {
    seen: 0,
    downloaded: 0,
    indexed: 0,
    skippedUnchanged: 0,
    removed: 0,
    pendingPdf: 0,
    unsupported: 0,
    repaired: 0,
    cancelled: false,
    ...overrides,
  };
}

describe('BoxConnect honest sync feedback + durable audit', () => {
  let logDurable: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    boxIsConnected.mockResolvedValue(true);
    boxStatus.mockResolvedValue({ isSyncing: false, lastReport: null });
    boxListFolders.mockResolvedValue([]);
    boxConnect.mockResolvedValue(undefined);
    boxDisconnect.mockResolvedValue(undefined);
    boxCancel.mockResolvedValue(undefined);
    logDurable = vi
      .spyOn(AuditService.prototype, 'logDurable')
      .mockResolvedValue({} as never);
  });

  it('shows the indexed counts and writes a success audit row with counts', async () => {
    boxSync.mockResolvedValue(report({ seen: 9, downloaded: 2, indexed: 5, skippedUnchanged: 4 }));

    render(<BoxConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync Box files' }));

    expect(await screen.findByText(/checked 9 items, downloaded 2, indexed 5/i)).toBeTruthy();
    await waitFor(() => {
      expect(logDurable).toHaveBeenCalledWith(
        'box.sync',
        expect.stringContaining('downloaded 2 file'),
        expect.objectContaining({ outputs: expect.objectContaining({ downloaded: 2, indexed: 5 }) })
      );
    });
  });

  it('surfaces an error and writes a failure audit row with a sanitized category', async () => {
    boxSync.mockRejectedValue(new Error('HTTP 401 unauthorized for token xyz'));

    render(<BoxConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync Box files' }));

    await waitFor(() => {
      expect(logDurable).toHaveBeenCalledWith(
        'box.sync',
        'Box sync failed.',
        // Category only — the raw "token xyz" text must never reach the audit row.
        { outputs: { error: 'auth_expired' } }
      );
    });
    const failureCall = logDurable.mock.calls.find((c) => c[1] === 'Box sync failed.');
    expect(JSON.stringify(failureCall)).not.toContain('xyz');
  });
});

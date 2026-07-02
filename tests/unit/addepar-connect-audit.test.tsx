import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddeparConnect } from '@/platform/connectors/addepar/AddeparConnect';
import { AuditService } from '@/platform/audit/AuditService';
import type { AddeparSyncReport } from '@/platform/utils/addepar-commands';

const addeparCancel = vi.fn();
const addeparConnect = vi.fn();
const addeparDisconnect = vi.fn();
const addeparIsConnected = vi.fn();
const addeparListEntities = vi.fn();
const addeparSync = vi.fn();

vi.mock('@/platform/utils/addepar-commands', () => ({
  ADDEPAR_SYNC_EVENT: 'addepar-sync-progress',
  addeparCancel: (...args: unknown[]) => addeparCancel(...args),
  addeparConnect: (...args: unknown[]) => addeparConnect(...args),
  addeparDisconnect: (...args: unknown[]) => addeparDisconnect(...args),
  addeparIsConnected: (...args: unknown[]) => addeparIsConnected(...args),
  addeparListEntities: (...args: unknown[]) => addeparListEntities(...args),
  addeparSync: (...args: unknown[]) => addeparSync(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@/platform/matter/matterStore', () => ({
  getMatters: vi.fn().mockReturnValue([]),
  useMatterStore: (selector: (s: { addAddeparKey: () => void }) => unknown) =>
    selector({ addAddeparKey: vi.fn() }),
}));

vi.mock('@/platform/privacy/localOnlyGuard', () => ({
  isLocalOnlyMode: vi.fn().mockReturnValue(false),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  buildAddeparMatterMap: vi.fn().mockReturnValue([]),
  normalizeClientName: (s: string) => s.trim().toLowerCase(),
}));

// Real Tauri isn't present under jsdom; force the connected panel to render.
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));

function report(overrides: Partial<AddeparSyncReport> = {}): AddeparSyncReport {
  return {
    entitiesFetched: 0,
    householdsProcessed: 0,
    recordsIndexed: 0,
    needsAssignment: 0,
    cancelled: false,
    ...overrides,
  };
}

describe('AddeparConnect honest sync feedback + durable audit', () => {
  let logDurable: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    addeparIsConnected.mockResolvedValue(true);
    addeparListEntities.mockResolvedValue([]);
    addeparConnect.mockResolvedValue({ subdomain: 'demo', firmId: '1' });
    addeparDisconnect.mockResolvedValue({ tokenDeleted: true, ragPurged: true, dataRemains: false, warnings: [] });
    addeparCancel.mockResolvedValue(undefined);
    logDurable = vi
      .spyOn(AuditService.prototype, 'logDurable')
      .mockResolvedValue({} as never);
  });

  it('shows the indexed counts and writes a success audit row with counts', async () => {
    addeparSync.mockResolvedValue(report({ entitiesFetched: 4, householdsProcessed: 3, recordsIndexed: 12, needsAssignment: 1 }));

    render(<AddeparConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync households' }));

    expect(await screen.findByText(/found 4 households.*indexed 12 records/i)).toBeTruthy();
    await waitFor(() => {
      expect(logDurable).toHaveBeenCalledWith(
        'addepar.sync',
        expect.stringContaining('indexed 12 record'),
        expect.objectContaining({ outputs: expect.objectContaining({ recordsIndexed: 12 }) })
      );
    });
  });

  it('surfaces an error and writes a failure audit row with a sanitized category', async () => {
    addeparSync.mockRejectedValue(new Error('HTTP 401 unauthorized for token xyz'));

    render(<AddeparConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync households' }));

    await waitFor(() => {
      expect(logDurable).toHaveBeenCalledWith(
        'addepar.sync',
        'Addepar sync failed.',
        // Category only — the raw "token xyz" text must never reach the audit row.
        { outputs: { error: 'auth_expired' } }
      );
    });
    const failureCall = logDurable.mock.calls.find(
      (c: Parameters<AuditService['logDurable']>) => c[1] === 'Addepar sync failed.'
    );
    expect(JSON.stringify(failureCall)).not.toContain('xyz');
  });
});

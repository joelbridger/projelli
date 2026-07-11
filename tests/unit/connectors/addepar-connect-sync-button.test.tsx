import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddeparConnect } from '@/platform/connectors/addepar/AddeparConnect';
import { useSettingsStore } from '@/platform/settings/settingsStore';
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

vi.mock('@/platform/rag/matterResolver', () => ({
  buildAddeparMatterMap: vi.fn().mockReturnValue([]),
  normalizeClientName: (s: string) => String(s).trim().toLowerCase(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));

function report(overrides: Partial<AddeparSyncReport> = {}): AddeparSyncReport {
  return {
    entitiesFetched: 0,
    householdsProcessed: 0,
    recordsIndexed: 0,
    needsAssignment: 0,
    cancelled: false,
    ...overrides,
  } as AddeparSyncReport;
}

async function connectFields() {
  fireEvent.change(await screen.findByLabelText('API key'), { target: { value: 'k' } });
  fireEvent.change(screen.getByLabelText('API secret'), { target: { value: 's' } });
  fireEvent.change(screen.getByLabelText('Firm subdomain'), { target: { value: 'acme' } });
  fireEvent.change(screen.getByLabelText('Firm id'), { target: { value: '1' } });
}

const OFFLINE_BLOCK = 'Offline Mode is on. Lantern cannot connect to the internet.';

describe('AddeparConnect Offline Mode guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.getState().resetAll();
    addeparIsConnected.mockResolvedValue(true);
    addeparListEntities.mockResolvedValue([]);
    addeparConnect.mockResolvedValue({ subdomain: 'acme', firmId: '1' });
    addeparDisconnect.mockResolvedValue({ tokenDeleted: true, ragPurged: true, dataRemains: false, warnings: [] });
    addeparCancel.mockResolvedValue(undefined);
  });

  it('fires the sync when clicked with no explicit confidentiality choice persisted yet', async () => {
    addeparSync.mockResolvedValue(report({ entitiesFetched: 2, recordsIndexed: 2 }));

    render(<AddeparConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync households' }));

    await waitFor(() => {
      expect(addeparSync).toHaveBeenCalled();
    });
    expect(screen.queryByText(/offline mode is on/i)).toBeNull();
  });

  it('allows the sync when the persisted mode is explicitly direct', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'direct');
    addeparSync.mockResolvedValue(report());

    render(<AddeparConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync households' }));

    await waitFor(() => {
      expect(addeparSync).toHaveBeenCalled();
    });
  });

  it('shows the native Offline Mode refusal before a sync can begin', async () => {
    addeparListEntities.mockRejectedValue(new Error(OFFLINE_BLOCK));

    render(<AddeparConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync households' }));

    expect(
      await screen.findByText(OFFLINE_BLOCK)
    ).toBeTruthy();
    expect(addeparSync).not.toHaveBeenCalled();
  });

  it('leaves Local AI only free to start a connector sync', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');
    addeparSync.mockResolvedValue(report());

    render(<AddeparConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync households' }));

    await waitFor(() => expect(addeparSync).toHaveBeenCalled());
  });

  it('stops before bulk sync when Offline Mode turns on during household listing', async () => {
    addeparListEntities.mockImplementation(async () => {
      throw new Error(OFFLINE_BLOCK);
    });
    addeparSync.mockResolvedValue(report());

    render(<AddeparConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync households' }));

    expect(
      await screen.findByText(OFFLINE_BLOCK)
    ).toBeTruthy();
    expect(addeparSync).not.toHaveBeenCalled();
  });

  it('shows the native Offline Mode refusal before connecting Addepar', async () => {
    addeparIsConnected.mockResolvedValue(false);
    addeparConnect.mockRejectedValue(new Error(OFFLINE_BLOCK));

    render(<AddeparConnect />);
    await connectFields();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Addepar' }));

    expect(
      await screen.findByText(OFFLINE_BLOCK)
    ).toBeTruthy();
    expect(addeparConnect).toHaveBeenCalledOnce();
  });
});

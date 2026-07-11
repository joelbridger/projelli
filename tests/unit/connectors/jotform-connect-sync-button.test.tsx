import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JotformConnect } from '@/platform/connectors/jotform/JotformConnect';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import type { JotformSyncReport } from '@/platform/utils/jotform-commands';

const jotformCancel = vi.fn();
const jotformConnect = vi.fn();
const jotformDisconnect = vi.fn();
const jotformIsConnected = vi.fn();
const jotformListForms = vi.fn();
const jotformListUnassigned = vi.fn();
const jotformSync = vi.fn();

vi.mock('@/platform/utils/jotform-commands', () => ({
  JOTFORM_SYNC_EVENT: 'jotform-sync-progress',
  jotformCancel: (...args: unknown[]) => jotformCancel(...args),
  jotformConnect: (...args: unknown[]) => jotformConnect(...args),
  jotformDisconnect: (...args: unknown[]) => jotformDisconnect(...args),
  jotformIsConnected: (...args: unknown[]) => jotformIsConnected(...args),
  jotformListForms: (...args: unknown[]) => jotformListForms(...args),
  jotformListUnassigned: (...args: unknown[]) => jotformListUnassigned(...args),
  jotformSync: (...args: unknown[]) => jotformSync(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@/platform/matter/matterStore', () => ({
  getMatters: vi.fn().mockReturnValue([]),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  buildJotformMatterMap: vi.fn().mockReturnValue([]),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));

function report(overrides: Partial<JotformSyncReport> = {}): JotformSyncReport {
  return {
    formsFetched: 0,
    submissionsFetched: 0,
    recordsIndexed: 0,
    needsAssignment: 0,
    ...overrides,
  } as JotformSyncReport;
}

const OFFLINE_BLOCK = 'Offline Mode is on. Lantern cannot connect to the internet.';

describe('JotformConnect Offline Mode guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.getState().resetAll();
    jotformIsConnected.mockResolvedValue(true);
    jotformListForms.mockResolvedValue([]);
    jotformListUnassigned.mockResolvedValue([]);
    jotformConnect.mockResolvedValue({ name: 'Acme', email: '', username: '' });
    jotformDisconnect.mockResolvedValue({ tokenDeleted: true, ragPurged: true, dataRemains: false, warnings: [] });
    jotformCancel.mockResolvedValue(undefined);
  });

  it('fires the sync when clicked with no explicit confidentiality choice persisted yet', async () => {
    jotformSync.mockResolvedValue(report({ formsFetched: 1, submissionsFetched: 2, recordsIndexed: 2 }));

    render(<JotformConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync submissions' }));

    await waitFor(() => {
      expect(jotformSync).toHaveBeenCalled();
    });
    expect(screen.queryByText(/offline mode is on/i)).toBeNull();
  });

  it('allows the sync when the persisted mode is explicitly direct', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'direct');
    jotformSync.mockResolvedValue(report());

    render(<JotformConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync submissions' }));

    await waitFor(() => {
      expect(jotformSync).toHaveBeenCalled();
    });
  });

  it('shows the native Offline Mode refusal before a sync can begin', async () => {
    jotformSync.mockRejectedValue(new Error(OFFLINE_BLOCK));

    render(<JotformConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync submissions' }));

    expect(
      await screen.findByText(OFFLINE_BLOCK)
    ).toBeTruthy();
    expect(jotformSync).toHaveBeenCalledOnce();
  });

  it('leaves Local AI only free to start a connector sync', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');
    jotformSync.mockResolvedValue(report());

    render(<JotformConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync submissions' }));

    await waitFor(() => expect(jotformSync).toHaveBeenCalled());
  });

  it('shows the native Offline Mode refusal before connecting Jotform', async () => {
    jotformIsConnected.mockResolvedValue(false);
    jotformConnect.mockRejectedValue(new Error(OFFLINE_BLOCK));

    render(<JotformConnect />);
    fireEvent.change(await screen.findByPlaceholderText('Jotform API key'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Jotform' }));

    expect(
      await screen.findByText(OFFLINE_BLOCK)
    ).toBeTruthy();
    expect(jotformConnect).toHaveBeenCalledOnce();
  });

  it('stops follow-up work when Offline Mode cancels an in-progress connect', async () => {
    jotformIsConnected.mockResolvedValue(false);
    jotformConnect.mockImplementation(async () => {
      throw new Error(OFFLINE_BLOCK);
    });

    render(<JotformConnect />);
    fireEvent.change(await screen.findByPlaceholderText('Jotform API key'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Jotform' }));

    await waitFor(() => {
      expect(jotformConnect).toHaveBeenCalled();
    });
    expect(await screen.findByText(OFFLINE_BLOCK)).toBeTruthy();
    expect(jotformListForms).not.toHaveBeenCalled();
  });

  it('stops post-sync refreshes when Offline Mode cancels the sync', async () => {
    jotformSync.mockImplementation(async () => {
      throw new Error(OFFLINE_BLOCK);
    });

    render(<JotformConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync submissions' }));

    await waitFor(() => {
      expect(jotformSync).toHaveBeenCalled();
    });
    expect(await screen.findByText(OFFLINE_BLOCK)).toBeTruthy();
    expect(jotformListForms).not.toHaveBeenCalled();
    expect(jotformListUnassigned).not.toHaveBeenCalled();
  });

  it('stops the second follow-up when Offline Mode cancels the first refresh', async () => {
    jotformSync.mockResolvedValue(report());
    jotformListForms.mockImplementation(async () => {
      throw new Error(OFFLINE_BLOCK);
    });

    render(<JotformConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync submissions' }));

    await waitFor(() => {
      expect(jotformListForms).toHaveBeenCalled();
    });
    expect(await screen.findByText(OFFLINE_BLOCK)).toBeTruthy();
    expect(jotformListUnassigned).not.toHaveBeenCalled();
  });
});

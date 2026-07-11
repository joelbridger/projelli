import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocuSignConnect } from '@/platform/connectors/docusign/DocuSignConnect';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import type { DocusignSyncReport } from '@/platform/utils/docusign-commands';

const docusignCancelSync = vi.fn();
const docusignConnect = vi.fn();
const docusignDisconnect = vi.fn();
const docusignIsConnected = vi.fn();
const docusignListUnassigned = vi.fn();
const docusignSync = vi.fn();

vi.mock('@/platform/utils/docusign-commands', () => ({
  DOCUSIGN_SYNC_EVENT: 'docusign-sync-progress',
  docusignCancelSync: (...args: unknown[]) => docusignCancelSync(...args),
  docusignConnect: (...args: unknown[]) => docusignConnect(...args),
  docusignDisconnect: (...args: unknown[]) => docusignDisconnect(...args),
  docusignIsConnected: (...args: unknown[]) => docusignIsConnected(...args),
  docusignListUnassigned: (...args: unknown[]) => docusignListUnassigned(...args),
  docusignSync: (...args: unknown[]) => docusignSync(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@/platform/matter/matterStore', () => ({
  getMatters: vi.fn().mockReturnValue([]),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  buildEsignMatterMap: vi.fn().mockReturnValue([]),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));

function report(overrides: Partial<DocusignSyncReport> = {}): DocusignSyncReport {
  return {
    envelopesFetched: 0,
    recordsIndexed: 0,
    needsAssignment: 0,
    ...overrides,
  } as DocusignSyncReport;
}

const OFFLINE_BLOCK = 'Offline Mode is on. Lantern cannot connect to the internet.';

describe('DocuSignConnect Offline Mode guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.getState().resetAll();
    docusignIsConnected.mockResolvedValue(true);
    docusignListUnassigned.mockResolvedValue([]);
    docusignConnect.mockResolvedValue({ accountId: '1', accountName: 'Acme' });
    docusignDisconnect.mockResolvedValue({ tokenDeleted: true, ragPurged: true, dataRemains: false, warnings: [] });
    docusignCancelSync.mockResolvedValue(undefined);
  });

  it('fires the sync when clicked with no explicit confidentiality choice persisted yet', async () => {
    docusignSync.mockResolvedValue(report({ envelopesFetched: 2, recordsIndexed: 2 }));

    render(<DocuSignConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync completed envelopes' }));

    await waitFor(() => {
      expect(docusignSync).toHaveBeenCalled();
    });
    expect(screen.queryByText(/offline mode is on/i)).toBeNull();
  });

  it('allows the sync when the persisted mode is explicitly direct', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'direct');
    docusignSync.mockResolvedValue(report());

    render(<DocuSignConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync completed envelopes' }));

    await waitFor(() => {
      expect(docusignSync).toHaveBeenCalled();
    });
  });

  it('shows the native Offline Mode refusal before a sync can begin', async () => {
    docusignSync.mockRejectedValue(new Error(OFFLINE_BLOCK));

    render(<DocuSignConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync completed envelopes' }));

    expect(
      await screen.findByText(OFFLINE_BLOCK)
    ).toBeTruthy();
    expect(docusignSync).toHaveBeenCalledOnce();
  });

  it('leaves Local AI only free to start a connector sync', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');
    docusignSync.mockResolvedValue(report());

    render(<DocuSignConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync completed envelopes' }));

    await waitFor(() => expect(docusignSync).toHaveBeenCalled());
  });

  it('shows the native Offline Mode refusal before connecting DocuSign', async () => {
    docusignIsConnected.mockResolvedValue(false);
    docusignConnect.mockRejectedValue(new Error(OFFLINE_BLOCK));

    render(<DocuSignConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect DocuSign' }));

    expect(
      await screen.findByText(OFFLINE_BLOCK)
    ).toBeTruthy();
    expect(docusignConnect).toHaveBeenCalledOnce();
  });

  it('shows the native Offline Mode refusal when it is turned on after connection', async () => {
    render(<DocuSignConnect />);
    await screen.findByRole('button', { name: 'Sync completed envelopes' });

    docusignSync.mockRejectedValue(new Error(OFFLINE_BLOCK));
    fireEvent.click(screen.getByRole('button', { name: 'Sync completed envelopes' }));

    expect(
      await screen.findByText(OFFLINE_BLOCK)
    ).toBeTruthy();
    expect(docusignSync).toHaveBeenCalledOnce();
  });

  it('stops follow-up work when Offline Mode cancels an in-progress sync', async () => {
    docusignSync.mockImplementation(async () => {
      throw new Error(OFFLINE_BLOCK);
    });

    render(<DocuSignConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync completed envelopes' }));

    await waitFor(() => {
      expect(docusignSync).toHaveBeenCalled();
    });
    expect(await screen.findByText(OFFLINE_BLOCK)).toBeTruthy();
    expect(docusignListUnassigned).not.toHaveBeenCalled();
  });
});

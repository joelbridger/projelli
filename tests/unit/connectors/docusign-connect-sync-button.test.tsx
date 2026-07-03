import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocuSignConnect } from '@/platform/connectors/docusign/DocuSignConnect';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { SK_SETTINGS } from '@/config/identity';
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

describe('DocuSignConnect Local-only guard', () => {
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
    expect(screen.queryByText(/local-only mode is on/i)).toBeNull();
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

  it('blocks the sync when the confidentiality mode is genuinely local-only', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');

    render(<DocuSignConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync completed envelopes' }));

    expect(
      await screen.findByText(/local-only mode is on\. turn it off before syncing docusign/i)
    ).toBeTruthy();
    expect(docusignSync).not.toHaveBeenCalled();
  });

  it('blocks a genuinely-persisted local-only mode during the settings-store hydration window', async () => {
    localStorage.setItem(
      SK_SETTINGS,
      JSON.stringify({ state: { values: { confidentialityMode: 'local-only' } }, version: 1 })
    );

    render(<DocuSignConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync completed envelopes' }));

    expect(
      await screen.findByText(/local-only mode is on\. turn it off before syncing docusign/i)
    ).toBeTruthy();
    expect(docusignSync).not.toHaveBeenCalled();
  });

  it('blocks Connect DocuSign during the hydration window too', async () => {
    docusignIsConnected.mockResolvedValue(false);
    localStorage.setItem(
      SK_SETTINGS,
      JSON.stringify({ state: { values: { confidentialityMode: 'local-only' } }, version: 1 })
    );

    render(<DocuSignConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect DocuSign' }));

    expect(
      await screen.findByText(/local-only mode is on\. turn it off before connecting docusign/i)
    ).toBeTruthy();
    expect(docusignConnect).not.toHaveBeenCalled();
  });

  it('regression: blocks a sync started long after connect, once the user later switches to local-only', async () => {
    // Before this fix, syncNow() had NO Local-only check at all — a
    // permanent gap, not just a hydration-window race. Once connected
    // (which requires being out of Local-only at connect-time), a user
    // could flip into Local-only mode at any later point and still fire a
    // real network call by clicking "Sync completed envelopes". Simulate
    // that later-in-time flip: the settings store is fully hydrated and
    // genuinely reports local-only well after mount.
    useSettingsStore.getState().setSetting('confidentialityMode', 'direct');
    render(<DocuSignConnect />);
    await screen.findByRole('button', { name: 'Sync completed envelopes' });

    useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');
    fireEvent.click(screen.getByRole('button', { name: 'Sync completed envelopes' }));

    expect(
      await screen.findByText(/local-only mode is on\. turn it off before syncing docusign/i)
    ).toBeTruthy();
    expect(docusignSync).not.toHaveBeenCalled();
  });

  it('regression: skips the post-sync unassigned refresh if the user flips to local-only while docusignSync is still awaiting', async () => {
    docusignSync.mockImplementation(async () => {
      useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');
      return report();
    });

    render(<DocuSignConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync completed envelopes' }));

    await waitFor(() => {
      expect(docusignSync).toHaveBeenCalled();
    });
    expect(docusignListUnassigned).not.toHaveBeenCalled();
  });
});

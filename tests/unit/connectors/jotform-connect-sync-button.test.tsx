import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JotformConnect } from '@/platform/connectors/jotform/JotformConnect';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { SK_SETTINGS } from '@/config/identity';
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

describe('JotformConnect Local-only guard', () => {
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
    expect(screen.queryByText(/local-only mode is on/i)).toBeNull();
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

  it('blocks the sync when the confidentiality mode is genuinely local-only', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');

    render(<JotformConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync submissions' }));

    expect(
      await screen.findByText(/local-only mode is on\. turn it off before syncing jotform/i)
    ).toBeTruthy();
    expect(jotformSync).not.toHaveBeenCalled();
  });

  it('blocks a genuinely-persisted local-only mode during the settings-store hydration window', async () => {
    localStorage.setItem(
      SK_SETTINGS,
      JSON.stringify({ state: { values: { confidentialityMode: 'local-only' } }, version: 1 })
    );

    render(<JotformConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync submissions' }));

    expect(
      await screen.findByText(/local-only mode is on\. turn it off before syncing jotform/i)
    ).toBeTruthy();
    expect(jotformSync).not.toHaveBeenCalled();
  });

  it('blocks Connect Jotform during the hydration window too', async () => {
    jotformIsConnected.mockResolvedValue(false);
    localStorage.setItem(
      SK_SETTINGS,
      JSON.stringify({ state: { values: { confidentialityMode: 'local-only' } }, version: 1 })
    );

    render(<JotformConnect />);
    fireEvent.change(await screen.findByPlaceholderText('Jotform API key'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Jotform' }));

    expect(
      await screen.findByText(/local-only mode is on\. turn it off before connecting jotform/i)
    ).toBeTruthy();
    expect(jotformConnect).not.toHaveBeenCalled();
  });

  it('regression: skips the post-connect forms refresh if the user flips to local-only while jotformConnect is still awaiting', async () => {
    jotformIsConnected.mockResolvedValue(false);
    jotformConnect.mockImplementation(async () => {
      useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');
      return { name: 'Acme', email: '', username: '' };
    });

    render(<JotformConnect />);
    fireEvent.change(await screen.findByPlaceholderText('Jotform API key'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Jotform' }));

    await waitFor(() => {
      expect(jotformConnect).toHaveBeenCalled();
    });
    expect(jotformListForms).not.toHaveBeenCalled();
  });

  it('regression: skips the post-sync forms/unassigned refresh if the user flips to local-only while jotformSync is still awaiting', async () => {
    jotformSync.mockImplementation(async () => {
      useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');
      return report();
    });

    render(<JotformConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync submissions' }));

    await waitFor(() => {
      expect(jotformSync).toHaveBeenCalled();
    });
    expect(jotformListForms).not.toHaveBeenCalled();
    expect(jotformListUnassigned).not.toHaveBeenCalled();
  });

  it('regression: skips the post-sync unassigned refresh if the user flips to local-only while jotformListForms (the FIRST follow-up call) is still awaiting', async () => {
    // Distinct from the jotformSync-flip test above: this flips one step
    // later, during the first follow-up call, to prove the second follow-up
    // call (jotformListUnassigned) has its own independent re-check rather
    // than relying on the guard that already passed for jotformListForms.
    // Re-establish a clean jotformSync resolution — vi.clearAllMocks() in
    // beforeEach clears call history but not a prior test's
    // mockImplementation, and the previous test left one on jotformSync that
    // flips to local-only, which would mask what this test is checking.
    jotformSync.mockResolvedValue(report());
    jotformListForms.mockImplementation(async () => {
      useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');
      return [];
    });

    render(<JotformConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync submissions' }));

    await waitFor(() => {
      expect(jotformListForms).toHaveBeenCalled();
    });
    expect(jotformListUnassigned).not.toHaveBeenCalled();
  });
});

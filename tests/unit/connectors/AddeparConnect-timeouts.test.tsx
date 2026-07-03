/**
 * AddeparConnect — timeout / hang-recovery behavior.
 *
 * The underlying reqwest client used to have no per-request timeout, so a
 * stalled connection (or a non-responding Addepar host) could leave
 * "Connecting…"/"Syncing…" stuck forever, with no error and no way to
 * recover. The Rust client now caps each HTTP request (src-tauri client.rs),
 * and this component wraps the Tauri IPC calls in withTimeout() as an outer
 * safety net + clear inline error. These tests pin down the JS-side recovery
 * path: a call that never resolves still leaves the UI usable again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

const mockAddeparConnect = vi.fn();
const mockAddeparListEntities = vi.fn();
const mockAddeparSync = vi.fn();
const mockAddeparIsConnected = vi.fn().mockResolvedValue(false);
const mockAddeparCancel = vi.fn().mockResolvedValue(undefined);
const mockAddeparDisconnect = vi.fn().mockResolvedValue({ tokenDeleted: true, ragPurged: true, dataRemains: false, warnings: [] });

vi.mock('@/platform/utils/addepar-commands', () => ({
  ADDEPAR_SYNC_EVENT: 'addepar-sync-progress',
  addeparConnect: (...args: unknown[]) => mockAddeparConnect(...args),
  addeparListEntities: () => mockAddeparListEntities(),
  addeparSync: (...args: unknown[]) => mockAddeparSync(...args),
  addeparIsConnected: () => mockAddeparIsConnected(),
  addeparCancel: () => mockAddeparCancel(),
  addeparDisconnect: () => mockAddeparDisconnect(),
}));

vi.mock('@/platform/matter/matterStore', () => ({
  getMatters: vi.fn().mockReturnValue([]),
  useMatterStore: (selector: (s: { addAddeparKey: () => void }) => unknown) =>
    selector({ addAddeparKey: vi.fn() }),
}));

vi.mock('@/platform/privacy/localOnlyGuard', () => ({
  isLocalOnlyMode: vi.fn().mockReturnValue(false),
  isPersistedLocalOnly: vi.fn().mockReturnValue(false),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  buildAddeparMatterMap: vi.fn().mockReturnValue([]),
  normalizeClientName: (s: string) => s.trim().toLowerCase(),
}));

import { AddeparConnect } from '@/platform/connectors/addepar/AddeparConnect';

describe('AddeparConnect — connect() timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockAddeparIsConnected.mockResolvedValue(false);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recovers from a connect call that never resolves, with a clear error', async () => {
    mockAddeparConnect.mockImplementation(() => new Promise(() => {})); // never resolves

    render(<AddeparConnect />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'k' } });
    fireEvent.change(screen.getByLabelText('API secret'), { target: { value: 's' } });
    fireEvent.change(screen.getByLabelText('Firm subdomain'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText('Firm id'), { target: { value: '1' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Connect Addepar'));
      await Promise.resolve();
    });
    expect(screen.getByText('Connecting...')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });

    expect(screen.getByText('Connect Addepar')).toBeInTheDocument();
    expect(screen.getByText(/timed out/i)).toBeInTheDocument();
  });
});

describe('AddeparConnect — syncNow() timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockAddeparIsConnected.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recovers from listEntities never resolving, with a clear error and a usable Sync button', async () => {
    mockAddeparListEntities.mockImplementation(() => new Promise(() => {})); // never resolves

    render(<AddeparConnect />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      fireEvent.click(screen.getByText('Sync households'));
      await Promise.resolve();
    });
    expect(screen.getByText('Syncing...')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(screen.getByText('Sync households')).toBeInTheDocument();
    expect(screen.getByText(/timed out/i)).toBeInTheDocument();
  });

  it('cancels the backend sync when addeparSync itself never resolves', async () => {
    mockAddeparListEntities.mockResolvedValue([]);
    mockAddeparSync.mockImplementation(() => new Promise(() => {})); // never resolves

    render(<AddeparConnect />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      fireEvent.click(screen.getByText('Sync households'));
      await Promise.resolve();
    });
    expect(screen.getByText('Syncing...')).toBeInTheDocument();
    expect(mockAddeparCancel).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });

    expect(screen.getByText('Sync households')).toBeInTheDocument();
    expect(screen.getByText(/timed out/i)).toBeInTheDocument();
    // The Tauri addepar_sync command holds a single-sync guard for as long as
    // it runs — giving up on it in React alone doesn't stop it backend side,
    // so the next Sync click would fail with "a sync is already in progress"
    // unless the backend is actually told to cancel.
    expect(mockAddeparCancel).toHaveBeenCalled();
  });

  it('the button recovers even if addeparCancel() itself never resolves', async () => {
    mockAddeparListEntities.mockResolvedValue([]);
    mockAddeparSync.mockImplementation(() => new Promise(() => {})); // never resolves
    mockAddeparCancel.mockImplementation(() => new Promise(() => {})); // never resolves either

    render(<AddeparConnect />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      fireEvent.click(screen.getByText('Sync households'));
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });

    expect(screen.getByText('Sync households')).toBeInTheDocument();
    expect(screen.getByText(/timed out/i)).toBeInTheDocument();
    expect(mockAddeparCancel).toHaveBeenCalled();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendlyConnect } from '@/platform/connectors/calendly/CalendlyConnect';
import { AuditService } from '@/platform/audit/AuditService';
import type { CalendlySyncReport } from '@/platform/utils/calendly-commands';

const calendlyConnect = vi.fn();
const calendlyDisconnect = vi.fn();
const calendlyIsConnected = vi.fn();
const calendlySyncAll = vi.fn();
const calendlyCancelSync = vi.fn();

vi.mock('@/platform/utils/calendly-commands', () => ({
  calendlyConnect: (...args: unknown[]) => calendlyConnect(...args),
  calendlyDisconnect: (...args: unknown[]) => calendlyDisconnect(...args),
  calendlyIsConnected: (...args: unknown[]) => calendlyIsConnected(...args),
  calendlySyncAll: (...args: unknown[]) => calendlySyncAll(...args),
  calendlyCancelSync: (...args: unknown[]) => calendlyCancelSync(...args),
}));

vi.mock('@/platform/connectors/calendly/useCalendlySync', () => ({
  useCalendlySync: () => undefined,
}));

// Auto-confirm the "Import Calendly meetings" dialog so runSync proceeds.
vi.mock('@/platform/hooks/useConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: () => Promise.resolve(true),
    dialogProps: { open: false, onConfirm: () => {}, onCancel: () => {} },
  }),
}));

// Real Tauri isn't present under jsdom; force the connected panel to render.
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));

function report(overrides: Partial<CalendlySyncReport> = {}): CalendlySyncReport {
  return {
    eventsFetched: 0,
    eventsChanged: 0,
    inviteesFetched: 0,
    meetingsIndexed: 0,
    recordsIndexed: 0,
    cancelled: false,
    ...overrides,
  };
}

describe('CalendlyConnect honest sync feedback + durable audit', () => {
  let logDurable: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    calendlyIsConnected.mockResolvedValue(true);
    calendlyConnect.mockResolvedValue({ email: 'a@b.co' });
    calendlyDisconnect.mockResolvedValue({ tokenDeleted: true, ragPurged: true, calendlyDbPurged: true, warnings: [] });
    calendlyCancelSync.mockResolvedValue(undefined);
    logDurable = vi
      .spyOn(AuditService.prototype, 'logDurable')
      .mockResolvedValue({} as never);
  });

  it('shows the indexed counts and writes a success audit row with counts', async () => {
    calendlySyncAll.mockResolvedValue(report({ meetingsIndexed: 3, recordsIndexed: 7, eventsFetched: 4 }));

    render(<CalendlyConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync meetings' }));

    expect(await screen.findByText(/indexed 3 meetings into 7 search chunks/i)).toBeTruthy();
    await waitFor(() => {
      expect(logDurable).toHaveBeenCalledWith(
        'calendly.sync',
        expect.stringContaining('3 meeting'),
        expect.objectContaining({ outputs: expect.objectContaining({ meetingsIndexed: 3, recordsIndexed: 7 }) })
      );
    });
  });

  it('records a stopped sync honestly as cancelled, not a plain success', async () => {
    calendlySyncAll.mockResolvedValue(report({ meetingsIndexed: 2, recordsIndexed: 4, cancelled: true }));

    render(<CalendlyConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync meetings' }));

    await waitFor(() => {
      const call = logDurable.mock.calls.find((c) => c[0] === 'calendly.sync');
      expect(String(call?.[1])).toMatch(/stopped after indexing/i);
      expect((call?.[2] as { outputs: { cancelled: boolean } }).outputs.cancelled).toBe(true);
    });
  });

  it('surfaces an error and writes a failure audit row with a sanitized category', async () => {
    calendlySyncAll.mockRejectedValue(new Error('HTTP 401 unauthorized for token xyz'));

    render(<CalendlyConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync meetings' }));

    await waitFor(() => {
      expect(logDurable).toHaveBeenCalledWith(
        'calendly.sync',
        'Calendly sync failed.',
        // Category only — the raw "token xyz" text must never reach the audit row.
        { outputs: { error: 'auth_expired' } }
      );
    });
    const failureCall = logDurable.mock.calls.find((c) => c[1] === 'Calendly sync failed.');
    expect(JSON.stringify(failureCall)).not.toContain('xyz');
  });
});

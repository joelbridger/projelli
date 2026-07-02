import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { MailSyncProgress } from '@/platform/utils/mail-commands';
import { AuditService } from '@/platform/audit/AuditService';

// Capture the listener the hook registers so the test can drive terminal events.
let handler: ((event: { payload: MailSyncProgress }) => void) | null = null;
const unlisten = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (_name: string, cb: (event: { payload: MailSyncProgress }) => void) => {
    handler = cb;
    return Promise.resolve(unlisten);
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));

import { useMailSyncAudit } from '@/platform/connectors/email/useMailSyncAudit';

function Harness() {
  useMailSyncAudit();
  return null;
}

function fire(overrides: Partial<MailSyncProgress>): void {
  const payload: MailSyncProgress = {
    status: 'syncing',
    provider: 'm365',
    written: 0,
    removed: 0,
    ...overrides,
  };
  handler?.({ payload });
}

describe('useMailSyncAudit durable rows', () => {
  let logDurable: Mock<typeof AuditService.prototype.logDurable>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = null;
    logDurable = vi
      .spyOn(AuditService.prototype, 'logDurable')
      .mockResolvedValue({} as never);
    render(<Harness />);
  });

  it('ignores non-terminal syncing updates', async () => {
    await waitFor(() => expect(handler).toBeTruthy());
    fire({ status: 'syncing', written: 5 });
    expect(logDurable).not.toHaveBeenCalled();
  });

  it('writes a success row with real counts (and no backfill note when complete)', async () => {
    await waitFor(() => expect(handler).toBeTruthy());
    fire({ status: 'done', provider: 'm365', written: 42, removed: 3, backfillPending: false });
    await waitFor(() => {
      expect(logDurable).toHaveBeenCalledWith(
        'mail.sync',
        expect.stringContaining('imported 42 message'),
        expect.objectContaining({
          outputs: expect.objectContaining({ provider: 'm365', written: 42, removed: 3, backfillPending: false }),
        })
      );
    });
  });

  it('notes a pending backfill on a done row', async () => {
    await waitFor(() => expect(handler).toBeTruthy());
    fire({ status: 'done', provider: 'gmail', written: 10, backfillPending: true });
    await waitFor(() => {
      const call = logDurable.mock.calls.find((c) => c[0] === 'mail.sync');
      expect(String(call?.[1])).toMatch(/backfill pending/i);
      expect((call?.[2] as { outputs: { backfillPending: boolean } }).outputs.backfillPending).toBe(true);
    });
  });

  it('records a token-rotation warning on a done row', async () => {
    await waitFor(() => expect(handler).toBeTruthy());
    fire({ status: 'done', provider: 'm365', written: 8, tokenWarning: true });
    await waitFor(() => {
      const call = logDurable.mock.calls.find((c) => c[0] === 'mail.sync');
      expect(String(call?.[1])).toMatch(/reconnect may be needed/i);
      expect((call?.[2] as { outputs: { tokenWarning: boolean } }).outputs.tokenWarning).toBe(true);
    });
  });

  it('writes a failure row with a sanitized category and never the raw message', async () => {
    await waitFor(() => expect(handler).toBeTruthy());
    fire({ status: 'error', provider: 'imap', error: 'IMAP 401 unauthorized: user bob@firm.com token abc123' });
    await waitFor(() => {
      expect(logDurable).toHaveBeenCalledWith(
        'mail.sync',
        expect.stringContaining('failed'),
        { outputs: { provider: 'imap', error: 'auth_expired' } }
      );
    });
    const failureCall = logDurable.mock.calls.find((c) => String(c[1]).includes('failed'));
    const serialized = JSON.stringify(failureCall);
    expect(serialized).not.toContain('bob@firm.com');
    expect(serialized).not.toContain('abc123');
  });

  it('writes a cancelled row', async () => {
    await waitFor(() => expect(handler).toBeTruthy());
    fire({ status: 'cancelled', provider: 'm365' });
    await waitFor(() => {
      expect(logDurable).toHaveBeenCalledWith(
        'mail.sync',
        expect.stringContaining('cancelled'),
        { outputs: { provider: 'm365', cancelled: true } }
      );
    });
  });
});

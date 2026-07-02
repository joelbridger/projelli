// Single-mount listener that writes a durable, append-only audit row for every
// terminal mail-sync outcome — one row per provider section per sync — so a mail
// import that brought in zero messages, failed, or was cancelled always leaves a
// record. This mirrors the OneDrive/Wealthbox honesty guarantee, but mail's
// per-provider terminal outcomes arrive as backend events (`finish_section`),
// not as a single awaited report, so the audit write lives here instead of in
// each panel's runSync.
//
// MUST be mounted exactly once (App root), NOT per connector panel — otherwise
// each mounted panel would write a duplicate row for the same terminal event.

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { MAIL_SYNC_EVENT, type MailSyncProgress } from '@/platform/utils/mail-commands';
import { AuditService } from '@/platform/audit/AuditService';
import { sanitizeSyncError } from '@/platform/connectors/syncAuditError';

const mailAudit = new AuditService('connectors');

const PROVIDER_LABEL: Record<string, string> = {
  m365: 'Microsoft 365',
  gmail: 'Gmail',
  imap: 'IMAP',
};

function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}

export function useMailSyncAudit(): void {
  useEffect(() => {
    if (!isTauri()) return;
    const un = listen<MailSyncProgress>(MAIL_SYNC_EVENT, (event) => {
      const p = event.payload;
      const label = providerLabel(p.provider);
      if (p.status === 'done') {
        const pending = p.backfillPending === true;
        const tokenWarning = p.tokenWarning === true;
        void mailAudit
          .logDurable(
            'mail.sync',
            `${label} mail sync: imported ${String(p.written)} message(s)` +
              (p.removed ? `, removed ${String(p.removed)}` : '') +
              (pending
                ? '. Some messages are queued for search indexing (backfill pending).'
                : '.') +
              (tokenWarning ? ' Saving the refreshed sign-in failed; a reconnect may be needed later.' : ''),
            {
              outputs: {
                provider: p.provider,
                written: p.written,
                removed: p.removed,
                backfillPending: pending,
                tokenWarning,
              },
            }
          )
          .catch(() => {});
      } else if (p.status === 'error') {
        // Store only a sanitized category — never the raw provider message that
        // rides along in `p.error` for the owner's on-screen display.
        void mailAudit
          .logDurable('mail.sync', `${label} mail sync failed.`, {
            outputs: { provider: p.provider, error: sanitizeSyncError(p.error) },
          })
          .catch(() => {});
      } else if (p.status === 'cancelled') {
        void mailAudit
          .logDurable('mail.sync', `${label} mail sync cancelled.`, {
            outputs: { provider: p.provider, cancelled: true },
          })
          .catch(() => {});
      }
    });
    return () => {
      void un.then((f) => {
        f();
      });
    };
  }, []);
}

/* eslint-disable lantern-i18n/no-hardcoded-string */
/**
 * Calendar connector card (Account -> Connections). One screen, three paths:
 * Outlook sign-in, Google sign-in, or a pasted ICS address. Read-only.
 * Mirrors CalendlyConnect/OneDriveConnect conventions; matches the approved
 * p5-calendar-connection.html prototype (one card among peers, provider
 * choices inline, single unified "connected" view once any provider links).
 */

import { useState, useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { CheckCircle2, Lock, RefreshCw } from 'lucide-react';
import {
  calendarCancelSync,
  calendarConnectGoogle,
  calendarConnectIcs,
  calendarConnectOutlook,
  calendarConnectOutlookCancel,
  calendarDisconnect,
  calendarIsConnected,
  calendarSyncAll,
  type CalendarProviderId,
  type CalendarSyncReport,
} from '@/platform/utils/calendar-commands';
import { buildCalendarMatterMap } from '@/platform/rag/matterResolver';
import { beginOAuth, endOAuth } from '@/platform/connectors/oauthPending';
import { isLocalOnlyMode } from '@/platform/privacy/localOnlyGuard';
import { getMatters } from '@/platform/matter/matterStore';
import { AuditService } from '@/platform/audit/AuditService';
import { sanitizeSyncError } from '@/platform/connectors/syncAuditError';
import { Button } from '@/ui/kp';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/ui/ConfirmDialog';

// Durable, append-only audit trail for connector activity, so a calendar
// sync (including one that indexed zero meetings or failed) always leaves a
// record — the same honesty guarantee the Calendly/OneDrive paths give.
const calendarAudit = new AuditService('connectors');

const PROVIDER_LABEL: Record<CalendarProviderId, string> = {
  outlook: 'Outlook',
  google: 'Google',
  ics: 'Calendar (.ics)',
};

export function CalendarConnect() {
  const [connected, setConnected] = useState<
    Record<CalendarProviderId, boolean>
  >({
    outlook: false,
    google: false,
    ics: false,
  });
  const [busy, setBusy] = useState<CalendarProviderId | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [icsUrl, setIcsUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<CalendarSyncReport | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const { confirm, dialogProps } = useConfirmDialog();

  async function refreshConnected() {
    const next: Record<CalendarProviderId, boolean> = {
      outlook: false,
      google: false,
      ics: false,
    };
    for (const id of Object.keys(PROVIDER_LABEL) as CalendarProviderId[]) {
      next[id] = await calendarIsConnected(id).catch(() => false);
    }
    setConnected(next);
  }

  useEffect(() => {
    void refreshConnected();
  }, []);

  async function connectOAuth(provider: 'outlook' | 'google') {
    setBusy(provider);
    setError(null);
    beginOAuth();
    try {
      if (isLocalOnlyMode()) {
        throw new Error(
          'Local-only mode is on. Turn it off before connecting a calendar, because sign-in contacts the provider.'
        );
      }
      if (provider === 'outlook') await calendarConnectOutlook();
      else await calendarConnectGoogle();
      await refreshConnected();
      void runSync();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The user clicked Cancel — an intentional exit, not a failure.
      if (message !== 'cancelled') setError(message);
      if (provider === 'outlook') void calendarConnectOutlookCancel();
    } finally {
      setBusy(null);
      endOAuth();
    }
  }

  async function connectIcs() {
    const trimmed = icsUrl.trim();
    if (!trimmed) {
      setError('Paste the calendar’s ICS address first.');
      return;
    }
    // The backend fetches this URL immediately to validate it, so this is a
    // network call — the same local-only guard connectOAuth uses.
    if (isLocalOnlyMode()) {
      setError(
        'Local-only mode is on. Turn it off before connecting a calendar, because sign-in contacts the provider.'
      );
      return;
    }
    setBusy('ics');
    setError(null);
    try {
      await calendarConnectIcs(trimmed);
      setIcsUrl('');
      await refreshConnected();
      void runSync();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function runSync() {
    setError(null);
    if (isLocalOnlyMode()) {
      setError(
        'Local-only mode is on. Turn it off before syncing your calendar, because it contacts the provider.'
      );
      return;
    }
    setSyncing(true);
    try {
      const report = await calendarSyncAll(
        buildCalendarMatterMap(getMatters())
      );
      setLastReport(report);
      setLastSyncedAt(new Date());
      const verb = report.cancelled ? 'stopped after indexing' : 'indexed';
      void calendarAudit
        .logDurable(
          'calendar.sync',
          `Calendar sync: ${verb} ${String(report.eventsIndexed)} meeting(s) into ${String(report.recordsIndexed)} search chunk(s).`,
          {
            outputs: {
              eventsIndexed: report.eventsIndexed,
              recordsIndexed: report.recordsIndexed,
              eventsFetched: report.eventsFetched,
              eventsChanged: report.eventsChanged,
              cancelled: report.cancelled,
            },
          }
        )
        .catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Store only a sanitized category — never the raw provider message.
      void calendarAudit
        .logDurable('calendar.sync', 'Calendar sync failed.', {
          outputs: { error: sanitizeSyncError(err) },
        })
        .catch(() => {});
    } finally {
      setSyncing(false);
    }
  }

  async function disconnectAll() {
    setError(null);
    // Destructive: removes the saved credential(s), and once the last
    // provider disconnects the backend also purges the local encrypted
    // calendar store and its RAG rows — matches CalendlyConnect's
    // confirm-before-delete pattern for the same class of action.
    const confirmed = await confirm(
      'Disconnect your calendar? This removes the saved connection from this device and deletes imported calendar data from local storage.',
      {
        title: 'Disconnect and delete imported data',
        confirmLabel: 'Disconnect and delete',
        cancelLabel: 'Cancel',
        variant: 'destructive',
      }
    );
    if (!confirmed) return;
    try {
      const connectedIds = (
        Object.keys(PROVIDER_LABEL) as CalendarProviderId[]
      ).filter((id) => connected[id]);
      for (const id of connectedIds) {
        await calendarDisconnect(id);
      }
      setLastReport(null);
      setLastSyncedAt(null);
      await refreshConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!isTauri()) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Calendar</h3>
        <p className="mt-1 text-sm text-slate-600">
          Requires the Advisor Prep Hero desktop app.
        </p>
      </section>
    );
  }

  const connectedIds = (
    Object.keys(PROVIDER_LABEL) as CalendarProviderId[]
  ).filter((id) => connected[id]);
  const anyConnected = connectedIds.length > 0;
  const connectedLabel = connectedIds
    .map((id) => PROVIDER_LABEL[id])
    .join(' + ');

  return (
    <>
      <section
        className="rounded-lg border border-slate-200 bg-white p-4"
        data-testid="calendar-connect"
      >
        <h3 className="text-sm font-semibold text-slate-900">Calendar</h3>

        {!anyConnected && (
          <>
            <p className="mt-1 text-sm text-slate-600">
              Connect your calendar so Advisor Prep Hero can match today’s
              meetings to the right client and prep you before each one. It
              reads meetings only, never writes to your calendar.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                data-testid="calendar-connect-outlook"
                onClick={() => {
                  void connectOAuth('outlook');
                }}
                disabled={busy !== null}
              >
                {busy === 'outlook'
                  ? 'Waiting for sign-in…'
                  : 'Connect Microsoft'}
              </Button>
              <Button
                size="sm"
                data-testid="calendar-connect-google"
                onClick={() => {
                  void connectOAuth('google');
                }}
                disabled={busy !== null}
              >
                {busy === 'google' ? 'Waiting for sign-in…' : 'Connect Google'}
              </Button>
            </div>

            <div
              className="mt-3 flex flex-wrap items-center gap-2"
              data-testid="calendar-connect-ics"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                or
              </span>
              <input
                type="url"
                data-testid="calendar-ics-url-input"
                value={icsUrl}
                onChange={(e) => {
                  setIcsUrl(e.target.value);
                }}
                placeholder="Paste a calendar link (.ics)"
                className="block max-w-xs flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void connectIcs();
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                data-testid="calendar-ics-connect-button"
                onClick={() => {
                  void connectIcs();
                }}
                disabled={busy !== null}
              >
                {busy === 'ics' ? 'Adding…' : 'Add'}
              </Button>
            </div>

            <p className="mt-3 text-xs text-slate-500">
              Read-only. Advisor Prep Hero only reads your calendar to match
              meetings to clients. It never creates, edits, moves, or deletes
              events.
            </p>
          </>
        )}

        {anyConnected && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                <b>{connectedLabel}</b> calendar connected
              </span>
            </div>
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Read-only · past 7 days + next 14
            </p>
            {lastSyncedAt && (
              <p className="flex items-center gap-2 text-xs text-slate-500">
                <RefreshCw
                  className="h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
                Last synced{' '}
                {lastSyncedAt.toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="secondary"
                data-testid="calendar-sync-button"
                onClick={() => {
                  void runSync();
                }}
                disabled={syncing}
              >
                {syncing ? 'Syncing…' : 'Sync now'}
              </Button>
              {syncing && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void calendarCancelSync();
                  }}
                >
                  Stop
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void disconnectAll();
                }}
              >
                Disconnect
              </Button>
            </div>

            {lastReport && (
              <p
                className="text-xs text-slate-500"
                data-testid="calendar-sync-report"
              >
                {lastReport.eventsIndexed > 0
                  ? `Synced ${String(lastReport.eventsIndexed)} meeting${lastReport.eventsIndexed === 1 ? '' : 's'}.`
                  : 'No new meetings came in.'}
              </p>
            )}
          </div>
        )}

        {error && (
          <p
            className="mt-3 text-xs text-red-600"
            data-testid="calendar-connect-error"
          >
            {error}
          </p>
        )}
      </section>
      <ConfirmDialog {...dialogProps} />
    </>
  );
}

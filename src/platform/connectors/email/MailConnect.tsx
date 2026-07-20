import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InfoHelp } from '@/ui/InfoHelp';
import { outlookConnect, outlookConnectCancel, mailIsConnected, mailDisconnect, mailSyncAll, mailCancelSync, mailFdeStatus } from '@/platform/utils/mail-commands';
import { useMailSync } from '@/platform/connectors/email/useMailSync';
import { useMailStore } from '@/platform/connectors/email/mailStore';
import { getMatters } from '@/platform/matter/matterStore';
import { buildMailMatterMap } from '@/platform/rag/matterResolver';
import { beginOAuth, endOAuth } from '@/platform/connectors/oauthPending';
import {
  isMicrosoftSignInExpiredError,
  MICROSOFT_SIGNIN_EXPIRED_MESSAGE,
} from '@/platform/connectors/microsoft/microsoftAuthError';
import { brandText } from '@/config/brandText';
import { IntegrationHonestyCard } from '@/platform/connectors/IntegrationHonestyCard';
import { BRAND } from '@/config/brand';

export function MailConnect() {
  const { t } = useTranslation();
  useMailSync();
  // Read ONLY this provider's progress so a Gmail sync never shows its count or
  // error on the Microsoft 365 panel (they render together).
  const progress = useMailStore((s) => s.progressByProvider['m365']);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [fdeStatus, setFdeStatus] = useState<'on' | 'off' | 'unknown'>('unknown');
  const [syncStalled, setSyncStalled] = useState(false);

  useEffect(() => { mailIsConnected().then(setConnected).catch(() => {}); }, []);

  // G6: check OS full-disk encryption status on mount. Best-effort; never blocks.
  useEffect(() => {
    mailFdeStatus().then((s) => { setFdeStatus(s.status); }).catch(() => {});
  }, []);

  // Sync-stall watchdog: if progress is 'syncing' and written count hasn't changed
  // for 90 seconds, show an amber warning prompting the user to Reconnect.
  useEffect(() => {
    if (progress?.status !== 'syncing') {
      setSyncStalled(false);
      return;
    }
    // Clear any prior stall warning on each progress event, so a sync that
    // resumes drops the "may have expired" message instead of leaving it stuck.
    setSyncStalled(false);
    const timer = setTimeout(() => { setSyncStalled(true); }, 90_000);
    return () => { clearTimeout(timer); };
  }, [progress?.status, progress?.written]);

  // Reconnect: a stale/hung sync holds the backend single-sync guard, so cancel
  // any in-flight sync before re-authenticating — otherwise the post-reconnect
  // re-sync is rejected with "a sync is already in progress".
  async function reconnect() {
    try { await mailCancelSync(); } catch { /* best-effort; reconnect anyway */ }
    await connect();
  }

  async function connect() {
    setConnecting(true);
    setConnectError(null);
    // Mark an interactive OAuth sign-in pending so onboarding disables Continue
    // until this multi-minute browser flow settles.
    beginOAuth();
    try {
      await outlookConnect();
      setConnected(true);
      // Kick off the import; surface failures instead of leaving a spinner.
      // Pass the current mail->matter mapping so synced mail is scoped at
      // index time (unmapped folders fall back to "unassigned"). Scope the sync
      // to "m365" so connecting Microsoft never runs (or fails on) a Gmail token.
      mailSyncAll(buildMailMatterMap(getMatters()), 'm365').catch((err: unknown) => {
        setConnectError(typeof err === 'string' ? err : err instanceof Error ? err.message : 'Mail sync could not start. Please try again.');
      });
    } catch (err) {
      const message = typeof err === 'string' ? err : err instanceof Error ? err.message : 'Could not connect. Please try again.';
      // The user clicked Cancel — this is an intentional exit, not a failure,
      // so don't show a red error for it (and any prior working connection
      // was never touched).
      if (message !== 'cancelled') setConnectError(message);
    } finally {
      setConnecting(false);
      endOAuth();
    }
  }

  // Abort a pending sign-in immediately instead of leaving the user stuck on
  // the "Reconnecting…" spinner for the full 5-minute server-side OAuth
  // timeout with no way out. The prior connection (if any) is left untouched.
  function cancelConnect() {
    outlookConnectCancel().catch(() => {});
  }

  // Disconnect: cancel any in-flight sync, drop the Microsoft 365 refresh token
  // from the keychain, and return to the disconnected state. The BUG-008
  // follow-up — gives a stale account a way out (remove + reconnect), matching
  // the Gmail panel. Imported mail stays in the local DB.
  async function disconnect() {
    try { await mailCancelSync(); } catch { /* best-effort */ }
    setConnectError(null);
    try {
      await mailDisconnect();
      setConnected(false);
      setSyncStalled(false);
    } catch (err) {
      // Don't lie: if removing the saved sign-in failed (e.g. the keychain
      // refused), surface it and re-check the real state rather than showing a
      // disconnected screen while the token may still be there.
      setConnectError(
        typeof err === 'string' ? err : err instanceof Error ? err.message : 'Could not disconnect. Please try again.',
      );
      mailIsConnected().then(setConnected).catch(() => {});
    }
  }

  function stopSync() {
    mailCancelSync().catch(() => {});
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
        Microsoft 365 email
        <InfoHelp content={brandText(`Bring your Outlook mail into ${BRAND.name} so you can actually find it. Your mail is encrypted and stays on this machine. Requires the ${BRAND.name} desktop app.`)} />
      </h3>
      <IntegrationHonestyCard connectorId="email" />
      {fdeStatus === 'off' && (
        <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
          {t('mail.connect.fde-warning')}
        </p>
      )}

      {!connected && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-500">
            {brandText(`A browser window will open to sign in to Microsoft. Complete sign-in there and ${BRAND.name} will connect automatically.`)}
          </p>

          {connectError && (
            <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-800">
              <p className="text-red-700 font-medium">{t('mail.connect.error-prefix')} {connectError}</p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="connect-m365-button"
              disabled={connecting}
              onClick={() => void connect()}
              className="rounded-md bg-[var(--kp-navy)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {connecting ? 'Waiting for sign-in in your browser…' : 'Connect Microsoft 365'}
            </button>
            {connecting && (
              <button
                type="button"
                data-testid="mail-m365-cancel-connect"
                onClick={cancelConnect}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {connected && (
        <div className="mt-3 text-sm text-slate-700">
          <p className="font-medium text-green-700">Connected.</p>
          {progress && progress.status === 'syncing' && (
            <div className="mt-1 flex items-center gap-3">
              <p>Importing… {progress.written.toLocaleString()} messages so far.</p>
              <button onClick={stopSync}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                Stop
              </button>
            </div>
          )}
          {syncStalled && (
            <p data-testid="mail-m365-stalled" className="mt-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
              This is taking longer than expected. Your Microsoft 365 sign-in may have expired. Try Reconnect.
            </p>
          )}
          {progress && progress.status === 'done' && (
            <>
              <p className="mt-1">
                {progress.backfillPending
                  ? 'Mail imported. Some messages are still being made searchable in the background — that finishes on its own.'
                  : 'All mail imported and searchable.'}
              </p>
              {progress.tokenWarning && (
                // eslint-disable-next-line lantern-i18n/no-hardcoded-string
                <p className="mt-1 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                  Heads up: saving your refreshed Microsoft sign-in didn't work, so you may need to reconnect later.
                </p>
              )}
            </>
          )}
          {progress && progress.status === 'error' && (
            <p className="mt-1 text-red-700">
              {progress.error
                ? isMicrosoftSignInExpiredError(progress.error)
                  ? MICROSOFT_SIGNIN_EXPIRED_MESSAGE
                  : `Mail sync ran into a problem: ${progress.error}`
                : 'Mail sync ran into a problem. Open this panel again to retry.'}
            </p>
          )}
          {progress && progress.status === 'cancelled' && <p className="mt-1 text-slate-500">Import stopped.</p>}
          {connectError && <p className="mt-1 text-red-700">{t('mail.connect.error-prefix')} {connectError}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              data-testid="mail-m365-reconnect"
              disabled={connecting}
              onClick={() => void reconnect()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {connecting ? 'Reconnecting…' : 'Reconnect'}
            </button>
            {connecting && (
              <button
                type="button"
                data-testid="mail-m365-cancel-connect"
                onClick={cancelConnect}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              data-testid="mail-m365-disconnect"
              disabled={connecting}
              onClick={() => void disconnect()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

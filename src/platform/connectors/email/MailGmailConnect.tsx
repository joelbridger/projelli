import { useEffect, useState } from 'react';
import { InfoHelp } from '@/ui/InfoHelp';
import { gmailConnect, gmailConnectCancel, gmailOauthConfigured, gmailIsConnected, gmailDisconnect, mailSyncAll, mailCancelSync, isDesktopOnlyMailError } from '@/platform/utils/mail-commands';
import { useMailSync } from '@/platform/connectors/email/useMailSync';
import { useMailStore } from '@/platform/connectors/email/mailStore';
import { getMatters } from '@/platform/matter/matterStore';
import { buildMailMatterMap } from '@/platform/rag/matterResolver';
import { beginOAuth, endOAuth } from '@/platform/connectors/oauthPending';
import { brandText } from '@/config/brandText';
import { IntegrationHonestyCard } from '@/platform/connectors/IntegrationHonestyCard';
import { BRAND } from '@/config/brand';

export function MailGmailConnect() {
  useMailSync();
  // Read ONLY this provider's progress so a Microsoft 365 sync never shows its
  // count or error on the Gmail panel (they render together).
  const progress = useMailStore((s) => s.progressByProvider['gmail']);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [syncStalled, setSyncStalled] = useState(false);
  // Defaults to true (assume configured) until the build-config check
  // resolves, so the button never flashes disabled on a normal build.
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    gmailIsConnected().then(setConnected).catch(() => {});
  }, []);

  // A build with no Google OAuth client credentials baked in
  // (LANTERN_GMAIL_CLIENT_ID/_SECRET missing at compile time) can never
  // complete a Gmail sign-in — check up front so the panel shows an honest
  // "not set up" note instead of letting the user hit Google's raw
  // "Error 400: invalid_request" after a real browser window already opened.
  useEffect(() => {
    gmailOauthConfigured().then(setConfigured).catch(() => {});
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
      await gmailConnect();
      setConnected(true);
      // Now that we're connected, import the mail so it's searchable. Pass the
      // current mail->matter mapping so synced mail is scoped at index time.
      // Scope the sync to "gmail" so connecting Gmail never runs (or fails on) a
      // Microsoft token. Surface failures instead of leaving an empty inbox.
      mailSyncAll(buildMailMatterMap(getMatters()), 'gmail').catch((err: unknown) => {
        setConnectError(err instanceof Error ? err.message : typeof err === 'string' ? err : 'Mail sync could not start. Please try again.');
      });
    } catch (err) {
      const message = typeof err === 'string' ? err : err instanceof Error ? err.message : 'Could not connect. Please try again.';
      // The user clicked Cancel — this is an intentional exit, not a failure,
      // so don't show a red error for it (and any prior working connection
      // was never touched).
      if (message === 'cancelled') {
        // no-op
      } else if (message === 'not_configured') {
        // Defense in depth: the upfront gmailOauthConfigured() check should
        // already have hidden the Connect button, but if the config check
        // itself failed to resolve, don't let the user hit a raw Google error.
        setConfigured(false);
      } else {
        setConnectError(message);
      }
    } finally {
      setConnecting(false);
      endOAuth();
    }
  }

  // Abort a pending sign-in immediately instead of leaving the user stuck on
  // the "Waiting for Google sign-in…" spinner for the full 5-minute
  // server-side OAuth timeout with no way out. The prior connection (if any)
  // is left untouched.
  function cancelConnect() {
    gmailConnectCancel().catch(() => {});
  }

  async function disconnect() {
    try {
      await gmailDisconnect();
    } catch {
      // Best-effort disconnect; clear local state regardless.
    }
    setConnected(false);
  }

  function stopSync() {
    mailCancelSync().catch(() => {});
  }

  return (
    <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
        Gmail
        <InfoHelp content={brandText(`Signs in with your Google account directly. Your email stays on this device and never leaves your machine. Requires the ${BRAND.name} desktop app.`)} />
      </h3>
      <IntegrationHonestyCard connectorId="email" />

      {!connected && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-500">
            {brandText(`A browser window will open to sign in to Google. Google will ask you to confirm access to ${BRAND.name}. This is normal. Choose Continue.`)}
          </p>

          {!configured && (
            /* This build has no Google OAuth client credentials baked in
               (LANTERN_GMAIL_CLIENT_ID/_SECRET missing at compile time) — a
               calm info note, not a red alarm, since this is a build/setup
               gap rather than something the user did wrong (UX-22). */
            <div data-testid="mail-gmail-not-configured" className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {/* eslint-disable-next-line lantern-i18n/no-hardcoded-string */}
              <p>Gmail sign-in isn&apos;t set up on this build yet.</p>
            </div>
          )}

          {connectError &&
            (isDesktopOnlyMailError(connectError) ? (
              /* Expected limitation in the web preview — a calm info note, not a
                 red alarm (UX-22). */
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p>{brandText(`Email connects in the ${BRAND.name} desktop app.`)}</p>
              </div>
            ) : (
              <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-800">
                <p className="text-red-700 font-medium">Something went wrong: {connectError}</p>
              </div>
            ))}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={connecting || !configured}
              onClick={() => void connect()}
              className="rounded-md bg-[var(--kp-navy)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {connecting ? 'Waiting for Google sign-in in your browser…' : 'Connect Gmail'}
            </button>
            {connecting && (
              <button
                type="button"
                data-testid="mail-gmail-cancel-connect"
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
            <p data-testid="mail-gmail-stalled" className="mt-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
              This is taking longer than expected. Your Google sign-in may have expired. Try Reconnect.
            </p>
          )}
          {progress && progress.status === 'done' && (
            <p className="mt-1">
              {progress.backfillPending
                ? 'Mail imported. Some messages are still being made searchable in the background — that finishes on its own.'
                : 'All mail imported and searchable.'}
            </p>
          )}
          {progress && progress.status === 'error' && (
            <p className="mt-1 text-red-700">
              {progress.error
                ? `Mail sync ran into a problem: ${progress.error}`
                : 'Mail sync ran into a problem. Open this panel again to retry.'}
            </p>
          )}
          {connectError && <p className="mt-1 text-red-700">Something went wrong: {connectError}</p>}
          {!configured && (
            /* A saved token from an earlier (properly configured) build can
               leave this panel showing "Connected" even though THIS build has
               no Google OAuth client credentials — Reconnect would otherwise
               fail with zero visible feedback (Codex review finding). Same
               calm tone as the disconnected-state note (UX-22). */
            <div data-testid="mail-gmail-not-configured" className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {/* eslint-disable-next-line lantern-i18n/no-hardcoded-string */}
              <p>Gmail sign-in isn&apos;t set up on this build yet — Reconnect won&apos;t work until that&apos;s fixed.</p>
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              data-testid="mail-gmail-reconnect"
              disabled={connecting || !configured}
              onClick={() => void reconnect()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {connecting ? 'Reconnecting…' : 'Reconnect'}
            </button>
            {connecting && (
              <button
                type="button"
                data-testid="mail-gmail-cancel-connect"
                onClick={cancelConnect}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() => void disconnect()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { gmailConnect, gmailIsConnected, gmailDisconnect, mailSyncAll, mailCancelSync } from '@/platform/utils/mail-commands';
import { useMailSync } from '@/features/email/useMailSync';
import { useMailStore } from '@/features/email/mailStore';
import { getMatters } from '@/platform/matter/matterStore';
import { buildMailMatterMap } from '@/platform/rag/matterResolver';

export function MailGmailConnect() {
  useMailSync();
  // Read ONLY this provider's progress so a Microsoft 365 sync never shows its
  // count or error on the Gmail panel (they render together).
  const progress = useMailStore((s) => s.progressByProvider['gmail']);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [syncStalled, setSyncStalled] = useState(false);

  useEffect(() => {
    gmailIsConnected().then(setConnected).catch(() => {});
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
    const timer = setTimeout(() => setSyncStalled(true), 90_000);
    return () => clearTimeout(timer);
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
    try {
      await gmailConnect();
      setConnected(true);
      // Now that we're connected, import the mail so it's searchable. Pass the
      // current mail->matter mapping so synced mail is scoped at index time.
      // Scope the sync to "gmail" so connecting Gmail never runs (or fails on) a
      // Microsoft token. Surface failures instead of leaving an empty inbox.
      mailSyncAll(buildMailMatterMap(getMatters()), 'gmail').catch((err) => {
        setConnectError(err instanceof Error ? err.message : typeof err === 'string' ? err : 'Mail sync could not start. Please try again.');
      });
    } catch (err) {
      setConnectError(typeof err === 'string' ? err : err instanceof Error ? err.message : 'Could not connect. Please try again.');
    } finally {
      setConnecting(false);
    }
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
      <h3 className="text-sm font-semibold text-slate-900">Gmail</h3>
      <p className="mt-1 text-sm text-slate-600">
        Signs in with your Google account directly. Your email stays on this device and never
        leaves your machine. Requires the Keepance desktop app.
      </p>

      {!connected && (
        <div className="mt-3 space-y-3">
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
          <p className="text-xs text-slate-500">
            A browser window will open to sign in to Google. Google will ask you to confirm
            access to Keepance. This is normal. Choose Continue.
          </p>
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}

          {connectError && (
            <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-800">
              <p className="text-red-700 font-medium">Something went wrong: {connectError}</p>
            </div>
          )}

          <button
            type="button"
            disabled={connecting}
            onClick={() => void connect()}
            className="rounded-md bg-[#0A2540] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {connecting ? 'Waiting for Google sign-in in your browser…' : 'Connect Gmail'}
          </button>
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
          {progress && progress.status === 'done' && <p className="mt-1">All mail imported and searchable.</p>}
          {progress && progress.status === 'error' && (
            <p className="mt-1 text-red-700">Mail sync ran into a problem. Open this panel again to retry.</p>
          )}
          {connectError && <p className="mt-1 text-red-700">Something went wrong: {connectError}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              data-testid="mail-gmail-reconnect"
              disabled={connecting}
              onClick={() => void reconnect()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {connecting ? 'Reconnecting…' : 'Reconnect'}
            </button>
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

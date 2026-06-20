import { useEffect, useState } from 'react';
import { outlookConnect, mailIsConnected, mailSyncAll, mailCancelSync, mailFdeStatus } from '@/platform/utils/mail-commands';
import { useMailSync } from '@/features/email/useMailSync';
import { useMailStore } from '@/features/email/mailStore';
import { getMatters } from '@/platform/matter/matterStore';
import { buildMailMatterMap } from '@/platform/rag/matterResolver';

export function MailConnect() {
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
    mailFdeStatus().then((s) => setFdeStatus(s.status)).catch(() => {});
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
      await outlookConnect();
      setConnected(true);
      // Kick off the import; surface failures instead of leaving a spinner.
      // Pass the current mail->matter mapping so synced mail is scoped at
      // index time (unmapped folders fall back to "unassigned"). Scope the sync
      // to "m365" so connecting Microsoft never runs (or fails on) a Gmail token.
      mailSyncAll(buildMailMatterMap(getMatters()), 'm365').catch((err) => {
        setConnectError(typeof err === 'string' ? err : err instanceof Error ? err.message : 'Mail sync could not start. Please try again.');
      });
    } catch (err) {
      setConnectError(typeof err === 'string' ? err : err instanceof Error ? err.message : 'Could not connect. Please try again.');
    } finally {
      setConnecting(false);
    }
  }

  function stopSync() {
    mailCancelSync().catch(() => {});
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Microsoft 365 email</h3>
      <p className="mt-1 text-sm text-slate-600">
        Bring your Outlook mail into Keepance so you can actually find it. Your mail is encrypted and stays on this machine. Requires the Keepance desktop app.
      </p>
      {fdeStatus === 'off' && (
        <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
          Full-disk encryption is off on this machine. Keepance encrypts your mail, but enabling
          FileVault (macOS) or BitLocker (Windows) adds a second layer of protection if your device is stolen.
        </p>
      )}

      {!connected && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-500">
            A browser window will open to sign in to Microsoft. Complete sign-in there and Keepance will connect automatically.
          </p>

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
            {connecting ? 'Waiting for sign-in in your browser…' : 'Connect Microsoft 365'}
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
            <p data-testid="mail-m365-stalled" className="mt-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
              This is taking longer than expected — your Microsoft 365 sign-in may have expired. Try Reconnect.
            </p>
          )}
          {progress && progress.status === 'done' && <p className="mt-1">All mail imported and searchable.</p>}
          {progress && progress.status === 'error' && (
            <p className="mt-1 text-red-700">Mail sync ran into a problem. Open this panel again to retry.</p>
          )}
          {progress && progress.status === 'cancelled' && <p className="mt-1 text-slate-500">Import stopped.</p>}
          <button
            type="button"
            data-testid="mail-m365-reconnect"
            disabled={connecting}
            onClick={() => void reconnect()}
            className="mt-2 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {connecting ? 'Reconnecting…' : 'Reconnect'}
          </button>
        </div>
      )}
    </section>
  );
}

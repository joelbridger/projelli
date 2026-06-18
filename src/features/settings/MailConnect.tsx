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

  useEffect(() => { mailIsConnected().then(setConnected).catch(() => {}); }, []);

  // G6: check OS full-disk encryption status on mount. Best-effort; never blocks.
  useEffect(() => {
    mailFdeStatus().then((s) => setFdeStatus(s.status)).catch(() => {});
  }, []);

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
          {progress && progress.status === 'done' && <p className="mt-1">All mail imported and searchable.</p>}
          {progress && progress.status === 'error' && (
            <p className="mt-1 text-red-700">Mail sync ran into a problem. Open this panel again to retry.</p>
          )}
          {progress && progress.status === 'cancelled' && <p className="mt-1 text-slate-500">Import stopped.</p>}
        </div>
      )}
    </section>
  );
}

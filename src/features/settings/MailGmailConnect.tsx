import { useEffect, useState } from 'react';
import { gmailConnect, gmailIsConnected, gmailDisconnect, mailSyncAll, mailCancelSync } from '@/platform/utils/mail-commands';
import { useMailSync } from '@/features/email/useMailSync';
import { useMailStore } from '@/features/email/mailStore';
import { getMatters } from '@/platform/matter/matterStore';
import { buildMailMatterMap } from '@/platform/rag/matterResolver';

export function MailGmailConnect() {
  useMailSync();
  const progress = useMailStore((s) => s.progress);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    gmailIsConnected().then(setConnected).catch(() => {});
  }, []);

  async function connect() {
    setConnecting(true);
    setConnectError(null);
    try {
      await gmailConnect();
      setConnected(true);
      // Now that we're connected, import the mail so it's searchable. Pass the
      // current mail->matter mapping so synced mail is scoped at index time.
      // Surface failures instead of leaving the user with an empty inbox.
      mailSyncAll(buildMailMatterMap(getMatters())).catch((err) => {
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
      <h3 className="text-sm font-semibold text-slate-900">Gmail (native)</h3>
      <p className="mt-1 text-sm text-slate-600">
        Signs in with your Google account directly. Your email stays on this device and never
        leaves your machine. Requires the Keepance desktop app.
      </p>

      {!connected && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-500">
            A browser window will open to sign in to Google. You may see an "unverified app"
            notice (this is expected while in testing) — choose Continue.
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
          {progress && progress.status === 'done' && <p className="mt-1">All mail imported and searchable.</p>}
          {progress && progress.status === 'error' && (
            <p className="mt-1 text-red-700">Mail sync ran into a problem. Open this panel again to retry.</p>
          )}
          {connectError && <p className="mt-1 text-red-700">Something went wrong: {connectError}</p>}
          <button
            type="button"
            onClick={() => void disconnect()}
            className="mt-2 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Disconnect
          </button>
        </div>
      )}
    </section>
  );
}

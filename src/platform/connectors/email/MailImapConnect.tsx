import { useEffect, useState } from 'react';
import { mailImapConnect, mailImapIsConnected, mailImapDisconnect, mailSyncAll, mailCancelSync } from '@/platform/utils/mail-commands';
import { useMailSync } from '@/platform/connectors/email/useMailSync';
import { useMailStore } from '@/platform/connectors/email/mailStore';
import { getMatters } from '@/platform/matter/matterStore';
import { buildMailMatterMap } from '@/platform/rag/matterResolver';
import { brandText } from '@/config/brandText';
import { IntegrationHonestyCard } from '@/platform/connectors/IntegrationHonestyCard';
import { BRAND } from '@/config/brand';

export function MailImapConnect() {
  useMailSync();
  // Read ONLY the IMAP provider's progress so a Microsoft/Gmail sync never shows
  // its count or error on this panel.
  const progress = useMailStore((s) => s.progressByProvider['imap']);
  const [connected, setConnected] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(993);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    mailImapIsConnected().then(setConnected).catch(() => {});
  }, []);

  async function connect() {
    setConnecting(true);
    setConnectError(null);
    try {
      await mailImapConnect({ host, port, username, password });
      setConnected(true);
      // Connect = IMPORT: start the mail sync immediately (scoped to "imap" so it
      // never touches a Microsoft/Gmail token), the same way Gmail/Microsoft do.
      // Without this, "Connect" only stored the credentials and never imported.
      mailSyncAll(buildMailMatterMap(getMatters()), 'imap').catch((err: unknown) => {
        setConnectError(err instanceof Error ? err.message : typeof err === 'string' ? err : 'Mail sync could not start. Please try again.');
      });
    } catch (err) {
      setConnectError(typeof err === 'string' ? err : err instanceof Error ? err.message : 'Could not connect. Check your settings and try again.');
    } finally {
      setConnecting(false);
    }
  }

  function stopSync() {
    mailCancelSync().catch(() => {});
  }

  async function disconnect() {
    try {
      await mailImapDisconnect();
    } catch {
      // Best-effort disconnect; clear local state regardless.
    }
    setConnected(false);
  }

  return (
    <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Other email (IMAP)</h3>
      <IntegrationHonestyCard connectorId="email" />
      <p className="mt-1 text-sm text-slate-600">
        Works with Gmail (via a{' '}
        <a
          href="https://myaccount.google.com/apppasswords"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Google app password
        </a>
        ), Outlook or Microsoft 365 (via an{' '}
        <a
          href="https://account.live.com/proofs/AppPassword"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Outlook app password
        </a>
        ), Fastmail, or any standard IMAP host. Your password is stored only in
        {brandText(`this device's keychain and never leaves your machine. Requires the ${BRAND.name} desktop app.`)}
      </p>

      {!connected && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="imap-host" className="text-xs font-medium text-slate-700">
                Host
              </label>
              <input
                id="imap-host"
                type="text"
                placeholder="imap.gmail.com"
                value={host}
                onChange={(e) => { setHost(e.target.value); }}
                required
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="imap-port" className="text-xs font-medium text-slate-700">
                Port
              </label>
              <input
                id="imap-port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => { setPort(Number(e.target.value)); }}
                required
                className="w-20 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="imap-username" className="text-xs font-medium text-slate-700">
              Email / username
            </label>
            <input
              id="imap-username"
              type="text"
              placeholder="you@example.com"
              value={username}
              onChange={(e) => { setUsername(e.target.value); }}
              required
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="imap-password" className="text-xs font-medium text-slate-700">
              App password
            </label>
            <input
              id="imap-password"
              type="password"
              placeholder="App password (Gmail and Outlook require one)"
              value={password}
              onChange={(e) => { setPassword(e.target.value); }}
              required
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>

          {connectError && (
            <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-800">
              <p className="text-red-700 font-medium">Something went wrong: {connectError}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={connecting}
            className="rounded-md bg-[var(--kp-navy)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      )}

      {connected && (
        <div className="mt-3 text-sm text-slate-700">
          <p className="font-medium text-green-700">Connected.</p>
          {progress && progress.status === 'syncing' && (
            <div className="mt-1 flex items-center gap-3">
              {/* eslint-disable-next-line lantern-i18n/no-hardcoded-string */}
              <p>Importing… {progress.written.toLocaleString()} messages so far.</p>
              <button onClick={stopSync}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                Stop
              </button>
            </div>
          )}
          {/* eslint-disable lantern-i18n/no-hardcoded-string */}
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
          {/* eslint-enable lantern-i18n/no-hardcoded-string */}
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

import { useEffect, useState } from 'react';
import { mailIsConnected, mailBeginLogin, mailPollLogin, mailSyncAll, mailFdeStatus, type DeviceCodePrompt } from '@/utils/mail-commands';
import { useMailSync } from '@/hooks/useMailSync';
import { useMailStore } from '@/stores/mailStore';

export function MailConnect() {
  useMailSync();
  const progress = useMailStore((s) => s.progress);
  const [connected, setConnected] = useState(false);
  const [prompt, setPrompt] = useState<DeviceCodePrompt | null>(null);
  const [expired, setExpired] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [fdeStatus, setFdeStatus] = useState<'on' | 'off' | 'unknown'>('unknown');

  useEffect(() => { mailIsConnected().then(setConnected); }, []);

  // G6: check OS full-disk encryption status on mount. Best-effort; never blocks.
  useEffect(() => {
    mailFdeStatus().then((s) => setFdeStatus(s.status)).catch(() => {});
  }, []);

  // FIX 1: interval owned by useEffect keyed on prompt — cleared on unmount or prompt change.
  // FIX 9: poll errors caught and surfaced; loop stops on error.
  useEffect(() => {
    if (!prompt) return;

    const intervalMs = Math.max(1, prompt.intervalSecs) * 1000;
    const expiresAt = Date.now() + prompt.expiresInSecs * 1000;

    const timer = setInterval(async () => {
      // Stop if the code has expired.
      if (Date.now() >= expiresAt) {
        clearInterval(timer);
        setExpired(true);
        setPrompt(null);
        return;
      }

      // FIX 9: catch errors from the poll call.
      try {
        const ok = await mailPollLogin(prompt.deviceCode);
        if (ok) {
          clearInterval(timer);
          setConnected(true);
          setPrompt(null);
          mailSyncAll();
        }
      } catch (err) {
        clearInterval(timer);
        setPrompt(null);
        setPollError(err instanceof Error ? err.message : 'An error occurred while signing in. Please try again.');
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [prompt]);

  async function connect() {
    setExpired(false);
    setPollError(null);
    const p = await mailBeginLogin();
    setPrompt(p);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Microsoft 365 email</h3>
      <p className="mt-1 text-sm text-slate-600">
        Bring your Outlook mail into Keepance so you can actually find it. Your mail stays on this machine.
      </p>
      {fdeStatus === 'off' && (
        <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
          Full-disk encryption is off on this machine. Keepance encrypts your mail, but enabling
          FileVault (macOS) or BitLocker (Windows) adds a second layer of protection if your device is stolen.
        </p>
      )}
      {!connected && !prompt && !expired && !pollError && (
        <button onClick={connect}
          className="mt-3 rounded-md bg-[#0A2540] px-3 py-2 text-sm font-medium text-white hover:opacity-90">
          Connect Microsoft 365
        </button>
      )}
      {prompt && (
        <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-800">
          <p>Open <a className="font-medium underline" href={prompt.verificationUri} target="_blank" rel="noreferrer">{prompt.verificationUri}</a> and enter this code:</p>
          <p className="mt-2 text-lg font-mono font-bold tracking-widest">{prompt.userCode}</p>
          <p className="mt-1 text-slate-500">Waiting for you to finish signing in…</p>
        </div>
      )}
      {expired && (
        <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-800">
          <p className="text-amber-700 font-medium">The sign-in code expired. Please try again.</p>
          <button onClick={connect}
            className="mt-2 rounded-md bg-[#0A2540] px-3 py-2 text-sm font-medium text-white hover:opacity-90">
            Try again
          </button>
        </div>
      )}
      {pollError && (
        <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-800">
          <p className="text-red-700 font-medium">Something went wrong: {pollError}</p>
          <button onClick={connect}
            className="mt-2 rounded-md bg-[#0A2540] px-3 py-2 text-sm font-medium text-white hover:opacity-90">
            Try again
          </button>
        </div>
      )}
      {connected && (
        <div className="mt-3 text-sm text-slate-700">
          <p className="font-medium text-green-700">Connected.</p>
          {progress && progress.status === 'syncing' && (
            <p className="mt-1">Importing… {progress.written.toLocaleString()} messages so far{progress.folder ? ` (folder ${progress.folder.slice(0,8)}…)` : ''}.</p>
          )}
          {progress && progress.status === 'done' && <p className="mt-1">All mail imported and searchable.</p>}
        </div>
      )}
    </section>
  );
}

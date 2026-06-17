import { useEffect, useState } from 'react';
import { mailIsConnected, mailBeginLogin, mailPollLogin, mailSyncAll, mailCancelSync, mailFdeStatus, type DeviceCodePrompt } from '@/utils/mail-commands';
import { useMailSync } from '@/features/email/useMailSync';
import { useMailStore } from '@/features/email/mailStore';
import { getMatters } from '@/platform/matter/matterStore';
import { buildMailMatterMap } from '@/platform/rag/matterResolver';

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

  // Poll for sign-in completion. Self-scheduling timeout (not a fixed interval)
  // so we can lengthen the delay on `slow_down` (RFC 8628). Cleared on unmount
  // or when the prompt changes. Poll errors are caught and surfaced.
  useEffect(() => {
    if (!prompt) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delayMs = Math.max(1, prompt.intervalSecs) * 1000;
    const expiresAt = Date.now() + prompt.expiresInSecs * 1000;

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() >= expiresAt) {
        setExpired(true);
        setPrompt(null);
        return;
      }
      try {
        const result = await mailPollLogin(prompt.deviceCode);
        if (cancelled) return;
        if (result === 'authorized') {
          setConnected(true);
          setPrompt(null);
          // Kick off the import; surface failures instead of leaving a spinner.
          // Pass the current mail->matter mapping so synced mail is scoped at
          // index time (unmapped folders fall back to "unassigned").
          mailSyncAll(buildMailMatterMap(getMatters())).catch((err) => {
            setPollError(err instanceof Error ? err.message : 'Mail sync could not start. Please try again.');
          });
          return;
        }
        if (result === 'slow_down') delayMs += 5000; // RFC 8628: back off by >= 5s
        timer = setTimeout(poll, delayMs);
      } catch (err) {
        if (cancelled) return;
        setPrompt(null);
        setPollError(err instanceof Error ? err.message : 'An error occurred while signing in. Please try again.');
      }
    };

    timer = setTimeout(poll, delayMs);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [prompt]);

  async function connect() {
    setExpired(false);
    setPollError(null);
    try {
      const p = await mailBeginLogin();
      setPrompt(p);
    } catch (err) {
      setPollError(err instanceof Error ? err.message : 'Could not start sign-in. Please try again.');
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

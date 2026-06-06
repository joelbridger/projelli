import { useEffect, useState } from 'react';
import { mailIsConnected, mailBeginLogin, mailPollLogin, mailSyncAll, type DeviceCodePrompt } from '@/utils/mail-commands';
import { useMailSync } from '@/hooks/useMailSync';
import { useMailStore } from '@/stores/mailStore';

export function MailConnect() {
  useMailSync();
  const progress = useMailStore((s) => s.progress);
  const [connected, setConnected] = useState(false);
  const [prompt, setPrompt] = useState<DeviceCodePrompt | null>(null);

  useEffect(() => { mailIsConnected().then(setConnected); }, []);

  async function connect() {
    const p = await mailBeginLogin();
    setPrompt(p);
    const timer = setInterval(async () => {
      const ok = await mailPollLogin(p.deviceCode);
      if (ok) { clearInterval(timer); setConnected(true); setPrompt(null); mailSyncAll(); }
    }, Math.max(1, p.intervalSecs) * 1000);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Microsoft 365 email</h3>
      <p className="mt-1 text-sm text-slate-600">
        Bring your Outlook mail into Keepance so you can actually find it. Your mail stays on this machine.
      </p>
      {!connected && !prompt && (
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

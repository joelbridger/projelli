/* eslint-disable keepance-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { MessageSquareText } from 'lucide-react';
import {
  ZOCKS_SYNC_EVENT,
  zocksCancel,
  zocksConnect,
  zocksDisconnect,
  zocksIsConnected,
  zocksListUnassigned,
  zocksSync,
  type ZocksConnectInfo,
  type ZocksSyncProgress,
  type ZocksSyncReport,
  type ZocksUnassignedSession,
} from '@/platform/utils/zocks-commands';
import { getMatters } from '@/platform/matter/matterStore';
import { buildZocksMatterMap } from '@/platform/rag/matterResolver';
import { isLocalOnlyMode } from '@/platform/privacy/localOnlyGuard';
import { Button } from '@/ui/kp';

export function ZocksConnect() {
  const [apiKey, setApiKey] = useState('');
  const [progress, setProgress] = useState<ZocksSyncProgress | null>(null);
  const [connected, setConnected] = useState(false);
  const [info, setInfo] = useState<ZocksConnectInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ZocksSyncReport | null>(null);
  const [unassigned, setUnassigned] = useState<ZocksUnassignedSession[]>([]);

  useEffect(() => {
    zocksIsConnected().then(setConnected).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<ZocksSyncProgress>(ZOCKS_SYNC_EVENT, (event) => {
      setProgress(event.payload);
    });
    return () => {
      void unlisten.then((fn) => { fn(); });
    };
  }, []);

  useEffect(() => {
    if (progress?.status === 'syncing') setSyncing(true);
    if (progress && progress.status !== 'syncing') setSyncing(false);
  }, [progress]);

  async function connect() {
    setError(null);
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError('Paste a Zocks API key first.');
      return;
    }
    if (isLocalOnlyMode()) {
      setError('Local-only mode is on. Turn it off before connecting Zocks, because sign-in contacts Zocks.');
      return;
    }
    setBusy(true);
    try {
      const connectedInfo = await zocksConnect(trimmed);
      setInfo(connectedInfo);
      setConnected(true);
      setApiKey('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setError(null);
    setSyncing(true);
    try {
      const result = await zocksSync(buildZocksMatterMap(getMatters()));
      setReport(result);
      setUnassigned(await zocksListUnassigned());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    setError(null);
    setBusy(true);
    try {
      await zocksCancel();
      const result = await zocksDisconnect();
      if (result.dataRemains) {
        setError(result.warnings.join('; ') || 'Disconnect is not finished. Some local Zocks data may remain.');
      } else {
        setConnected(false);
        setInfo(null);
        setReport(null);
        setUnassigned([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!isTauri()) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Zocks</h3>
        <p className="mt-1 text-xs text-slate-500">Zocks sync is available in the desktop app.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-slate-100 p-2 text-slate-600">
            <MessageSquareText className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Zocks</h3>
            <p className="mt-1 max-w-xl text-xs text-slate-500">
              Import meeting notes, action items, and transcript excerpts as read-only client memory.
            </p>
            <p className="mt-1 max-w-xl text-xs text-amber-700">
              Beta - endpoints pending Zocks confirmation.
            </p>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {info && (
        <p className="mt-3 text-xs text-slate-500">
          Endpoint: <span className="font-medium text-slate-700">{info.baseUrl}</span> ({info.endpointStatus})
        </p>
      )}

      {!connected && (
        <div className="mt-4 space-y-2">
          <input
            type="password"
            value={apiKey}
            onChange={(event) => { setApiKey(event.target.value); }}
            placeholder="Zocks API key"
            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            autoComplete="off"
            onKeyDown={(event) => { if (event.key === 'Enter') void connect(); }}
          />
          <Button size="sm" onClick={connect} disabled={busy}>
            {busy ? 'Connecting...' : 'Connect Zocks'}
          </Button>
        </div>
      )}

      {connected && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={syncNow} disabled={syncing || busy}>
            {syncing ? 'Syncing...' : 'Sync Zocks meetings'}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { void zocksCancel(); }} disabled={!syncing}>
            Stop
          </Button>
          <Button size="sm" variant="secondary" onClick={disconnect} disabled={busy || syncing}>
            Disconnect
          </Button>
        </div>
      )}

      {progress?.status === 'syncing' && (
        <p className="mt-3 text-xs text-slate-600">
          Indexed {progress.sessions ?? 0} session{(progress.sessions ?? 0) === 1 ? '' : 's'} so far.
        </p>
      )}
      {report && (
        <p className="mt-3 text-xs text-slate-600">
          Imported {report.sessionsFetched} sessions, indexed {report.recordsIndexed} records, and found {report.needsAssignment} needing assignment.
        </p>
      )}
      {unassigned.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-medium text-amber-900">Needs assignment</p>
          <ul className="mt-1 space-y-1 text-xs text-amber-800">
            {unassigned.slice(0, 3).map((item) => (
              <li key={item.sourceId}>{item.title || item.sessionId}: {item.reason}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </section>
  );
}

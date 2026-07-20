/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ClipboardList } from 'lucide-react';
import {
  JOTFORM_SYNC_EVENT,
  jotformCancel,
  jotformConnect,
  jotformDisconnect,
  jotformIsConnected,
  jotformListForms,
  jotformListUnassigned,
  jotformSync,
  type JotformConnectInfo,
  type JotformForm,
  type JotformSyncProgress,
  type JotformSyncReport,
  type JotformUnassignedSubmission,
} from '@/platform/utils/jotform-commands';
import { getMatters } from '@/platform/matter/matterStore';
import { buildJotformMatterMap } from '@/platform/rag/matterResolver';
import { isPersistedLocalOnly } from '@/platform/privacy/localOnlyGuard';
import { Button } from '@/ui/kp';
import { InfoHelp } from '@/ui/InfoHelp';
import { brandText } from '@/config/brandText';
import { BRAND } from '@/config/brand';

export function JotformConnect() {
  const [progress, setProgress] = useState<JotformSyncProgress | null>(null);
  const [connected, setConnected] = useState(false);
  const [info, setInfo] = useState<JotformConnectInfo | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<JotformSyncReport | null>(null);
  const [forms, setForms] = useState<JotformForm[]>([]);
  const [unassigned, setUnassigned] = useState<JotformUnassignedSubmission[]>([]);

  useEffect(() => {
    jotformIsConnected().then(setConnected).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<JotformSyncProgress>(JOTFORM_SYNC_EVENT, (event) => {
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
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError('Paste your Jotform API key first.');
      return;
    }
    if (isPersistedLocalOnly()) {
      setError('Local-only mode is on. Turn it off before connecting Jotform, because connect checks your Jotform account.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const connectedInfo = await jotformConnect(trimmed);
      setInfo(connectedInfo);
      setConnected(true);
      setApiKey('');
      // Re-check: jotformConnect() itself just awaited a Jotform call, so a
      // Local-only switch mid-flight could otherwise slip past the guard
      // above and still fire this forms-listing call.
      if (!isPersistedLocalOnly()) {
        setForms(await jotformListForms());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setError(null);
    if (isPersistedLocalOnly()) {
      setError('Local-only mode is on. Turn it off before syncing Jotform, because it contacts Jotform.');
      return;
    }
    setSyncing(true);
    try {
      const result = await jotformSync(buildJotformMatterMap(getMatters()));
      setReport(result);
      // Re-check before EACH follow-up Jotform call: jotformSync() (and then
      // jotformListForms()) just awaited a Jotform call, so a Local-only
      // switch mid-flight could otherwise slip past an earlier guard and
      // still fire the next one.
      if (!isPersistedLocalOnly()) {
        setForms(await jotformListForms());
        if (!isPersistedLocalOnly()) {
          setUnassigned(await jotformListUnassigned());
        }
      }
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
      await jotformCancel();
      const result = await jotformDisconnect();
      if (result.dataRemains) {
        setError(result.warnings.join('; ') || 'Disconnect is not finished. Some local Jotform data may remain.');
      } else {
        setConnected(false);
        setInfo(null);
        setReport(null);
        setForms([]);
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
        <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
          Jotform
          <InfoHelp content="Jotform sync is available in the desktop app." />
        </h3>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-slate-100 p-2 text-slate-600">
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
              Jotform
              <InfoHelp content={brandText(`Import intake and KYC form submissions as read-only client records. ${BRAND.name} indexes the submitted answers, not files.`)} />
            </h3>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {info && (
        <p className="mt-3 text-xs text-slate-500">
          Account: <span className="font-medium text-slate-700">{info.name || info.email || info.username}</span>
        </p>
      )}

      {!connected ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-slate-500">
            {brandText(`Paste an API key from your Jotform account API settings. ${BRAND.name} stores it in this computer's keychain.`)}
          </p>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); }}
            placeholder="Jotform API key"
            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            autoComplete="off"
            onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
          />
          <Button size="sm" onClick={() => void connect()} disabled={busy}>
            {busy ? 'Connecting...' : 'Connect Jotform'}
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void syncNow()} disabled={syncing || busy}>
            {syncing ? 'Syncing...' : 'Sync submissions'}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { void jotformCancel(); }} disabled={!syncing}>
            Stop
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void disconnect()} disabled={busy || syncing}>
            Disconnect
          </Button>
        </div>
      )}

      {progress?.status === 'syncing' && (
        <p className="mt-3 text-xs text-slate-500">
          Indexed {progress.submissions ?? 0} submission{(progress.submissions ?? 0) === 1 ? '' : 's'} so far.
        </p>
      )}
      {report && (
        <p className="mt-3 text-xs text-slate-600">
          Checked {report.formsFetched} forms, imported {report.submissionsFetched} submissions, indexed {report.recordsIndexed} records, and found {report.needsAssignment} needing assignment.
        </p>
      )}
      {forms.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Found {forms.length} form{forms.length === 1 ? '' : 's'} in this account.
        </p>
      )}
      {unassigned.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-medium text-amber-900">Needs assignment</p>
          <ul className="mt-1 space-y-1 text-xs text-amber-800">
            {unassigned.slice(0, 3).map((item) => (
              <li key={item.sourceId}>{item.submitter || item.submissionId}: {item.reason}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </section>
  );
}

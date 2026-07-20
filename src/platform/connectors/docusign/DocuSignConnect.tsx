/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { FileSignature } from 'lucide-react';
import {
  DOCUSIGN_SYNC_EVENT,
  docusignCancelSync,
  docusignConnect,
  docusignDisconnect,
  docusignIsConnected,
  docusignListUnassigned,
  docusignSync,
  type DocusignConnectInfo,
  type DocusignSyncProgress,
  type DocusignSyncReport,
  type DocusignUnassignedEnvelope,
} from '@/platform/utils/docusign-commands';
import { getMatters } from '@/platform/matter/matterStore';
import { buildEsignMatterMap } from '@/platform/rag/matterResolver';
import { isPersistedLocalOnly } from '@/platform/privacy/localOnlyGuard';
import { Button } from '@/ui/kp';
import { InfoHelp } from '@/ui/InfoHelp';
import { brandText } from '@/config/brandText';
import { BRAND } from '@/config/brand';

export function DocuSignConnect() {
  const [progress, setProgress] = useState<DocusignSyncProgress | null>(null);
  const [connected, setConnected] = useState(false);
  const [info, setInfo] = useState<DocusignConnectInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DocusignSyncReport | null>(null);
  const [unassigned, setUnassigned] = useState<DocusignUnassignedEnvelope[]>([]);

  useEffect(() => {
    docusignIsConnected().then(setConnected).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<DocusignSyncProgress>(DOCUSIGN_SYNC_EVENT, (event) => {
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
    if (isPersistedLocalOnly()) {
      setError('Local-only mode is on. Turn it off before connecting DocuSign, because sign-in contacts DocuSign.');
      return;
    }
    setBusy(true);
    try {
      const connectedInfo = await docusignConnect();
      setInfo(connectedInfo);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setError(null);
    if (isPersistedLocalOnly()) {
      setError('Local-only mode is on. Turn it off before syncing DocuSign, because it contacts DocuSign.');
      return;
    }
    setSyncing(true);
    try {
      const result = await docusignSync(buildEsignMatterMap(getMatters()));
      setReport(result);
      // Re-check: docusignSync() itself just awaited a DocuSign call, so a
      // Local-only switch mid-flight could otherwise slip past the guard
      // above and still fire this follow-up DocuSign call.
      if (!isPersistedLocalOnly()) {
        setUnassigned(await docusignListUnassigned());
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
      await docusignCancelSync();
      const result = await docusignDisconnect();
      if (result.dataRemains) {
        setError(result.warnings.join('; ') || 'Disconnect is not finished. Some local DocuSign data may remain.');
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
        <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
          DocuSign
          <InfoHelp content="DocuSign sync is available in the desktop app." />
        </h3>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-slate-100 p-2 text-slate-600">
            <FileSignature className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
              DocuSign
              <InfoHelp content={brandText(`Import completed envelopes, recipients, document names, and signing history. ${BRAND.name} only reads DocuSign data.`)} />
            </h3>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {info && (
        <p className="mt-3 text-xs text-slate-500">
          Account: <span className="font-medium text-slate-700">{info.accountName || info.accountId}</span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {!connected ? (
          <Button size="sm" onClick={() => { void connect(); }} disabled={busy}>
            {busy ? 'Connecting...' : 'Connect DocuSign'}
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={() => { void syncNow(); }} disabled={syncing || busy}>
              {syncing ? 'Syncing...' : 'Sync completed envelopes'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { void docusignCancelSync(); }} disabled={!syncing}>
              Stop
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { void disconnect(); }} disabled={busy || syncing}>
              Disconnect
            </Button>
          </>
        )}
      </div>

      {report && (
        <p className="mt-3 text-xs text-slate-600">
          Imported {report.envelopesFetched} envelopes, indexed {report.recordsIndexed} records, and found {report.needsAssignment} needing assignment.
        </p>
      )}
      {unassigned.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-medium text-amber-900">Needs assignment</p>
          <ul className="mt-1 space-y-1 text-xs text-amber-800">
            {unassigned.slice(0, 3).map((item) => (
              <li key={item.sourceId}>{item.subject || item.envelopeId}: {item.reason}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </section>
  );
}

/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Box as BoxIcon } from 'lucide-react';
import {
  BOX_SYNC_EVENT,
  boxCancel,
  boxConnect,
  boxDisconnect,
  boxIsConnected,
  boxListFolders,
  boxStatus,
  boxSync,
  type BoxSyncProgress,
  type BoxSyncReport,
} from '@/platform/utils/box-commands';
import { getMatters, useMatterStore } from '@/platform/matter/matterStore';
import {
  buildBoxMatterMap,
  isTopLevelBoxClientFolder,
  resolveMatterForBoxFolder,
} from '@/platform/rag/matterResolver';
import { isPersistedLocalOnly } from '@/platform/privacy/localOnlyGuard';
import { Button } from '@/ui/kp';
import { InfoHelp } from '@/ui/InfoHelp';
import { AuditService } from '@/platform/audit/AuditService';
import { sanitizeSyncError } from '@/platform/connectors/syncAuditError';
import { brandText } from '@/config/brandText';
import { BRAND } from '@/config/brand';

// Durable, append-only audit trail for connector activity, so every Box sync leaves a record.
const boxAudit = new AuditService('connectors');

export function BoxConnect() {
  const [progress, setProgress] = useState<BoxSyncProgress | null>(null);
  const [connected, setConnected] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<BoxSyncReport | null>(null);
  const addBoxFolderKey = useMatterStore((s) => s.addBoxFolderKey);

  useEffect(() => {
    boxIsConnected()
      .then(setConnected)
      .catch(() => {});
    boxStatus()
      .then((status) => {
        setSyncing(status.isSyncing);
        setReport(status.lastReport);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<BoxSyncProgress>(BOX_SYNC_EVENT, (event) => {
      setProgress(event.payload);
    });
    return () => {
      void unlisten.then((fn) => {
        fn();
      });
    };
  }, []);

  useEffect(() => {
    if (progress?.status === 'syncing') setSyncing(true);
    if (progress && progress.status !== 'syncing') setSyncing(false);
  }, [progress]);

  async function connect() {
    const trimmed = accessToken.trim();
    setError(null);
    if (isPersistedLocalOnly()) {
      setError('Local-only mode is on. Turn it off before connecting Box, because sign-in contacts Box.');
      return;
    }
    if (!trimmed) {
      setError('Paste your Box Developer Token first.');
      return;
    }
    setBusy(true);
    try {
      await boxConnect(trimmed);
      setConnected(true);
      setAccessToken('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setError(null);
    if (isPersistedLocalOnly()) {
      setError('Local-only mode is on. Turn it off before syncing Box, because it contacts Box.');
      return;
    }
    setSyncing(true);
    try {
      // Link Box client folders to matters FIRST so the matter map isn't empty;
      // otherwise every Box file would import into the unassigned bucket and
      // never surface in client-scoped search or citations.
      await autoLinkBoxFolders();
      // Re-check: autoLinkBoxFolders() itself just awaited a Box call, so a
      // Local-only switch mid-flight could otherwise slip past the guard
      // above and still fire this larger sync call.
      if (isPersistedLocalOnly()) {
        setError('Local-only mode is on. Turn it off before syncing Box, because it contacts Box.');
        return;
      }
      const result = await boxSync(buildBoxMatterMap(getMatters()));
      setReport(result);
      void boxAudit
        .logDurable(
          'box.sync',
          `Box sync: ${result.cancelled ? 'stopped after downloading' : 'downloaded'} ${String(result.downloaded)} file(s), indexed ${String(result.indexed)} (${String(result.seen)} items checked).`,
          {
            outputs: {
              seen: result.seen,
              downloaded: result.downloaded,
              indexed: result.indexed,
              skippedUnchanged: result.skippedUnchanged,
              removed: result.removed,
              pendingPdf: result.pendingPdf,
              cancelled: result.cancelled,
            },
          }
        )
        .catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      void boxAudit
        .logDurable('box.sync', 'Box sync failed.', {
          outputs: { error: sanitizeSyncError(err) },
        })
        .catch(() => {});
    } finally {
      setSyncing(false);
    }
  }

  // Auto-link top-level Box client folders (`/clients/<name>`) to matching
  // matters by name before sync, mirroring OneDrive. One unambiguous same-name
  // match links; ambiguous or already-linked folders are left alone.
  async function autoLinkBoxFolders(): Promise<void> {
    const folders = await boxListFolders();
    const claimed = new Set<string>();
    for (const folder of folders) {
      if (!isTopLevelBoxClientFolder(folder)) continue;
      const resolution = resolveMatterForBoxFolder(getMatters(), folder, claimed);
      if (resolution.action !== 'link') continue;
      addBoxFolderKey(resolution.matterId, folder.key);
      claimed.add(resolution.matterId);
    }
  }

  async function disconnect() {
    setError(null);
    setBusy(true);
    try {
      await boxCancel();
      await boxDisconnect();
      setConnected(false);
      setReport(null);
      setProgress(null);
      setAccessToken('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      boxIsConnected()
        .then(setConnected)
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  if (!isTauri()) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
          Box
          <InfoHelp content="Box sync is available in the desktop app." />
        </h3>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-slate-100 p-2 text-slate-600">
            <BoxIcon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
              Box
              <InfoHelp content={brandText(`Import supported documents from Box into encrypted local search. ${BRAND.name} only reads Box files.`)} />
            </h3>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {!connected && (
        <div className="mt-4 space-y-2">
          <label htmlFor="box-developer-token" className="text-xs font-medium text-slate-700">
            Paste your Box Developer Token
          </label>
          <textarea
            id="box-developer-token"
            value={accessToken}
            onChange={(event) => {
              setAccessToken(event.currentTarget.value);
            }}
            rows={3}
            placeholder="Box Developer Token"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
          <p className="text-xs text-slate-500">
            Developer Tokens expire. If Box stops syncing later, paste a fresh token and reconnect.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {!connected ? (
          <Button size="sm" onClick={() => { void connect(); }} disabled={busy}>
            {busy ? 'Connecting...' : 'Connect Box'}
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={() => { void syncNow(); }} disabled={syncing || busy}>
              {syncing ? 'Syncing...' : 'Sync Box files'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { void boxCancel(); }} disabled={!syncing}>
              Stop
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { void disconnect(); }} disabled={busy || syncing}>
              Disconnect
            </Button>
          </>
        )}
      </div>

      {progress?.status === 'syncing' && (
        <p className="mt-3 text-xs text-slate-600">
          Importing... {progress.seen ?? 0} items checked.
        </p>
      )}
      {progress?.status === 'cancelled' && (
        <p className="mt-3 text-xs text-slate-500">Import stopped.</p>
      )}
      {progress?.status === 'error' && (
        <p className="mt-3 text-xs text-red-600">Box sync ran into a problem.</p>
      )}
      {report && (
        <p className="mt-3 text-xs text-slate-600">
          {report.cancelled ? 'Stopped early. ' : ''}Checked {report.seen} items, downloaded {report.downloaded}, indexed {report.indexed}, and skipped {report.skippedUnchanged} unchanged.
          {report.pendingPdf ? ` ${String(report.pendingPdf)} PDF files are queued for the PDF fast-follow.` : ''}
        </p>
      )}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </section>
  );
}

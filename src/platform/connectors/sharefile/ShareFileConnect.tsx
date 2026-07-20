/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { FolderLock } from 'lucide-react';
import {
  SHAREFILE_SYNC_EVENT,
  sharefileCancel,
  sharefileConnect,
  sharefileDisconnect,
  sharefileIsConnected,
  sharefileListFolders,
  sharefileSync,
  type SharefileFolder,
  type SharefileSyncProgress,
  type SharefileSyncReport,
} from '@/platform/utils/sharefile-commands';
import { getMatters, useMatterStore } from '@/platform/matter/matterStore';
import { buildSharefileMatterMap } from '@/platform/rag/matterResolver';
import { isPersistedLocalOnly } from '@/platform/privacy/localOnlyGuard';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { InfoHelp } from '@/ui/InfoHelp';
import type { Matter } from '@/platform/types/matter';
import { brandText } from '@/config/brandText';
import { BRAND } from '@/config/brand';

function normalizeClientName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function folderLeafName(folder: SharefileFolder): string {
  return folder.path.split('/').filter(Boolean).pop()?.trim() || folder.name;
}

function isTopLevelSharefileClientFolder(folder: SharefileFolder): boolean {
  const segments = folder.path.toLowerCase().split('/').filter(Boolean);
  return segments.length === 2 && segments[0] === 'clients';
}

function linkSharefileClientFoldersToMatters(
  folders: SharefileFolder[],
  matters: Matter[],
  addSharefileFolderKey: (matterId: string, folderKey: string) => void
): number {
  const claimedMatterIds = new Set<string>();
  let linked = 0;
  for (const folder of folders) {
    if (!isTopLevelSharefileClientFolder(folder)) continue;
    const folderName = normalizeClientName(folderLeafName(folder));
    if (!folderName) continue;
    const matches = matters.filter(
      (matter) =>
        normalizeClientName(matter.name) === folderName ||
        normalizeClientName(matter.client) === folderName
    );
    if (matches.length !== 1) continue;
    const match = matches[0];
    if (!match || claimedMatterIds.has(match.id)) continue;
    if ((match.sharefileFolderKeys ?? []).includes(folder.key)) continue;
    if ((match.sharefileFolderKeys ?? []).length > 0) continue;
    addSharefileFolderKey(match.id, folder.key);
    claimedMatterIds.add(match.id);
    linked += 1;
  }
  return linked;
}

export function ShareFileConnect() {
  const localOnly = useConfidentialityMode() === 'local-only';
  const [connected, setConnected] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SharefileSyncReport | null>(null);
  const [progress, setProgress] = useState<SharefileSyncProgress | null>(null);
  const addSharefileFolderKey = useMatterStore((s) => s.addSharefileFolderKey);

  useEffect(() => {
    sharefileIsConnected()
      .then(setConnected)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<SharefileSyncProgress>(SHAREFILE_SYNC_EVENT, (event) => {
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

  async function autoLinkSharefileFolders(): Promise<void> {
    const folders = await sharefileListFolders();
    linkSharefileClientFoldersToMatters(
      folders,
      getMatters(),
      addSharefileFolderKey
    );
  }

  async function connect() {
    setError(null);
    // A user-authorized connector (pulls the user's own files in, never sends
    // to a cloud AI) — gate on `isPersistedLocalOnly()`, which reads the
    // persisted mode directly instead of the in-memory settings store (still
    // reporting the schema default during the hydration window at app start),
    // so a sync triggered in that window can't slip past a genuinely-chosen
    // Local-only mode, while "no choice recorded yet" still allows the sync —
    // matching every other connector, instead of the fail-closed AI-send guard
    // this used to (incorrectly) call.
    if (isPersistedLocalOnly()) {
      setError('Local-only mode is on, so ShareFile sync is paused. Turn off Local-only mode in the Privacy Center to import documents from ShareFile.');
      return;
    }
    setBusy(true);
    try {
      await sharefileConnect(accessToken, subdomain);
      setAccessToken('');
      setConnected(true);
      await autoLinkSharefileFolders();
      sharefileSync(buildSharefileMatterMap(getMatters())).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setError(null);
    if (isPersistedLocalOnly()) {
      setError('Local-only mode is on, so ShareFile sync is paused. Turn off Local-only mode in the Privacy Center to import documents from ShareFile.');
      return;
    }
    setSyncing(true);
    try {
      await autoLinkSharefileFolders();
      const result = await sharefileSync(buildSharefileMatterMap(getMatters()));
      setReport(result);
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
      await sharefileCancel();
      await sharefileDisconnect();
      setConnected(false);
      setReport(null);
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      sharefileIsConnected()
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
          ShareFile documents
          <InfoHelp content="ShareFile sync is available in the desktop app." />
        </h3>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-slate-100 p-2 text-slate-600">
            <FolderLock className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
              ShareFile documents
              <InfoHelp content={brandText(`Import documents this ShareFile token can read. ${BRAND.name} downloads supported Office and text files, extracts text locally, and stores encrypted search chunks by client. Read-only: ${BRAND.name} lists folders and downloads files. It never uploads, edits, moves, or deletes anything in ShareFile.`)} />
            </h3>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {localOnly && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Local-only mode is on, so ShareFile sync is paused. Switch out of Local-only mode in Privacy settings to import documents from ShareFile.
        </p>
      )}

      {!connected ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="block text-xs font-medium text-slate-700">
            Account subdomain
            <input
              value={subdomain}
              onChange={(event) => {
                setSubdomain(event.target.value);
              }}
              placeholder="yourfirm.sf-api.com"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500"
            />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Access token
            <input
              value={accessToken}
              onChange={(event) => {
                setAccessToken(event.target.value);
              }}
              placeholder="Paste ShareFile access token"
              type="password"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500"
            />
          </label>
          <button
            type="button"
            disabled={busy || localOnly || !accessToken.trim() || !subdomain.trim()}
            onClick={() => {
              void connect();
            }}
            className="self-end rounded-md bg-[#0A2540] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      ) : (
        <div className="mt-3 text-sm text-slate-700">
          <p className="font-medium text-green-700">Connected.</p>
          {progress?.status === 'syncing' && (
            <div className="mt-1 flex items-center gap-3">
              <p>Importing... {progress.seen ?? 0} items checked.</p>
              <button
                type="button"
                onClick={() => {
                  void sharefileCancel();
                }}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Stop
              </button>
            </div>
          )}
          {progress?.status === 'done' && (
            <p className="mt-1">
              Documents imported.{' '}
              {progress.pendingPdf
                ? `${String(progress.pendingPdf)} PDF files are queued for the PDF fast-follow.`
                : ''}
            </p>
          )}
          {progress?.status === 'cancelled' && (
            <p className="mt-1 text-slate-500">Import stopped.</p>
          )}
          {progress?.status === 'error' && (
            <p className="mt-1 text-red-700">ShareFile sync ran into a problem.</p>
          )}
          {report && (
            <p className="mt-1 text-xs text-slate-600">
              Checked {report.seen} items, downloaded {report.downloaded}, indexed {report.indexed}, and removed {report.removed} stale files.
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={syncing || localOnly}
              onClick={() => {
                void syncNow();
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {syncing ? 'Syncing...' : 'Sync now'}
            </button>
            <button
              type="button"
              onClick={() => {
                void disconnect();
              }}
              disabled={busy || syncing}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </section>
  );
}

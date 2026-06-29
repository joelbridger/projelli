/* eslint-disable keepance-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import {
  oneDriveCancel,
  oneDriveConnect,
  oneDriveDisconnect,
  oneDriveIsConnected,
  oneDriveListFolders,
  oneDriveSync,
  type OneDriveFolder,
} from '@/platform/utils/onedrive-commands';
import {
  buildOneDriveMatterMap,
  isTopLevelOneDriveClientFolder,
  resolveMatterForOneDriveFolder,
} from '@/platform/rag/matterResolver';
import { getMatters, useMatterStore } from '@/platform/matter/matterStore';
import { useOneDriveSync } from '@/features/onedrive/useOneDriveSync';
import { useOneDriveStore } from '@/features/onedrive/onedriveStore';
import { assertLocalOnlyAllowsExternal } from '@/platform/privacy/localOnlyGuard';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import type { Matter } from '@/platform/types/matter';

function linkOneDriveClientFoldersToMatters(
  folders: OneDriveFolder[],
  matters: Matter[],
  addOneDriveFolderKey: (matterId: string, folderKey: string) => void
): number {
  const claimedMatterIds = new Set<string>();
  let linked = 0;
  for (const folder of folders) {
    if (!isTopLevelOneDriveClientFolder(folder)) continue;
    const resolution = resolveMatterForOneDriveFolder(
      matters,
      folder,
      claimedMatterIds
    );
    if (resolution.action !== 'link') continue;
    addOneDriveFolderKey(resolution.matterId, folder.key);
    claimedMatterIds.add(resolution.matterId);
    linked += 1;
  }
  return linked;
}

export function OneDriveConnect() {
  useOneDriveSync();
  const progress = useOneDriveStore((s) => s.progress);
  const localOnly = useConfidentialityMode() === 'local-only';
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addOneDriveFolderKey = useMatterStore((s) => s.addOneDriveFolderKey);

  useEffect(() => {
    oneDriveIsConnected()
      .then(setConnected)
      .catch(() => {});
  }, []);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      assertLocalOnlyAllowsExternal('OneDrive document sync');
      await oneDriveConnect();
      setConnected(true);
      assertLocalOnlyAllowsExternal('OneDrive document sync');
      await autoLinkOneDriveFolders();
      oneDriveSync(buildOneDriveMatterMap(getMatters())).catch(
        (err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }

  async function syncNow() {
    setError(null);
    try {
      assertLocalOnlyAllowsExternal('OneDrive document sync');
      await autoLinkOneDriveFolders();
      await oneDriveSync(buildOneDriveMatterMap(getMatters()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function disconnect() {
    setError(null);
    try {
      await oneDriveCancel();
      await oneDriveDisconnect();
      setConnected(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      oneDriveIsConnected()
        .then(setConnected)
        .catch(() => {});
    }
  }

  async function autoLinkOneDriveFolders(): Promise<void> {
    const folders = await oneDriveListFolders();
    linkOneDriveClientFoldersToMatters(
      folders,
      getMatters(),
      addOneDriveFolderKey
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">
        OneDrive and SharePoint documents
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        Imports documents this Microsoft login can read. Keepance downloads
        supported Office and text files, extracts text locally, and stores
        encrypted search chunks by matter.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        Read-only: Keepance only asks Microsoft for files. It never edits,
        uploads, moves, or deletes anything in OneDrive or SharePoint.
      </p>
      {localOnly && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Local-only mode is on, so OneDrive sync is paused. Switch out of
          Local-only mode in Privacy settings to import documents from
          Microsoft.
        </p>
      )}

      {!connected ? (
        <div className="mt-3 space-y-3">
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button
            type="button"
            disabled={connecting || localOnly}
            onClick={() => {
              void connect();
            }}
            className="rounded-md bg-[var(--kp-navy)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {connecting
              ? 'Waiting for Microsoft sign-in...'
              : 'Connect OneDrive'}
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
                  void oneDriveCancel();
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
            <p className="mt-1 text-red-700">
              OneDrive sync ran into a problem.
            </p>
          )}
          {error && <p className="mt-1 text-red-700">{error}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={localOnly}
              onClick={() => {
                void syncNow();
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Sync now
            </button>
            <button
              type="button"
              onClick={() => {
                void disconnect();
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import {
  oneDriveCancel,
  oneDriveConnect,
  oneDriveConnectCancel,
  oneDriveDisconnect,
  oneDriveIsConnected,
  oneDriveListFolders,
  oneDriveSync,
  type OneDriveFolder,
  type OneDriveSyncReport,
} from '@/platform/utils/onedrive-commands';
import {
  buildOneDriveMatterMap,
  isLinkableOneDriveClientFolder,
  oneDriveDestFolderForMatter,
  resolveMatterForOneDriveFolder,
} from '@/platform/rag/matterResolver';
import { getMatters, useMatterStore } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { AuditService } from '@/platform/audit/AuditService';
import { sanitizeSyncError } from '@/platform/connectors/syncAuditError';
import { useOneDriveSync } from '@/platform/connectors/onedrive/useOneDriveSync';
import { useOneDriveStore } from '@/platform/connectors/onedrive/onedriveStore';
import {
  ONEDRIVE_LIST_FOLDERS_TIMEOUT_MS,
  ONEDRIVE_SYNC_TIMEOUT_MS,
  withOneDriveTimeout,
} from '@/platform/connectors/onedrive/onedriveTimeout';
import { isPersistedLocalOnly } from '@/platform/privacy/localOnlyGuard';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { beginOAuth, endOAuth } from '@/platform/connectors/oauthPending';
import type { Matter } from '@/platform/types/matter';

// Durable, append-only audit trail for connector activity, so a OneDrive sync
// (including one that imported zero files or failed) always leaves a record —
// the same honesty guarantee the Wealthbox path gives.
const oneDriveAudit = new AuditService('connectors');

// OneDrive sync is a user-authorized CONNECTOR (it pulls the user's own files
// in; it never sends anything to a cloud AI), so per the documented scope of
// `assertLocalOnlyAllowsExternal` it must NOT use that fail-closed AI-send
// guard — that guard blocks until an explicit confidentiality *choice* has
// been recorded, which is a cloud-AI-generation concept unrelated to reading
// your own OneDrive files, and used to spuriously kill this sync on any
// workspace that never made that AI choice (fresh installs, seeded/test
// workspaces). Gate on `isPersistedLocalOnly()` instead: it reads the
// persisted mode directly (not the in-memory settings store, which still
// reports the schema default during the hydration window right at app
// start), so a sync triggered in that window can't slip past a user who
// GENUINELY chose Local-only — while "no choice recorded yet" still allows
// the sync, matching every other connector (Box, Addepar, DocuSign, Jotform,
// Zocks).
const LOCAL_ONLY_BLOCKED_MESSAGE =
  'Local-only mode is on, so OneDrive sync is paused. Turn off Local-only mode in the Privacy Center to import documents from Microsoft.';

function linkOneDriveClientFoldersToMatters(
  folders: OneDriveFolder[],
  matters: Matter[],
  addOneDriveFolderKey: (matterId: string, folderKey: string) => void
): number {
  const claimedMatterIds = new Set<string>();
  let linked = 0;
  for (const folder of folders) {
    // Accept both `Clients/<name>` folders and a top-level `<name>` folder named
    // after a client (the common real-world layout). Linking itself stays strict:
    // resolveMatterForOneDriveFolder only links an unambiguous exact name match.
    if (!isLinkableOneDriveClientFolder(folder)) continue;
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

/**
 * Ensure every OneDrive-linked matter has an on-disk folder to receive its files,
 * so the imported documents show up under that client in the Documents tab and
 * resolve to the right matter. A matter that already has a folder keeps it; only
 * a matter with no folder yet gets a `Clients/<name>` folder registered.
 */
function ensureOneDriveDestFolders(
  matters: Matter[],
  workspaceRoot: string | null,
  addFolderPath: (matterId: string, folderPath: string) => void
): void {
  for (const m of matters) {
    if (!(m.onedriveFolderKeys ?? []).length) continue;
    if (m.folderPaths.some(Boolean)) continue;
    const dest = oneDriveDestFolderForMatter(m, workspaceRoot);
    if (dest) addFolderPath(m.id, dest);
  }
}

export function OneDriveConnect() {
  useOneDriveSync();
  const progress = useOneDriveStore((s) => s.progress);
  const localOnly = useConfidentialityMode() === 'local-only';
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<OneDriveSyncReport | null>(null);
  // Covers the WHOLE runSync() operation, including the folder-discovery walk
  // (autoLinkOneDriveFolders -> oneDriveListFolders) that runs BEFORE
  // oneDriveSync ever starts. The Rust `progress` signal below only starts
  // once onedrive_sync itself begins emitting, so relying on it alone left
  // the spinner (and the disabled state on the button, preventing a
  // double-click) dark during the whole folder-listing phase — exactly the
  // silent-looking window a slow or resource-starved listing hits.
  const [localSyncing, setLocalSyncing] = useState(false);
  const addOneDriveFolderKey = useMatterStore((s) => s.addOneDriveFolderKey);
  const addFolderPath = useMatterStore((s) => s.addFolderPath);

  useEffect(() => {
    oneDriveIsConnected()
      .then(setConnected)
      .catch(() => {});
  }, []);

  async function connect() {
    setError(null);
    setLastReport(null);
    if (isPersistedLocalOnly()) {
      setError(LOCAL_ONLY_BLOCKED_MESSAGE);
      return;
    }
    setConnecting(true);
    // Mark an interactive OAuth sign-in pending so onboarding disables Continue
    // until this multi-minute browser flow settles.
    beginOAuth();
    try {
      await oneDriveConnect();
      setConnected(true);
      // Connect = IMPORT: kick off the first sync right after auth.
      void runSync();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The user clicked Cancel — this is an intentional exit, not a failure,
      // so don't show a red error for it (and the prior connection, if any,
      // was never touched).
      if (message !== 'cancelled') setError(message);
    } finally {
      setConnecting(false);
      endOAuth();
    }
  }

  // Abort a pending sign-in immediately instead of leaving the user stuck on
  // "Waiting for Microsoft sign-in..." for the full 5-minute server-side
  // OAuth timeout with no way out. The prior connection (if any) is left
  // untouched.
  function cancelConnect() {
    oneDriveConnectCancel().catch(() => {});
  }

  async function syncNow() {
    setError(null);
    await runSync();
  }

  /**
   * Link folders, materialize the client's OneDrive files into their workspace
   * folder, and record an honest, auditable result — an imported count on
   * success, a clear "nothing came in" on a zero-file run, and the error on a
   * failure. Never a silent no-op that looks like success.
   */
  async function runSync(): Promise<void> {
    if (isPersistedLocalOnly()) {
      setError(LOCAL_ONLY_BLOCKED_MESSAGE);
      return;
    }
    // Covers the folder-discovery walk below too, not just the oneDriveSync
    // call — see the localSyncing declaration for why that phase needs its
    // own signal instead of relying solely on the Rust `progress` event.
    setLocalSyncing(true);
    // Clear the PRIOR attempt's result before this one starts — otherwise a
    // stop during folder discovery (which sets no `lastReport` of its own)
    // would leave a stale "Imported N files..." from a previous successful
    // run visible right alongside the new "Import stopped.", making the just
    // stopped attempt look like it succeeded.
    setLastReport(null);
    try {
      await autoLinkOneDriveFolders();
      const workspaceRoot = useWorkspaceStore.getState().rootPath;
      const report = await withOneDriveTimeout(
        oneDriveSync(buildOneDriveMatterMap(getMatters(), workspaceRoot)),
        'sync',
        ONEDRIVE_SYNC_TIMEOUT_MS
      );
      setLastReport(report);
      // A stopped sync resolves with real (partial) counts — record it honestly
      // as cancelled, not as a plain success.
      const verb = report.cancelled ? 'stopped after importing' : 'imported';
      void oneDriveAudit
        .logDurable(
          'onedrive.sync',
          `OneDrive sync: ${verb} ${String(report.imported)} file(s) into client folders (${String(report.seen)} items checked).`,
          {
            outputs: {
              imported: report.imported,
              checked: report.seen,
              indexed: report.indexed,
              pendingPdf: report.pendingPdf,
              removed: report.removed,
              cancelled: report.cancelled,
            },
          }
        )
        .catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'cancelled') {
        // The user clicked Stop before onedrive_sync even started emitting
        // its own progress (e.g. during the folder-discovery walk) — an
        // intentional exit, not a failure, matching how connect()'s own
        // Cancel is treated above. Reuse the SAME "Import stopped." outcome
        // the Rust-driven `progress.status === 'cancelled'` event already
        // renders for a stop mid-sync, so a stop during folder discovery is
        // an equally visible, non-error outcome — never a silent return to
        // idle.
        useOneDriveStore.getState().setProgress({ status: 'cancelled' });
      } else {
        setError(message);
        // If onedrive_sync had already emitted its initial "syncing" event
        // before this failed — including the exact case withOneDriveTimeout
        // exists for: the command genuinely stalled AFTER that first event,
        // so no Rust-side terminal event (done/error/cancelled) is ever
        // coming — `progress.status` would otherwise stay stuck at
        // 'syncing' forever, and since `syncing` is derived from
        // `localSyncing || progress?.status === 'syncing'`, the spinner and
        // the disabled Sync-now button would never clear even though
        // localSyncing just flipped false in the `finally` below. Force the
        // derived state to a terminal one regardless of which side (Rust or
        // this frontend backstop) actually produced the failure.
        useOneDriveStore.getState().setProgress({ status: 'error' });
      }
      // Show the raw reason on the owner's own screen, but persist only a
      // sanitized category to the append-only audit log — never a raw provider
      // message that could carry a filename, account id, or token.
      void oneDriveAudit
        .logDurable('onedrive.sync', 'OneDrive sync failed.', {
          outputs: { error: sanitizeSyncError(err) },
        })
        .catch(() => {});
    } finally {
      setLocalSyncing(false);
    }
  }

  async function disconnect() {
    setError(null);
    try {
      await oneDriveCancel();
      await oneDriveDisconnect();
      setConnected(false);
      setLastReport(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      oneDriveIsConnected()
        .then(setConnected)
        .catch(() => {});
    }
  }

  async function autoLinkOneDriveFolders(): Promise<void> {
    const folders = await withOneDriveTimeout(
      oneDriveListFolders(),
      'folder discovery',
      ONEDRIVE_LIST_FOLDERS_TIMEOUT_MS
    );
    linkOneDriveClientFoldersToMatters(
      folders,
      getMatters(),
      addOneDriveFolderKey
    );
    // Give every freshly-linked (and any previously-linked) matter an on-disk
    // home so the imported files land under the right client in Documents.
    ensureOneDriveDestFolders(
      getMatters(),
      useWorkspaceStore.getState().rootPath,
      addFolderPath
    );
  }

  const syncing = localSyncing || progress?.status === 'syncing';

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">
        OneDrive and SharePoint documents
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        Imports documents from any OneDrive or SharePoint folder named after one
        of your clients. Advisor Prep Hero downloads those files into the client's
        folder on this device, so they appear in the client's Documents and become
        searchable.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        Read-only in the cloud: Advisor Prep Hero only asks Microsoft for files. It
        never edits, uploads, moves, or deletes anything in OneDrive or SharePoint.
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
          <div className="flex items-center gap-2">
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
            {connecting && (
              <button
                type="button"
                data-testid="onedrive-cancel-connect"
                onClick={cancelConnect}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 text-sm text-slate-700">
          <p className="font-medium text-green-700">Connected.</p>
          {syncing && (
            <div className="mt-1 flex items-center gap-3">
              <p>Importing... {progress?.seen ?? 0} items checked.</p>
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
          {/* Honest terminal result, driven by the returned report. A zero-file
              run says so plainly instead of a misleading "Documents imported." */}
          {!syncing && lastReport && !error && (
            <p className="mt-1">
              {lastReport.imported > 0 ? (
                <>
                  {lastReport.cancelled ? 'Stopped early — imported' : 'Imported'}{' '}
                  {lastReport.imported}{' '}
                  {lastReport.imported === 1 ? 'file' : 'files'} into your client
                  folders.
                  {lastReport.pendingPdf
                    ? ` ${String(lastReport.pendingPdf)} PDF ${lastReport.pendingPdf === 1 ? 'file is' : 'files are'} queued for the PDF fast-follow.`
                    : ''}
                </>
              ) : (
                <span className="text-slate-500">
                  No new files came in. Advisor Prep Hero imports files only from a
                  OneDrive folder named after one of your clients — checked{' '}
                  {lastReport.seen}{' '}
                  {lastReport.seen === 1 ? 'item' : 'items'}.
                </span>
              )}
            </p>
          )}
          {!syncing && progress?.status === 'cancelled' && (
            <p className="mt-1 text-slate-500">Import stopped.</p>
          )}
          {error && <p className="mt-1 text-red-700">OneDrive sync ran into a problem: {error}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={localOnly || syncing}
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

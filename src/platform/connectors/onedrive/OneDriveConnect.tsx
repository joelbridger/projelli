/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import { InfoHelp } from '@/ui/InfoHelp';
import {
  oneDriveCancel,
  oneDriveConnect,
  oneDriveConnectCancel,
  oneDriveDisconnect,
  oneDriveIsConnected,
  oneDriveListFolders,
  oneDriveSync,
  type OneDriveDisconnectResult,
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
import {
  isMicrosoftSignInExpiredError,
  MICROSOFT_SIGNIN_EXPIRED_MESSAGE,
} from '@/platform/connectors/microsoft/microsoftAuthError';
import { IntegrationHonestyCard } from '@/platform/connectors/IntegrationHonestyCard';
import type { Matter } from '@/platform/types/matter';
import { brandText } from '@/config/brandText';
import { BRAND } from '@/config/brand';

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
  // B3-parity (mirrors WealthboxConnect): disconnect didn't fully remove the
  // data/connection — keep a visible retry so the user is never stuck.
  // F4: these are two DIFFERENT conditions and must not be conflated —
  //   dataRemains        → imported files may still be on disk (mirrors
  //                        result.dataRemains ONLY), needs "Finish deleting local data".
  //   disconnectIncomplete → the data is gone but the connection wasn't fully
  //                        removed (the token couldn't be deleted), needs
  //                        "Finish disconnecting".
  const [dataRemains, setDataRemains] = useState(false);
  const [disconnectIncomplete, setDisconnectIncomplete] = useState(false);
  const [disconnectNote, setDisconnectNote] = useState<string | null>(null);
  const [finishingDelete, setFinishingDelete] = useState(false);
  // F1: true while a disconnect purge is running. Syncing is paused in the UI
  // (as it is in the backend) so a click can't start a sync that would
  // re-materialize files the disconnect is about to delete.
  const [disconnecting, setDisconnecting] = useState(false);
  // Disconnect is a two-step, user-in-control flow: clicking Disconnect opens a
  // plain-language confirmation that says imported files STAY unless the user
  // opts in to deleting them. `deleteFilesChoice` is remembered so the "Finish
  // deleting local data" retry repeats the SAME choice.
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [alsoDeleteFiles, setAlsoDeleteFiles] = useState(false);
  const [deleteFilesChoice, setDeleteFilesChoice] = useState(false);
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
      void runSync().catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
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

  // Reconnect: an expired Microsoft sign-in (scope_upgrade_required /
  // invalid_grant / refresh failed / not connected — see
  // microsoftAuthError.ts) leaves OneDrive "Connected" but every sync failing,
  // with no way out short of Disconnect + Connect again. Cancel any stuck
  // sync first, then re-run the same OAuth flow connect() already uses.
  async function reconnect() {
    try {
      await oneDriveCancel();
    } catch (err) {
      console.warn('Could not cancel OneDrive sync before reconnect; continuing reconnect:', err);
    }
    await connect();
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

  /** Best-effort re-check of the real connection state after a disconnect
   *  attempt didn't cleanly resolve — shared by both failure paths below so
   *  there is exactly one silent-catch call site to reason about. */
  function refreshConnectedState() {
    oneDriveIsConnected()
      .then(setConnected)
      .catch(() => {});
  }

  /**
   * The disconnect purge itself, shared by the confirmed Disconnect and the
   * "Finish deleting local data" retry. `deleteFiles` carries the user's opt-in
   * choice through to the backend. Idempotent — safe to run repeatedly until the
   * connection (and, if opted in, the imported files) are fully removed.
   * Mirrors WealthboxConnect's runDisconnectPurge.
   */
  async function runDisconnectPurge(deleteFiles: boolean) {
    setError(null);
    // F1: pause syncing in the UI for the whole purge.
    setDisconnecting(true);
    try {
      await oneDriveCancel();
      // A purge that removed RAG rows announces itself from the BACKEND on the
      // dedicated rag-content-invalidated event, which the citation-verification
      // cache subscribes to — platform must not import features (architecture DAG).
      const result: OneDriveDisconnectResult | null = await oneDriveDisconnect(deleteFiles);

      // Robustness: if the backend returns nothing (e.g. an inconsistent state
      // where a stale token exists but there's no connection/data to remove),
      // treat it as a clean disconnect rather than crashing on result.* reads.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- native command can return null in inconsistent states even though the generated TS type is narrower
      if (!result) {
        setDataRemains(false);
        setDisconnectIncomplete(false);
        setDisconnectNote(null);
        setConnected(false);
        setLastReport(null);
        return;
      }

      // A clean disconnect: the connection + search index were removed. When the
      // user did NOT opt in to deleting files, those files staying is expected
      // and is NOT a failure — `dataRemains` is false in that case.
      const connectionRemoved =
        !result.dataRemains && result.ragPurged && result.localDataPurged && result.tokenDeleted;

      if (connectionRemoved) {
        setDataRemains(false);
        setDisconnectIncomplete(false);
        setDisconnectNote(null);
        setConnected(false);
        setLastReport(null);
      } else {
        // F4: keep the two failure conditions SEPARATE so the copy is honest.
        // `dataRemains` mirrors the backend flag ONLY (imported files may still
        // be on disk). `disconnectIncomplete` means the data IS gone but the
        // connection wasn't fully removed (the token couldn't be deleted) — so
        // when only the token step failed we say "Finish disconnecting", not the
        // misleading "Finish deleting local data".
        setDataRemains(result.dataRemains);
        setDisconnectIncomplete(!result.tokenDeleted);
        const reason = result.dataRemains
          ? 'some imported OneDrive files could not be deleted yet'
          : 'the OneDrive connection could not be fully removed';
        const action = result.dataRemains
          ? 'Finish deleting local data'
          : 'Finish disconnecting';
        const warn = result.warnings.length > 0 ? ` (${result.warnings.join('; ')})` : '';
        setDisconnectNote(
          `Disconnect is not finished — ${reason}${warn}. Use "${action}" to try again.`
        );
        refreshConnectedState();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      refreshConnectedState();
    } finally {
      setDisconnecting(false);
    }
  }

  // Step 1 of disconnect: open the confirmation. Nothing is removed yet.
  function beginDisconnect() {
    setError(null);
    setAlsoDeleteFiles(false);
    setConfirmingDisconnect(true);
  }

  // Step 2: the user confirmed. Remember their choice (so the retry repeats it)
  // and run the purge.
  async function confirmDisconnect() {
    const deleteFiles = alsoDeleteFiles;
    setDeleteFilesChoice(deleteFiles);
    setConfirmingDisconnect(false);
    await runDisconnectPurge(deleteFiles);
  }

  async function finishDeletingLocalData() {
    setFinishingDelete(true);
    try {
      await runDisconnectPurge(deleteFilesChoice);
    } finally {
      setFinishingDelete(false);
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
      <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        OneDrive and SharePoint documents
        <InfoHelp content={brandText(`Imports documents from any OneDrive or SharePoint folder named after one of your clients. ${BRAND.name} downloads those files into the client's folder on this device, so they appear in the client's Documents and become searchable. Read-only in the cloud: ${BRAND.name} only asks Microsoft for files. It never edits, uploads, moves, or deletes anything in OneDrive or SharePoint.`)} />
      </h3>
      <IntegrationHonestyCard connectorId="onedrive-sharepoint" />
      {localOnly && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Local-only mode is on, so OneDrive sync is paused. Switch out of
          Local-only mode in Privacy settings to import documents from
          Microsoft.
        </p>
      )}

      {/* Disconnect didn't fully finish — keep a visible retry regardless of
          connection state. F4: the copy depends on WHICH step is unfinished:
          files still on disk (dataRemains) vs the connection not fully removed
          (disconnectIncomplete). */}
      {(dataRemains || disconnectIncomplete) && (
        <div
          data-testid="onedrive-data-remains"
          className="mt-3 space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3"
        >
          <p className="text-sm text-amber-900">
            {disconnectNote ??
              (dataRemains
                ? 'Some imported OneDrive data could not be deleted yet.'
                : 'The OneDrive connection could not be fully removed yet.')}
          </p>
          <button
            type="button"
            data-testid="onedrive-finish-delete"
            disabled={finishingDelete}
            onClick={() => {
              // finishDeletingLocalData handles all its own errors internally
              // (via runDisconnectPurge's try/catch) and never rejects —
              // same shape as disconnect()/connect()/syncNow() above.
              // eslint-disable-next-line lantern-async/no-silent-failure -- best-effort UI trigger; errors are surfaced via setError inside runDisconnectPurge
              void finishDeletingLocalData();
            }}
            className="rounded-md bg-[var(--kp-navy)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {finishingDelete
              ? dataRemains
                ? 'Deleting…'
                : 'Finishing…'
              : dataRemains
                ? 'Finish deleting local data'
                : 'Finish disconnecting'}
          </button>
        </div>
      )}

      {!connected ? (
        <div className="mt-3 space-y-3">
          {error && <p className="text-sm text-red-700">{error}</p>}
          {disconnectNote && !dataRemains && !disconnectIncomplete && (
            <p className="text-sm text-slate-600">{disconnectNote}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="connect-onedrive-button"
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
                  {brandText(`No new files came in. ${BRAND.name} imports files only from a OneDrive folder named after one of your clients`)}
                  {' — checked '}
                  {lastReport.seen}{' '}
                  {lastReport.seen === 1 ? 'item' : 'items'}.
                </span>
              )}
            </p>
          )}
          {!syncing && progress?.status === 'cancelled' && (
            <p className="mt-1 text-slate-500">Import stopped.</p>
          )}
          {error && (
            <p className="mt-1 text-red-700">
              {isMicrosoftSignInExpiredError(error)
                ? MICROSOFT_SIGNIN_EXPIRED_MESSAGE
                : `OneDrive sync ran into a problem: ${error}`}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              data-testid="onedrive-sync-now"
              disabled={localOnly || syncing || disconnecting}
              onClick={() => {
                void syncNow();
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {disconnecting ? 'Disconnecting...' : syncing ? 'Syncing...' : 'Sync now'}
            </button>
            {error && isMicrosoftSignInExpiredError(error) && (
              <button
                type="button"
                data-testid="onedrive-reconnect"
                disabled={connecting}
                onClick={() => {
                  void reconnect();
                }}
                className="rounded-md bg-[var(--kp-navy)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {connecting ? 'Reconnecting...' : 'Reconnect'}
              </button>
            )}
            <button
              type="button"
              data-testid="onedrive-disconnect"
              disabled={confirmingDisconnect || disconnecting}
              onClick={beginDisconnect}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Disconnect
            </button>
          </div>

          {/* Two-step, user-in-control disconnect confirmation. It states plainly
              what happens and defaults to KEEPING the files already imported into
              client folders (they're the user's documents now — possibly edited).
              Deleting them is a deliberate opt-in. */}
          {confirmingDisconnect && (
            <div
              data-testid="onedrive-disconnect-confirm-panel"
              className="mt-3 space-y-3 rounded-md border border-slate-300 bg-slate-50 p-3"
            >
              <p className="text-sm font-medium text-slate-900">
                Disconnect OneDrive?
              </p>
              <p className="text-sm text-slate-700">
                Importing stops, and the connection and search index are removed.
                Files already imported into your client folders will STAY in your
                workspace — they are your documents now.
              </p>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  data-testid="onedrive-delete-files-checkbox"
                  checked={alsoDeleteFiles}
                  onChange={(e) => {
                    setAlsoDeleteFiles(e.target.checked);
                  }}
                  className="mt-0.5"
                />
                <span>Also delete the files imported from OneDrive.</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="onedrive-disconnect-confirm"
                  onClick={() => {
                    void confirmDisconnect();
                  }}
                  className="rounded-md bg-[var(--kp-navy)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                >
                  Disconnect
                </button>
                <button
                  type="button"
                  data-testid="onedrive-disconnect-cancel"
                  onClick={() => {
                    setConfirmingDisconnect(false);
                  }}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Keep connected
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

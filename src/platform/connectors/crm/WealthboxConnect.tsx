/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@tauri-apps/api/core';
import { InfoHelp } from '@/ui/InfoHelp';
import {
  crmConnect,
  crmIsConnected,
  crmDisconnect,
  crmListHouseholds,
  crmSyncAll,
  crmCancelSync,
  createCrmRunId,
  type CrmConnectInfo,
  type CrmDisconnectResult,
} from '@/platform/utils/wealthbox-commands';
import { useCrmSync } from '@/platform/connectors/crm/useCrmSync';
import { useCrmStore } from '@/platform/connectors/crm/crmStore';
import {
  CRM_LIST_HOUSEHOLDS_TIMEOUT_MS,
  CrmCancelledError,
  CrmTimeoutError,
  createCrmCancelGate,
  withCrmTimeout,
} from '@/platform/connectors/crm/crmTimeout';
import { getMatters } from '@/platform/matter/matterStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  attachCrmHouseholdFolderIfUnmapped,
  buildClaimedCrmFolderSet,
} from '@/platform/matter/crmMatterFolderBackfill';
import { IntegrationHonestyCard } from '@/platform/connectors/IntegrationHonestyCard';
import { WealthboxCustomFieldsAvailability } from '@/platform/connectors/wealthbox/WealthboxCustomFieldsAvailability';
import {
  buildCrmMatterMap,
  filterCrmMatterMapForProvider,
  resolveMatterForHousehold,
} from '@/platform/rag/matterResolver';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { brandText } from '@/config/brandText';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { usePrivilegedMatterModeActive } from '@/platform/hooks/usePrivilegedMatterMode';
import { useNativeNetworkLockdownBridgeState } from '@/platform/privacy/nativeNetworkLockdownBridge';

function isCrmNetworkLockdownError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'NETWORK_LOCKDOWN_BLOCKED'
  );
}

export function WealthboxConnect() {
  const { t } = useTranslation();
  useCrmSync();
  const privacyChoiceLocksNetwork = usePrivilegedMatterModeActive();
  const nativeLockdown = useNativeNetworkLockdownBridgeState();
  const networkLockdown =
    privacyChoiceLocksNetwork || (isTauri() && nativeLockdown.blocked);
  const lockdownMessage =
    nativeLockdown.error && !privacyChoiceLocksNetwork
      ? t('crm.wealthbox.lockdown.update-failed')
      : nativeLockdown.pending && !privacyChoiceLocksNetwork
        ? t('crm.wealthbox.lockdown.pending')
        : t('crm.wealthbox.lockdown.active');

  const progress = useCrmStore((s) => s.progress);

  const [connected, setConnected] = useState(false);
  const [connectedInfo, setConnectedInfo] = useState<CrmConnectInfo | null>(
    null
  );
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // A confirmation is a user decision, not background work. Keeping it separate
  // prevents an unanswered Import/Cancel question from masquerading as a sync.
  const [awaitingImportConfirmation, setAwaitingImportConfirmation] = useState(false);
  // True only while a Wealthbox NETWORK call (household list / backend sync)
  // is actually in flight — NOT while the confirm-import dialog is waiting on
  // the user, which is an unbounded, user-controlled pause, not a stall.
  // Drives the 20s "taking longer than usual" watchdog below, since these are
  // exactly the two calls the backend can hold for a long time on a
  // sustained 429 (client.rs retries with exponential backoff up to 64s).
  const [networkBusy, setNetworkBusy] = useState(false);
  const [syncStalled, setSyncStalled] = useState(false);
  // Real cancellation for the household-list phase only: crm_cancel_sync sets
  // a backend flag that engine::backfill polls between households during
  // crm_sync_all, but crm_list_households has no cancellation awareness at
  // all (a single paginated GET loop, no access to that flag) — so without
  // this, clicking Stop during that phase was a no-op. Set right before
  // racing the household-list call, cleared right after (see crmTimeout.ts).
  const cancelHouseholdListRef = useRef<(() => void) | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncReport, setLastSyncReport] = useState<{
    householdsProcessed: number;
    recordsIndexed: number;
  } | null>(null);
  const [indexingRetryCount, setIndexingRetryCount] = useState<number | null>(null);
  // Post-disconnect status note — honest about what was actually deleted.
  const [disconnectNote, setDisconnectNote] = useState<string | null>(null);
  // B3: true when disconnect could not fully remove imported data (or the key).
  // While true we keep a visible "Finish deleting local data" retry action and do
  // NOT scrub the local CRM mapping, so the user can complete the deletion.
  const [dataRemains, setDataRemains] = useState(false);
  const [finishingDelete, setFinishingDelete] = useState(false);

  const createMatter = useMatterStore((s) => s.createMatter);
  const addCrmHouseholdKey = useMatterStore((s) => s.addCrmHouseholdKey);
  const setMatterArchived = useMatterStore((s) => s.setMatterArchived);

  // Shared confirm dialog (sync + disconnect flows are mutually exclusive so
  // one instance is sufficient).
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  // Check connection on mount.
  useEffect(() => {
    crmIsConnected()
      .then(setConnected)
      .catch(() => {});
  }, []);

  // Mirror progress into syncing flag.
  useEffect(() => {
    // While the Import/Cancel question is open, no run is active — a late
    // "connecting" event from the finished household check must not repaint
    // the syncing state over the open question.
    if (awaitingImportConfirmation) return;
    if (
      progress?.status === 'connecting' ||
      progress?.status === 'syncing' ||
      progress?.status === 'stopping'
    ) {
      setSyncing(true);
    } else if (
      progress?.status === 'done' ||
      progress?.status === 'error' ||
      progress?.status === 'cancelled'
    ) {
      // All three are terminal — a cancelled run must release the UI too, or the
      // Stop button leaves it stuck on "Syncing…" with Disconnect disabled.
      setSyncing(false);
    }
  }, [progress?.status, awaitingImportConfirmation]);

  // Connect/sync stall watchdog: while a Wealthbox network call is genuinely
  // in flight with no progress to show, reassure the user after ~20s instead
  // of leaving the static "Connecting.../Syncing..." label looking frozen.
  // Resets on every progress tick (a slow-but-advancing sync never warns).
  useEffect(() => {
    if (!networkBusy) {
      setSyncStalled(false);
      return;
    }
    setSyncStalled(false);
    const timer = setTimeout(() => { setSyncStalled(true); }, 20_000);
    return () => { clearTimeout(timer); };
  }, [networkBusy, progress?.households, progress?.records]);

  async function connect() {
    const trimmed = token.trim();
    if (!trimmed) {
      setConnectError('Please paste your Wealthbox API key first.');
      return;
    }
    setConnecting(true);
    setConnectError(null);
    setDisconnectNote(null);
    try {
      const info = await crmConnect(trimmed);
      setConnectedInfo(info);
      setConnected(true);
      setToken('');
      // Connect = IMPORT: kick off the household sync immediately, the same way
      // Microsoft/Gmail/OneDrive start importing right after auth. runSync()
      // fetches the household list, confirms the local-storage import, creates
      // the matters, and drives the setup-progress bars. Without this, "Connect"
      // only stored the API key and never imported anything (Cluster-3 finding).
      void runSync();
    } catch (err) {
      setConnectError(
        isCrmNetworkLockdownError(err)
          ? lockdownMessage
          : t('crm.wealthbox.connect-failed')
      );
    } finally {
      setConnecting(false);
    }
  }

  async function runSync() {
    setSyncError(null);
    setLastSyncReport(null);
    setIndexingRetryCount(null);
    setSyncing(true);
    setAwaitingImportConfirmation(false);
    const runId = createCrmRunId();
    useCrmStore.getState().startRun(runId);

    // B2: track the matter mutations we stage in Step 3 so a failure IN STEP 3
    // ITSELF (before anything is confirmed as imported) can be rolled back —
    // otherwise a sync that errors while still resolving households leaves
    // phantom Wealthbox-linked clients in local state. This must NOT cover a
    // Step 4 (backend sync) failure — see the nested try below (QA-74).
    const createdMatterIds: string[] = [];
    const linkedKeys: Array<{ matterId: string; key: string }> = [];
    const attachedFolders: Array<{ matterId: string; folderPath: string }> = [];

    try {
      // Step 1: Fetch the household list.
      // Clicking "Sync now" is the user's consent to read the list from Wealthbox.
      // No local data is written until the user confirms in Step 2.
      // Bounded by a frontend timeout (crmTimeout.ts): the Rust client retries a
      // 429 with backoff up to 64s per attempt, so a sustained rate limit can
      // otherwise hold this await for minutes with no way to fail cleanly. Also
      // raced against a real cancel gate: crm_list_households has no
      // cancellation awareness on the backend, so Stop must give up the wait
      // itself rather than rely on a flag Rust will never check here.
      setNetworkBusy(true);
      let households;
      const cancelGate = createCrmCancelGate('household list');
      cancelHouseholdListRef.current = cancelGate.cancel;
      try {
        households = await cancelGate.race(
          withCrmTimeout(
            crmListHouseholds(runId),
            'household list',
            CRM_LIST_HOUSEHOLDS_TIMEOUT_MS
          )
        );
      } finally {
        cancelHouseholdListRef.current = null;
        setNetworkBusy(false);
      }

      if (households.length === 0) {
        setSyncError('Your Wealthbox account has no households to import.');
        return;
      }

      // Step 2: Show the confirm dialog with the real count so the user knows
      // exactly how many records will be written to local encrypted storage.
      const count = households.length;
      // Nothing is running while this question is open. This must be visible in
      // the connector itself as well as in the raised confirmation dialog.
      setSyncing(false);
      setAwaitingImportConfirmation(true);
      const confirmed = await confirm(
        brandText(`Import ${String(count)} household${count === 1 ? '' : 's'} into local encrypted storage on this device? Lantern stores this data locally — it stays on your machine.`),
        {
          title: `Import ${String(count)} Wealthbox household${count === 1 ? '' : 's'}`,
          confirmLabel: 'Import',
          cancelLabel: 'Cancel',
        }
      );
      setAwaitingImportConfirmation(false);
      if (!confirmed) return;

      // Step 3: Resolve each household to a matter — merge by name so existing
      // file-clients are not duplicated. `claimedMatterIds` prevents two
      // households from linking to the same matter in a single sync pass.
      const currentMatters = getMatters();
      const claimedMatterIds = new Set<string>();
      const claimedFolders = buildClaimedCrmFolderSet();
      for (const household of households) {
        const resolution = resolveMatterForHousehold(
          currentMatters,
          household,
          claimedMatterIds
        );
        let matterId = resolution.matterId;
        if (resolution.action === 'link') {
          // Merge: attach this Wealthbox household to the matching file-client.
          addCrmHouseholdKey(matterId, household.id);
          linkedKeys.push({ matterId, key: household.id });
          claimedMatterIds.add(matterId);
          // QA-74 (independent review, second code path): resolveMatterForHousehold
          // searches ALL matters, including archived ones, so a household whose name
          // uniquely matches an ARCHIVED file-client links to it here rather than
          // via the 'reuse' branch below. Same fix applies: un-archive it so the
          // Client Map shows it, or the sync reports success with an invisible client.
          const existingLinked = currentMatters.find((m) => m.id === matterId);
          if (existingLinked?.archived) setMatterArchived(matterId, false);
        } else if (resolution.action === 'create') {
          // No matching file-client — create a fresh matter for this household.
          // Mark it createdFromCrm so a later disconnect can scrub its imported name.
          const created = createMatter({
            name: household.name,
            client: household.name,
            crmHouseholdKeys: [household.id],
            createdFromCrm: true,
          });
          createdMatterIds.push(created.id);
          matterId = created.id;
        } else {
          // action === 'reuse'. QA-74: this household was already linked to an existing matter — by
          // a prior sync, or a disconnect that couldn't fully purge its mapping.
          // If that matter was archived since, it must reappear on the Client
          // Map now rather than staying permanently hidden while the sync
          // otherwise reports full success (an advisor would never learn their
          // data has nowhere visible to land).
          const existing = currentMatters.find((m) => m.id === matterId);
          if (existing?.archived) setMatterArchived(matterId, false);
        }
        if (matterId) {
          const folderPath = attachCrmHouseholdFolderIfUnmapped(
            matterId,
            household,
            claimedFolders
          );
          if (folderPath) attachedFolders.push({ matterId, folderPath });
        }
      }

      // Step 4: Build the household → matter map from the updated store and
      // kick off the backend sync — best-effort. The Client Map population
      // above is ALREADY COMMITTED local state: the user just confirmed
      // importing `count` households and they now exist as real matters. A
      // failure here (a transient Wealthbox API hiccup, RAG indexing error,
      // etc.) must never undo that — it only means search indexing/audit may
      // be incomplete, so it's reported honestly instead of rolled back
      // (QA-74: a full-batch rollback over one indexing hiccup was silently
      // erasing every Client Map entry the advisor had just confirmed, with
      // the connector still showing "Connected").
      setNetworkBusy(true);
      try {
        const map = filterCrmMatterMapForProvider(
          buildCrmMatterMap(getMatters()),
          'wealthbox'
        );
        // Rust owns the ten-minute timeout for the full import.  It requests a
        // safe stop and waits for its current network/embedding work to exit
        // before this promise settles, keeping Retry disabled until it is safe.
        setSyncing(true);
        const report = await crmSyncAll(map, runId);
        setLastSyncReport({
          householdsProcessed: report.householdsProcessed,
          recordsIndexed: report.recordsIndexed,
        });
        setIndexingRetryCount(null);
      } catch (err) {
        setIndexingRetryCount(count);
        setSyncError(
          isCrmNetworkLockdownError(err)
            ? lockdownMessage
            : t('crm.wealthbox.indexing-incomplete', { count })
        );
      } finally {
        setNetworkBusy(false);
      }
    } catch (err) {
      // The user clicked Stop during the household-list phase — an
      // intentional exit, not a failure. Nothing is staged yet at this point
      // (cancellation can only fire before Step 3 creates/links anything), so
      // there is nothing to roll back. No backend crm-sync-progress event is
      // coming for this frontend-only cancel (crm_list_households never
      // observes the cancel flag), so set the terminal state directly here —
      // mirrors OneDriveConnect's own folder-discovery-phase cancel handling.
      if (err instanceof CrmCancelledError) {
        useCrmStore.getState().setProgress({ runId, status: 'cancelled' });
        return;
      }
      // B2 rollback: Steps 1-3 failed before anything was confirmed as
      // imported — undo whatever was staged so a failed household fetch or
      // matter-resolution bug never leaves phantom Wealthbox-linked clients
      // behind. Does NOT run for a Step 4 failure (see the nested try above).
      if (
        createdMatterIds.length > 0 ||
        linkedKeys.length > 0 ||
        attachedFolders.length > 0
      ) {
        const { deleteMatter, removeCrmHouseholdKey, removeFolderPath } =
          useMatterStore.getState();
        for (const { matterId, folderPath } of attachedFolders)
          removeFolderPath(matterId, folderPath);
        for (const id of createdMatterIds) deleteMatter(id);
        for (const { matterId, key } of linkedKeys)
          removeCrmHouseholdKey(matterId, key);
      }
      // A CrmTimeoutError means the sync genuinely stalled past a sane
      // ceiling (see crmTimeout.ts) — surface that plainly rather than the
      // technical "timed out after Nms" message.
      setSyncError(
        err instanceof CrmTimeoutError
          ? t('crm.wealthbox.sync-timeout')
          : isCrmNetworkLockdownError(err)
            ? lockdownMessage
            : t('crm.wealthbox.sync-failed')
      );
    } finally {
      setAwaitingImportConfirmation(false);
      setSyncing(false);
      setNetworkBusy(false);
      useCrmStore.getState().finishRun(runId);
    }
  }

  async function retryIndexing() {
    if (indexingRetryCount === null) return;
    const count = indexingRetryCount;
    const runId = createCrmRunId();
    setSyncError(null);
    setLastSyncReport(null);
    setSyncing(true);
    setNetworkBusy(true);
    useCrmStore.getState().startRun(runId);
    try {
      const map = filterCrmMatterMapForProvider(
        buildCrmMatterMap(getMatters()),
        'wealthbox'
      );
      const report = await crmSyncAll(map, runId);
      setLastSyncReport({
        householdsProcessed: report.householdsProcessed,
        recordsIndexed: report.recordsIndexed,
      });
      setIndexingRetryCount(null);
    } catch (err) {
      setSyncError(
        isCrmNetworkLockdownError(err)
          ? lockdownMessage
          : t('crm.wealthbox.indexing-incomplete', { count })
      );
    } finally {
      setSyncing(false);
      setNetworkBusy(false);
      useCrmStore.getState().finishRun(runId);
    }
  }

  async function disconnect() {
    // Confirm before disconnecting: honest about data deletion.
    const confirmed = await confirm(
      'Disconnect Wealthbox? This removes your Wealthbox key from this device and deletes the imported Wealthbox households and client data from local storage. Your own files and other matters are not affected.',
      {
        title: 'Disconnect and delete imported data',
        confirmLabel: 'Disconnect and delete',
        cancelLabel: 'Cancel',
        variant: 'destructive',
      }
    );
    if (!confirmed) return;
    await runDisconnectPurge();
  }

  /**
   * The disconnect purge itself (no confirm dialog), shared by the Disconnect
   * button and the "Finish deleting local data" retry. Idempotent — safe to run
   * repeatedly until the data and key are fully removed.
   */
  async function runDisconnectPurge() {
    try {
      await crmCancelSync();
    } catch {
      /* best-effort */
    }
    setConnectError(null);
    setSyncError(null);
    try {
      const result: CrmDisconnectResult = await crmDisconnect();

      // `dataRemains` is authoritative when the backend provides it; older
      // backends omit it, so derive it from the purge booleans as a fallback.
      const remains =
        result.dataRemains ?? !(result.ragPurged && result.crmDbPurged);
      const dataDeleted = !remains && result.ragPurged && result.crmDbPurged;

      // B3 safety: scrub the local CRM matter mappings ONLY after deletion is
      // CONFIRMED. If data remains (no workspace / purge failed), keep the mapping
      // so we never end up "still connected, data on disk, mapping gone".
      if (dataDeleted) {
        // B1: delete pure-CRM matters, scrub imported name/client on mixed matters,
        // unlink linked matters, and clear their at-a-glance cache.
        useMatterStore.getState().scrubWealthboxFromMatters();
      }

      const warn =
        result.warnings.length > 0 ? ` (${result.warnings.join('; ')})` : '';
      if (dataDeleted && result.tokenDeleted) {
        setDataRemains(false);
        setDisconnectNote(
          'Disconnected and deleted the imported Wealthbox data from this device.'
        );
        setConnected(false);
        setConnectedInfo(null);
        setLastSyncReport(null);
      } else {
        // Either the key could not be removed or imported data still remains.
        // Keep a visible retry; re-check the real connection state.
        setDataRemains(true);
        const reason = !result.tokenDeleted
          ? 'the Wealthbox key could not be removed'
          : 'some imported Wealthbox data could not be deleted yet';
        setDisconnectNote(
          `Disconnect is not finished — ${reason}${warn}. Use “Finish deleting local data” to try again.`
        );
        crmIsConnected()
          .then(setConnected)
          .catch(() => {});
      }
    } catch (err) {
      setConnectError(
        isCrmNetworkLockdownError(err)
          ? lockdownMessage
          : t('crm.wealthbox.disconnect-failed')
      );
      crmIsConnected()
        .then(setConnected)
        .catch(() => {});
    }
  }

  async function finishDeletingLocalData() {
    setFinishingDelete(true);
    try {
      await runDisconnectPurge();
    } finally {
      setFinishingDelete(false);
    }
  }

  function stopSync() {
    // Real effect during Step 4 (crm_sync_all polls this flag between
    // households). During the Step 1 household-list phase this backend call
    // is a no-op (see cancelHouseholdListRef above), so also fire the local
    // cancel gate — null there once Step 1 is over, so this is a no-op then.
    crmCancelSync().catch(() => {});
    cancelHouseholdListRef.current?.();
  }

  // Non-Tauri: show a disabled placeholder.
  if (!isTauri()) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
          Wealthbox
          <InfoHelp content={brandText('Connect your Wealthbox account to bring client household data into your Client Maps. Requires the Lantern desktop app.')} />
        </h3>
        <IntegrationHonestyCard connectorId="wealthbox" />
        <WealthboxCustomFieldsAvailability />

        {networkLockdown && (
          <div
            data-testid="wealthbox-network-lockdown-message"
            role="status"
            className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          >
            <p className="font-medium">{t('crm.wealthbox.lockdown.title')}</p>
            <p className="mt-1 text-xs">
              {lockdownMessage}
            </p>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400 italic">
          Available in the desktop app only.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
          Wealthbox
          <InfoHelp content={brandText('Connect your Wealthbox account to bring client household data into your Client Maps. Lantern imports what this Wealthbox login can see.')} />
        </h3>
        <IntegrationHonestyCard connectorId="wealthbox" />
        <WealthboxCustomFieldsAvailability />

        {/* B3: disconnect didn't fully remove the data/key — keep a visible retry
            regardless of connection state, so the user is never stuck with data
            on disk and no way to finish removing it. */}
        {networkLockdown && (
          <div
            data-testid="wealthbox-network-lockdown-message"
            role="status"
            className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          >
            <p className="font-medium">{t('crm.wealthbox.lockdown.title')}</p>
            <p className="mt-1 text-xs">
              {lockdownMessage}
            </p>
          </div>
        )}

        {dataRemains && (
          <div
            data-testid="wealthbox-data-remains"
            className="mt-3 space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3"
          >
            <p className="text-sm text-amber-900">
              {disconnectNote ??
                'Some imported Wealthbox data could not be deleted yet.'}
            </p>
            <button
              type="button"
              data-testid="wealthbox-finish-delete"
              disabled={finishingDelete}
              onClick={() => void finishDeletingLocalData()}
              className="rounded-md bg-[var(--kp-navy)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {finishingDelete ? 'Deleting…' : 'Finish deleting local data'}
            </button>
          </div>
        )}

        {!connected && (
          <div className="mt-3 space-y-3">
            {disconnectNote && !dataRemains && (
              <p className="text-sm text-slate-600">{disconnectNote}</p>
            )}

            <p className="text-xs text-slate-500">
              Paste your Wealthbox API key below. You can find it in Wealthbox
              under Settings &gt; API Access.
            </p>

            <input
              type="password"
              data-testid="wealthbox-api-key-input"
              value={token}
              disabled={networkLockdown}
              onChange={(e) => {
                setToken(e.target.value);
              }}
              placeholder="Wealthbox API key"
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void connect();
              }}
            />

            {connectError && (
              <p className="text-sm text-red-700">{connectError}</p>
            )}

            <button
              type="button"
              data-testid="connect-wealthbox-button"
              disabled={connecting || networkLockdown}
              onClick={() => void connect()}
              className="rounded-md bg-[var(--kp-navy)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {connecting ? 'Connecting...' : 'Connect Wealthbox'}
            </button>
          </div>
        )}

        {connected && (
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            {!syncError && <p className="font-medium text-green-700">
              Connected
              {connectedInfo
                ? ` to ${connectedInfo.name}${connectedInfo.plan ? ` (${connectedInfo.plan})` : ''}`
                : ''}
              .
            </p>}

            {/* Stop must stay visible for the WHOLE sync, including the
                household-list phase BEFORE any crm-sync-progress event
                arrives — gating on progress.status alone left the user with
                no way out while that first network call was in flight. */}
            {syncing && (
              <div className="flex items-center gap-3">
                <p>
                  {progress?.status === 'stopping' ? (
                    progress.message ?? 'Stopping safely…'
                  ) : progress?.status === 'syncing' ? (
                    <>
                      Syncing...
                      {progress.households !== undefined &&
                        ` ${String(progress.households)} households`}
                      {progress.records !== undefined &&
                        `, ${String(progress.records)} records`}
                    </>
                  ) : (
                    'Checking your Wealthbox households…'
                  )}
                </p>
                <button
                  type="button"
                  onClick={stopSync}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Stop
                </button>
              </div>
            )}

            {awaitingImportConfirmation && (
              <div
                data-testid="wealthbox-awaiting-import-confirmation"
                className="rounded-md border border-blue-300 bg-blue-50 p-3 text-blue-950"
                role="status"
              >
                <p className="font-medium">Choose Import or Cancel</p>
                <p className="mt-1 text-xs">
                  Wealthbox checking is finished. Nothing is syncing until you choose.
                </p>
              </div>
            )}

            {syncStalled && (
              <p
                data-testid="wealthbox-stalled"
                className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1"
              >
                Wealthbox is taking longer than usual — still trying…
              </p>
            )}

            {!syncing && progress?.status === 'done' && lastSyncReport && (
              <p className="text-slate-600">
                Sync complete:{' '}
                {lastSyncReport.householdsProcessed.toLocaleString()}{' '}
                households, {lastSyncReport.recordsIndexed.toLocaleString()}{' '}
                records indexed.
              </p>
            )}
            {!syncing && progress?.status === 'done' && !lastSyncReport && (
              <p className="text-slate-600">Sync complete.</p>
            )}
            {!syncing && progress?.status === 'cancelled' && (
              <p className="text-slate-600">
                Sync stopped.
                {lastSyncReport &&
                  ` ${lastSyncReport.householdsProcessed.toLocaleString()} households imported before stopping.`}
              </p>
            )}
            {progress?.status === 'error' && !syncError && (
              <p className="text-red-700">
                Sync ran into a problem. Try again.
              </p>
            )}
            {syncError && <p className="text-red-700">{syncError}</p>}
            {connectError && <p className="text-red-700">{connectError}</p>}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                data-testid="wealthbox-sync-now"
                disabled={syncing || awaitingImportConfirmation || networkLockdown}
                onClick={() => void (indexingRetryCount === null ? runSync() : retryIndexing())}
                className="rounded-md bg-[var(--kp-navy)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {syncing ? 'Syncing...' : awaitingImportConfirmation ? 'Choose Import or Cancel' : 'Sync now'}
              </button>
              <button
                type="button"
                data-testid="wealthbox-disconnect"
                disabled={syncing || awaitingImportConfirmation}
                onClick={() => void disconnect()}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Disconnect and delete imported data
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Shared confirm dialog for sync import and disconnect flows. */}
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}

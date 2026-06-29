/* eslint-disable keepance-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  crmConnect,
  crmIsConnected,
  crmDisconnect,
  crmListHouseholds,
  crmSyncAll,
  crmCancelSync,
  type CrmConnectInfo,
  type CrmDisconnectResult,
} from '@/platform/utils/wealthbox-commands';
import { useCrmSync } from '@/features/crm/useCrmSync';
import { useCrmStore } from '@/features/crm/crmStore';
import { getMatters } from '@/platform/matter/matterStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  attachCrmHouseholdFolderIfUnmapped,
  buildClaimedCrmFolderSet,
} from '@/platform/matter/crmMatterFolderBackfill';
import {
  buildCrmMatterMap,
  filterCrmMatterMapForProvider,
  resolveMatterForHousehold,
} from '@/platform/rag/matterResolver';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/ui/ConfirmDialog';

export function WealthboxConnect() {
  useCrmSync();

  const progress = useCrmStore((s) => s.progress);

  const [connected, setConnected] = useState(false);
  const [connectedInfo, setConnectedInfo] = useState<CrmConnectInfo | null>(
    null
  );
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncReport, setLastSyncReport] = useState<{
    householdsProcessed: number;
    recordsIndexed: number;
  } | null>(null);
  // Post-disconnect status note — honest about what was actually deleted.
  const [disconnectNote, setDisconnectNote] = useState<string | null>(null);
  // B3: true when disconnect could not fully remove imported data (or the key).
  // While true we keep a visible "Finish deleting local data" retry action and do
  // NOT scrub the local CRM mapping, so the user can complete the deletion.
  const [dataRemains, setDataRemains] = useState(false);
  const [finishingDelete, setFinishingDelete] = useState(false);

  const createMatter = useMatterStore((s) => s.createMatter);
  const addCrmHouseholdKey = useMatterStore((s) => s.addCrmHouseholdKey);

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
    if (progress?.status === 'syncing') {
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
  }, [progress?.status]);

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
    } catch (err) {
      setConnectError(
        typeof err === 'string'
          ? err
          : err instanceof Error
            ? err.message
            : 'Could not connect. Check your API key and try again.'
      );
    } finally {
      setConnecting(false);
    }
  }

  async function runSync() {
    setSyncError(null);
    setLastSyncReport(null);
    setSyncing(true);

    // B2: track the matter mutations we stage in Step 3 so a FAILED backend sync
    // (Step 4) can be rolled back — otherwise a sync that errors leaves phantom
    // Wealthbox-linked clients in local state.
    const createdMatterIds: string[] = [];
    const linkedKeys: Array<{ matterId: string; key: string }> = [];
    const attachedFolders: Array<{ matterId: string; folderPath: string }> = [];

    try {
      // Step 1: Fetch the household list.
      // Clicking "Sync now" is the user's consent to read the list from Wealthbox.
      // No local data is written until the user confirms in Step 2.
      const households = await crmListHouseholds();

      if (households.length === 0) {
        setSyncError('Your Wealthbox account has no households to import.');
        return;
      }

      // Step 2: Show the confirm dialog with the real count so the user knows
      // exactly how many records will be written to local encrypted storage.
      const count = households.length;
      const confirmed = await confirm(
        `Import ${String(count)} household${count === 1 ? '' : 's'} into local encrypted storage on this device? Keepance stores this data locally — it stays on your machine.`,
        {
          title: `Import ${String(count)} Wealthbox household${count === 1 ? '' : 's'}`,
          confirmLabel: 'Import',
          cancelLabel: 'Cancel',
        }
      );
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
        }
        // 'reuse': already linked — buildCrmMatterMap picks it up automatically.
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
      // kick off the backend sync.
      const map = filterCrmMatterMapForProvider(
        buildCrmMatterMap(getMatters()),
        'wealthbox'
      );
      const report = await crmSyncAll(map);
      setLastSyncReport({
        householdsProcessed: report.householdsProcessed,
        recordsIndexed: report.recordsIndexed,
      });
    } catch (err) {
      // B2 rollback: undo the staged matter changes so a failed sync leaves no
      // phantom Wealthbox-linked clients behind.
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
      setSyncError(
        typeof err === 'string'
          ? err
          : err instanceof Error
            ? err.message
            : 'Sync could not complete. Please try again.'
      );
    } finally {
      setSyncing(false);
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
        typeof err === 'string'
          ? err
          : err instanceof Error
            ? err.message
            : 'Could not disconnect. Please try again.'
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
    crmCancelSync().catch(() => {});
  }

  // Non-Tauri: show a disabled placeholder.
  if (!isTauri()) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Wealthbox</h3>
        <p className="mt-1 text-sm text-slate-600">
          Connect your Wealthbox account to bring client household data into
          your Client Maps. Requires the Keepance desktop app.
        </p>
        <p className="mt-3 text-xs text-slate-400 italic">
          Available in the desktop app only.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Wealthbox</h3>
        <p className="mt-1 text-sm text-slate-600">
          Connect your Wealthbox account to bring client household data into
          your Client Maps. Keepance imports what this Wealthbox login can see.
        </p>

        {/* B3: disconnect didn't fully remove the data/key — keep a visible retry
            regardless of connection state, so the user is never stuck with data
            on disk and no way to finish removing it. */}
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
              value={token}
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
              disabled={connecting}
              onClick={() => void connect()}
              className="rounded-md bg-[var(--kp-navy)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {connecting ? 'Connecting...' : 'Connect Wealthbox'}
            </button>
          </div>
        )}

        {connected && (
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <p className="font-medium text-green-700">
              Connected
              {connectedInfo
                ? ` to ${connectedInfo.name}${connectedInfo.plan ? ` (${connectedInfo.plan})` : ''}`
                : ''}
              .
            </p>

            {syncing && progress?.status === 'syncing' && (
              <div className="flex items-center gap-3">
                <p>
                  Syncing...
                  {progress.households !== undefined &&
                    ` ${String(progress.households)} households`}
                  {progress.records !== undefined &&
                    `, ${String(progress.records)} records`}
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
            {progress?.status === 'error' && (
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
                disabled={syncing}
                onClick={() => void runSync()}
                className="rounded-md bg-[var(--kp-navy)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {syncing ? 'Syncing...' : 'Sync now'}
              </button>
              <button
                type="button"
                data-testid="wealthbox-disconnect"
                disabled={syncing}
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

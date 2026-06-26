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
import { buildCrmMatterMap } from '@/platform/rag/matterResolver';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/ui/ConfirmDialog';

export function WealthboxConnect() {
  useCrmSync();

  const progress = useCrmStore((s) => s.progress);

  const [connected, setConnected] = useState(false);
  const [connectedInfo, setConnectedInfo] = useState<CrmConnectInfo | null>(null);
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncReport, setLastSyncReport] = useState<{ householdsProcessed: number; recordsIndexed: number } | null>(null);
  // Post-disconnect status note — honest about what was actually deleted.
  const [disconnectNote, setDisconnectNote] = useState<string | null>(null);

  const createMatter = useMatterStore((s) => s.createMatter);

  // Shared confirm dialog (sync + disconnect flows are mutually exclusive so
  // one instance is sufficient).
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  // Check connection on mount.
  useEffect(() => {
    crmIsConnected().then(setConnected).catch(() => {});
  }, []);

  // Mirror progress into syncing flag.
  useEffect(() => {
    if (progress?.status === 'syncing') {
      setSyncing(true);
    } else if (progress?.status === 'done' || progress?.status === 'error') {
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
        typeof err === 'string' ? err : err instanceof Error ? err.message : 'Could not connect. Check your API key and try again.',
      );
    } finally {
      setConnecting(false);
    }
  }

  async function runSync() {
    setSyncError(null);
    setLastSyncReport(null);

    // Fix #4: confirm BEFORE any Wealthbox API request. The household count
    // is not known yet — it appears in the sync progress once the backend
    // starts importing. This keeps the pre-confirm dialog honest.
    const confirmed = await confirm(
      'Import your Wealthbox households? Keepance will fetch your household list directly from Wealthbox and create one local, encrypted client record for each.',
      {
        title: 'Import Wealthbox households',
        confirmLabel: 'Import',
        cancelLabel: 'Cancel',
      },
    );
    if (!confirmed) return;

    setSyncing(true);
    try {
      // 1. Fetch after confirm — no network request happens before here.
      const households = await crmListHouseholds();

      // 2. For each household, find or create a matching matter.
      const currentMatters = getMatters();
      for (const household of households) {
        const existing = currentMatters.find((m) =>
          (m.crmHouseholdKeys ?? []).includes(household.id),
        );
        if (!existing) {
          createMatter({
            name: household.name,
            client: household.name,
            crmHouseholdKeys: [household.id],
          });
        }
      }

      // 3. Build the map from the now-updated store.
      const map = buildCrmMatterMap(getMatters());

      // 4. Run the sync.
      const report = await crmSyncAll(map);
      setLastSyncReport({ householdsProcessed: report.householdsProcessed, recordsIndexed: report.recordsIndexed });
    } catch (err) {
      setSyncError(
        typeof err === 'string' ? err : err instanceof Error ? err.message : 'Sync could not complete. Please try again.',
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
      },
    );
    if (!confirmed) return;

    try { await crmCancelSync(); } catch { /* best-effort */ }
    setConnectError(null);
    setSyncError(null);
    try {
      // Fix #2-UI: consume the structured result so the message is honest.
      const result: CrmDisconnectResult = await crmDisconnect();

      // Clean up auto-created CRM matters:
      //   - Matters with NO user-added folders and NO user-added mail folders are
      //     pure-Wealthbox records; delete them entirely.
      //   - Matters with user content keep their files; just unlink the Wealthbox
      //     household keys so they are no longer associated with Wealthbox.
      const matters = getMatters();
      const { deleteMatter, removeCrmHouseholdKey } = useMatterStore.getState();
      for (const matter of matters) {
        const keys = matter.crmHouseholdKeys ?? [];
        if (keys.length === 0) continue;
        const hasFolders = matter.folderPaths.length > 0;
        const hasMail = (matter.mailFolderPaths ?? []).length > 0;
        if (!hasFolders && !hasMail) {
          deleteMatter(matter.id);
        } else {
          for (const key of keys) {
            removeCrmHouseholdKey(matter.id, key);
          }
        }
      }

      // Fix #2-UI: claim deletion only when it actually happened.
      if (result.ragPurged && result.crmDbPurged) {
        setDisconnectNote('Disconnected and deleted the imported Wealthbox data from this device.');
      } else {
        const detail =
          result.warnings.length > 0
            ? result.warnings.join('; ')
            : 'Some imported data could not be deleted.';
        setDisconnectNote(
          `Disconnected and removed the key, but some imported data could not be deleted: ${detail} Open the workspace and disconnect again to finish removing it.`,
        );
      }

      setConnected(false);
      setConnectedInfo(null);
      setLastSyncReport(null);
    } catch (err) {
      setConnectError(
        typeof err === 'string' ? err : err instanceof Error ? err.message : 'Could not disconnect. Please try again.',
      );
      crmIsConnected().then(setConnected).catch(() => {});
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
          Connect your Wealthbox account to bring client household data into your Client Maps. Requires the Keepance desktop app.
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
          Connect your Wealthbox account to bring client household data into your Client Maps. Keepance imports what this Wealthbox login can see.
        </p>

        {!connected && (
          <div className="mt-3 space-y-3">
            {disconnectNote && (
              <p className="text-sm text-slate-600">{disconnectNote}</p>
            )}

            <p className="text-xs text-slate-500">
              Paste your Wealthbox API key below. You can find it in Wealthbox under Settings &gt; API Access.
            </p>

            <input
              type="password"
              value={token}
              onChange={(e) => { setToken(e.target.value); }}
              placeholder="Wealthbox API key"
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              autoComplete="off"
              onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
            />

            {connectError && (
              <p className="text-sm text-red-700">{connectError}</p>
            )}

            <button
              type="button"
              disabled={connecting}
              onClick={() => void connect()}
              className="rounded-md bg-[#0A2540] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {connecting ? 'Connecting...' : 'Connect Wealthbox'}
            </button>
          </div>
        )}

        {connected && (
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <p className="font-medium text-green-700">
              Connected
              {connectedInfo ? ` to ${connectedInfo.name}${connectedInfo.plan ? ` (${connectedInfo.plan})` : ''}` : ''}.
            </p>

            {syncing && progress?.status === 'syncing' && (
              <div className="flex items-center gap-3">
                <p>
                  Syncing...
                  {progress.households !== undefined && ` ${String(progress.households)} households`}
                  {progress.records !== undefined && `, ${String(progress.records)} records`}
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
                Sync complete: {lastSyncReport.householdsProcessed.toLocaleString()} households, {lastSyncReport.recordsIndexed.toLocaleString()} records indexed.
              </p>
            )}
            {!syncing && progress?.status === 'done' && !lastSyncReport && (
              <p className="text-slate-600">Sync complete.</p>
            )}
            {progress?.status === 'error' && (
              <p className="text-red-700">Sync ran into a problem. Try again.</p>
            )}
            {syncError && (
              <p className="text-red-700">{syncError}</p>
            )}
            {connectError && (
              <p className="text-red-700">{connectError}</p>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                data-testid="wealthbox-sync-now"
                disabled={syncing}
                onClick={() => void runSync()}
                className="rounded-md bg-[#0A2540] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
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

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@tauri-apps/api/core';
import {
  crmConnectWithCredentials,
  crmIsConnected,
  crmDisconnect,
  crmListHouseholds,
  crmSyncAll,
  crmCancelSync,
  createCrmRunId,
  type CrmConnectInfo,
  type CrmDisconnectResult,
} from '@/platform/utils/wealthbox-commands';
import { rebuildConnectedCrmImports } from '@/platform/connectors/crm/crmRecovery';
import {
  isCrmStoreRecoveryError,
  CRM_STORE_RECOVERY_MESSAGE,
} from '@/platform/connectors/crm/crmRecoveryError';
import { useCrmSync } from '@/platform/connectors/crm/useCrmSync';
import { useCrmStore } from '@/platform/connectors/crm/crmStore';
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
import { InfoHelp } from '@/ui/InfoHelp';
import { brandText } from '@/config/brandText';
import { useNativeNetworkLockdownBridgeState } from '@/platform/privacy/nativeNetworkLockdownBridge';
import { NetworkLockdownRetryButton } from '@/platform/privacy/ui/NetworkLockdownRetryButton';

const PROVIDER = 'redtail' as const;
const REDTAIL_KEY_PREFIX = 'redtail:';

function scrubRedtailFromMatters() {
  const { deleteMatter, removeCrmHouseholdKey } = useMatterStore.getState();
  for (const matter of getMatters()) {
    const redtailKeys = (matter.crmHouseholdKeys ?? []).filter((key) =>
      key.startsWith(REDTAIL_KEY_PREFIX),
    );
    if (redtailKeys.length === 0) continue;
    const nonRedtailKeys = (matter.crmHouseholdKeys ?? []).filter((key) =>
      !key.startsWith(REDTAIL_KEY_PREFIX),
    );
    if (matter.createdFromCrm && nonRedtailKeys.length === 0 && matter.folderPaths.length === 0) {
      deleteMatter(matter.id);
    } else {
      for (const key of redtailKeys) removeCrmHouseholdKey(matter.id, key);
    }
  }
}

export function RedtailConnect() {
  const { t } = useTranslation();
  useCrmSync();
  const nativeLockdown = useNativeNetworkLockdownBridgeState();
  const networkLockdown = isTauri() && nativeLockdown.blocked;
  const lockdownMessage =
    nativeLockdown.error
      ? nativeLockdown.error
      : nativeLockdown.pending
        ? 'Privacy protection is updating. Redtail stays paused until it finishes.'
        : nativeLockdown.status === 'unknown'
          ? 'Lantern could not confirm the desktop privacy guard. Redtail stays paused until its state can be checked.'
          : 'Nothing will be sent to or downloaded from Redtail while this is on. Turn it off in Privacy settings to connect or sync.';

  const progress = useCrmStore((s) => s.progress);
  const [connected, setConnected] = useState(false);
  const [connectedInfo, setConnectedInfo] = useState<CrmConnectInfo | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [lastSyncReport, setLastSyncReport] = useState<{ householdsProcessed: number; recordsIndexed: number } | null>(null);
  const [disconnectNote, setDisconnectNote] = useState<string | null>(null);

  const createMatter = useMatterStore((s) => s.createMatter);
  const addCrmHouseholdKey = useMatterStore((s) => s.addCrmHouseholdKey);
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  useEffect(() => {
    crmIsConnected(PROVIDER).then(setConnected).catch(() => {});
  }, []);

  useEffect(() => {
    if (progress?.status === 'syncing') {
      setSyncing(true);
    } else if (
      progress?.status === 'done' ||
      progress?.status === 'error' ||
      progress?.status === 'cancelled'
    ) {
      setSyncing(false);
    }
  }, [progress?.status]);

  async function connect() {
    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      setConnectError('Enter your Redtail username and password first.');
      return;
    }
    setConnecting(true);
    setConnectError(null);
    setDisconnectNote(null);
    try {
      const info = await crmConnectWithCredentials(PROVIDER, trimmedUsername, password);
      setConnectedInfo(info);
      setConnected(true);
      setPassword('');
    } catch (err) {
      setConnectError(
        typeof err === 'string' ? err : err instanceof Error ? err.message : 'Could not connect to Redtail. Check the login and try again.',
      );
    } finally {
      setConnecting(false);
    }
  }

  async function runSync() {
    setSyncError(null);
    setLastSyncReport(null);
    setSyncing(true);
    const runId = createCrmRunId();
    useCrmStore.getState().startRun(runId);

    const createdMatterIds: string[] = [];
    const linkedKeys: Array<{ matterId: string; key: string }> = [];
    const attachedFolders: Array<{ matterId: string; folderPath: string }> = [];

    try {
      const households = await crmListHouseholds(runId, PROVIDER);
      if (households.length === 0) {
        setSyncError('This Redtail login did not return any families to import.');
        return;
      }

      const count = households.length;
      const confirmed = await confirm(
        brandText(`Import ${String(count)} Redtail famil${count === 1 ? 'y' : 'ies'} into local encrypted storage on this device? Lantern imports only the contacts, notes, and activities this login can read.`),
        {
          title: `Import ${String(count)} Redtail famil${count === 1 ? 'y' : 'ies'}`,
          confirmLabel: 'Import',
          cancelLabel: 'Cancel',
        },
      );
      if (!confirmed) return;

      const currentMatters = getMatters();
      const claimedMatterIds = new Set<string>();
      const claimedFolders = buildClaimedCrmFolderSet();
      for (const household of households) {
        const resolution = resolveMatterForHousehold(currentMatters, household, claimedMatterIds);
        let matterId = resolution.matterId;
        if (resolution.action === 'link') {
          addCrmHouseholdKey(matterId, household.id);
          linkedKeys.push({ matterId, key: household.id });
          claimedMatterIds.add(matterId);
        } else if (resolution.action === 'create') {
          const created = createMatter({
            name: household.name,
            client: household.name,
            crmHouseholdKeys: [household.id],
            createdFromCrm: true,
          });
          createdMatterIds.push(created.id);
          matterId = created.id;
        }
        if (matterId) {
          const folderPath = attachCrmHouseholdFolderIfUnmapped(
            matterId,
            household,
            claimedFolders,
          );
          if (folderPath) attachedFolders.push({ matterId, folderPath });
        }
      }

      const map = filterCrmMatterMapForProvider(buildCrmMatterMap(getMatters()), PROVIDER);
      const report = await crmSyncAll(map, runId, PROVIDER);
      setLastSyncReport({
        householdsProcessed: report.householdsProcessed,
        recordsIndexed: report.recordsIndexed,
      });
    } catch (err) {
      const recoveryError = isCrmStoreRecoveryError(err);
      if (!recoveryError && (createdMatterIds.length > 0 || linkedKeys.length > 0 || attachedFolders.length > 0)) {
        const { deleteMatter, removeCrmHouseholdKey, removeFolderPath } = useMatterStore.getState();
        for (const { matterId, folderPath } of attachedFolders) removeFolderPath(matterId, folderPath);
        for (const id of createdMatterIds) deleteMatter(id);
        for (const { matterId, key } of linkedKeys) removeCrmHouseholdKey(matterId, key);
      }
      setSyncError(
        recoveryError
          ? CRM_STORE_RECOVERY_MESSAGE
          : typeof err === 'string'
            ? err
            : err instanceof Error
              ? err.message
              : 'Redtail sync could not complete. Please try again.',
      );
      setRecoveryRequired(recoveryError);
    } finally {
      setSyncing(false);
      useCrmStore.getState().finishRun(runId);
    }
  }

  async function rebuildCrmImports() {
    const confirmed = await confirm(
      'Rebuild the local CRM copy? The unreadable copy will be replaced, then every connected CRM account will be synced again. Your own files are not affected.',
      {
        title: 'Rebuild saved CRM records',
        confirmLabel: 'Rebuild CRM imports',
        cancelLabel: 'Cancel',
        variant: 'destructive',
      },
    );
    if (!confirmed) return;
    setRecovering(true);
    setSyncError(null);
    try {
      await rebuildConnectedCrmImports();
      setRecoveryRequired(false);
    } catch (err) {
      setRecoveryRequired(isCrmStoreRecoveryError(err));
      setSyncError(
        typeof err === 'string'
          ? err
          : err instanceof Error
            ? err.message
            : 'The local CRM copy could not be rebuilt. Please try again.',
      );
    } finally {
      setRecovering(false);
    }
  }

  async function disconnect() {
    const confirmed = await confirm(
      'Disconnect Redtail? This removes the Redtail UserKey from this device and deletes locally imported Redtail CRM search data. Your own files and other CRM imports are not affected.',
      {
        title: 'Disconnect Redtail',
        confirmLabel: 'Disconnect',
        cancelLabel: 'Cancel',
        variant: 'destructive',
      },
    );
    if (!confirmed) return;
    try { await crmCancelSync(PROVIDER); } catch { /* best-effort */ }
    try {
      const result: CrmDisconnectResult = await crmDisconnect(PROVIDER);
      const remains = result.dataRemains;
      if (!remains && result.tokenDeleted) {
        scrubRedtailFromMatters();
        setConnected(false);
        setConnectedInfo(null);
        setLastSyncReport(null);
        setDisconnectNote('Disconnected Redtail and deleted imported CRM data from this device.');
      } else {
        const warn = result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : '';
        setDisconnectNote(`Disconnect is not finished yet.${warn}`);
        crmIsConnected(PROVIDER).then(setConnected).catch(() => {});
      }
    } catch (err) {
      setConnectError(
        typeof err === 'string' ? err : err instanceof Error ? err.message : 'Could not disconnect Redtail. Please try again.',
      );
      crmIsConnected(PROVIDER).then(setConnected).catch(() => {});
    }
  }

  function stopSync() {
    crmCancelSync(PROVIDER).catch(() => {});
  }

  if (!isTauri()) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
          Redtail CRM
          <InfoHelp content={brandText('Connect Redtail CRM to bring families, contacts, notes, and activities into Client Maps. Requires the Lantern desktop app.')} />
        </h3>
      </section>
    );
  }

  return (
    <>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
          Redtail CRM
          <InfoHelp content={brandText('Read-only import for Redtail families, contacts, notes, and activities. Your password is used once to get a Redtail UserKey; Lantern stores the UserKey, not the password.')} />
        </h3>

        {networkLockdown && (
          <div
            data-testid="redtail-network-lockdown-message"
            role="status"
            className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          >
            <p className="font-medium">{t('crm.redtail.lockdown.title')}</p>
            <p className="mt-1 text-xs">{lockdownMessage}</p>
            <NetworkLockdownRetryButton testId="redtail-network-lockdown-retry" />
          </div>
        )}

        {!connected && (
          <div className="mt-3 space-y-3">
            {disconnectNote && <p className="text-sm text-slate-600">{disconnectNote}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={username}
                disabled={networkLockdown}
                onChange={(e) => { setUsername(e.target.value); }}
                placeholder="Redtail username"
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                autoComplete="username"
              />
              <input
                type="password"
                value={password}
                disabled={networkLockdown}
                onChange={(e) => { setPassword(e.target.value); }}
                placeholder="Redtail password"
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                autoComplete="current-password"
                onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
              />
            </div>
            <p className="text-xs text-slate-500">
              {brandText('The vendor API key comes from Lantern configuration. If it is missing, Redtail will not connect yet.')}
            </p>
            <button
              type="button"
              disabled={connecting || networkLockdown}
              onClick={() => void connect()}
              className="rounded-md bg-[var(--kp-navy)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {connecting ? 'Connecting...' : 'Connect Redtail'}
            </button>
            {connectError && <p className="text-sm text-red-700">{connectError}</p>}
          </div>
        )}

        {connected && (
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <p className="font-medium text-green-700">
              Connected
              {connectedInfo?.name ? ` to ${connectedInfo.name}` : ''}.
            </p>

            {syncing && progress?.status === 'syncing' && (
              <div className="flex items-center gap-3">
                <p>
                  Syncing...
                  {progress.households !== undefined && ` ${String(progress.households)} families`}
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
                Sync complete: {lastSyncReport.householdsProcessed.toLocaleString()} families, {lastSyncReport.recordsIndexed.toLocaleString()} records indexed.
              </p>
            )}
            {!syncing && progress?.status === 'cancelled' && <p className="text-slate-600">Sync stopped.</p>}
            {syncError && <p className={recoveryRequired ? 'text-amber-800' : 'text-red-700'}>{syncError}</p>}
            {recoveryRequired && (
              <button
                type="button"
                data-testid="redtail-rebuild-store"
                disabled={recovering || syncing}
                onClick={() => {
                  rebuildCrmImports().catch(() => {
                    setSyncError('The recovery question could not be opened. Please try again.');
                  });
                }}
                className="rounded-md bg-[var(--kp-navy)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {recovering ? 'Rebuilding…' : 'Rebuild CRM imports'}
              </button>
            )}
            {connectError && <p className="text-red-700">{connectError}</p>}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                data-testid="redtail-sync-now"
                disabled={syncing || networkLockdown}
                onClick={() => void runSync()}
                className="rounded-md bg-[var(--kp-navy)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {syncing ? 'Syncing...' : 'Sync now'}
              </button>
              <button
                type="button"
                data-testid="redtail-disconnect"
                disabled={syncing}
                onClick={() => void disconnect()}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}
      </section>
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}

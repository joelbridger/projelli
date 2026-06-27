/* eslint-disable keepance-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  calendlyCancelSync,
  calendlyConnect,
  calendlyDisconnect,
  calendlyIsConnected,
  calendlySyncAll,
  type CalendlyConnectInfo,
} from '@/platform/utils/calendly-commands';
import { useCalendlySync } from '@/features/calendly/useCalendlySync';
import { useCalendlyStore } from '@/features/calendly/calendlyStore';
import { getMatters } from '@/platform/matter/matterStore';
import { buildMeetingMatterMap } from '@/platform/rag/matterResolver';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/ui/ConfirmDialog';

export function CalendlyConnect() {
  useCalendlySync();
  const progress = useCalendlyStore((s) => s.progress);
  const [connected, setConnected] = useState(false);
  const [connectedInfo, setConnectedInfo] = useState<CalendlyConnectInfo | null>(null);
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncReport, setLastSyncReport] = useState<{ meetingsIndexed: number; recordsIndexed: number } | null>(null);
  const [disconnectNote, setDisconnectNote] = useState<string | null>(null);
  const { confirm, dialogProps } = useConfirmDialog();

  useEffect(() => {
    calendlyIsConnected().then(setConnected).catch(() => {});
  }, []);

  useEffect(() => {
    if (progress?.status === 'syncing') setSyncing(true);
    if (progress?.status === 'done' || progress?.status === 'error' || progress?.status === 'cancelled') {
      setSyncing(false);
    }
  }, [progress?.status]);

  async function connect() {
    const trimmed = token.trim();
    if (!trimmed) {
      setConnectError('Please paste your Calendly personal access token first.');
      return;
    }
    setConnecting(true);
    setConnectError(null);
    try {
      const info = await calendlyConnect(trimmed);
      setConnectedInfo(info);
      setConnected(true);
      setToken('');
    } catch (err) {
      setConnectError(typeof err === 'string' ? err : err instanceof Error ? err.message : 'Could not connect. Check your token and try again.');
    } finally {
      setConnecting(false);
    }
  }

  async function runSync() {
    setSyncError(null);
    setLastSyncReport(null);
    const confirmed = await confirm(
      'Import Calendly meetings and invitee intake answers into local encrypted storage on this device?',
      { title: 'Import Calendly meetings', confirmLabel: 'Import', cancelLabel: 'Cancel' },
    );
    if (!confirmed) return;
    setSyncing(true);
    try {
      const report = await calendlySyncAll(buildMeetingMatterMap(getMatters()));
      setLastSyncReport({ meetingsIndexed: report.meetingsIndexed, recordsIndexed: report.recordsIndexed });
    } catch (err) {
      setSyncError(typeof err === 'string' ? err : err instanceof Error ? err.message : 'Calendly sync could not complete. Please try again.');
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    const confirmed = await confirm(
      'Disconnect Calendly? This removes your Calendly token from this device and deletes imported Calendly meeting data from local storage.',
      {
        title: 'Disconnect and delete imported data',
        confirmLabel: 'Disconnect and delete',
        cancelLabel: 'Cancel',
        variant: 'destructive',
      },
    );
    if (!confirmed) return;
    try { await calendlyCancelSync(); } catch { /* best effort */ }
    try {
      const result = await calendlyDisconnect();
      const remains = result.dataRemains ?? !(result.ragPurged && result.calendlyDbPurged);
      if (!remains && result.tokenDeleted) {
        setConnected(false);
        setConnectedInfo(null);
        setLastSyncReport(null);
        setDisconnectNote('Disconnected and deleted imported Calendly data from this device.');
      } else {
        setDisconnectNote(`Disconnect is not finished. ${result.warnings.join(' ') || 'Try again after the current sync stops.'}`);
        calendlyIsConnected().then(setConnected).catch(() => {});
      }
    } catch (err) {
      setConnectError(typeof err === 'string' ? err : err instanceof Error ? err.message : 'Could not disconnect. Please try again.');
    }
  }

  if (!isTauri()) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Calendly</h3>
        <p className="mt-1 text-sm text-slate-600">
          Import scheduled meetings and invitee intake answers into matter memory. Requires the Keepance desktop app.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Calendly</h3>
        <p className="mt-1 text-sm text-slate-600">
          Import scheduled events and invitee Q&A as read-only meeting memory. Keepance uses GET requests only.
        </p>
        {!connected && (
          <div className="mt-3 space-y-3">
            {disconnectNote && <p className="text-sm text-slate-600">{disconnectNote}</p>}
            <p className="text-xs text-slate-500">
              Paste a Calendly personal access token from Integrations &gt; API &amp; Webhooks.
            </p>
            <input
              type="password"
              value={token}
              onChange={(e) => { setToken(e.target.value); }}
              placeholder="Calendly personal access token"
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              autoComplete="off"
              onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
            />
            {connectError && <p className="text-sm text-red-600">{connectError}</p>}
            <button
              type="button"
              onClick={() => void connect()}
              disabled={connecting}
              className="rounded-md bg-[#0A2540] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {connecting ? 'Connecting...' : 'Connect Calendly'}
            </button>
          </div>
        )}
        {connected && (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-slate-700">
              Connected{connectedInfo?.email ? ` as ${connectedInfo.email}` : ''}.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runSync()}
                disabled={syncing}
                className="rounded-md bg-[#0A2540] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {syncing ? 'Syncing...' : 'Sync meetings'}
              </button>
              {syncing && (
                <button
                  type="button"
                  onClick={() => { void calendlyCancelSync(); }}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Stop
                </button>
              )}
              <button
                type="button"
                onClick={() => void disconnect()}
                disabled={syncing}
                className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                Disconnect
              </button>
            </div>
            {progress?.status === 'syncing' && (
              <p className="text-xs text-slate-500">
                Indexed {progress.meetings ?? 0} meeting{(progress.meetings ?? 0) === 1 ? '' : 's'} so far.
              </p>
            )}
            {lastSyncReport && (
              <p className="text-xs text-slate-500">
                Last sync indexed {lastSyncReport.meetingsIndexed} meeting{lastSyncReport.meetingsIndexed === 1 ? '' : 's'} into {lastSyncReport.recordsIndexed} search chunk{lastSyncReport.recordsIndexed === 1 ? '' : 's'}.
              </p>
            )}
            {syncError && <p className="text-sm text-red-600">{syncError}</p>}
          </div>
        )}
      </section>
      <ConfirmDialog {...dialogProps} />
    </>
  );
}

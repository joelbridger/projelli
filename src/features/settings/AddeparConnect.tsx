/* eslint-disable keepance-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Landmark } from 'lucide-react';
import {
  ADDEPAR_SYNC_EVENT,
  addeparCancel,
  addeparConnect,
  addeparDisconnect,
  addeparIsConnected,
  addeparListEntities,
  addeparSync,
  type AddeparConnectInfo,
  type AddeparEntityDto,
  type AddeparSyncProgress,
  type AddeparSyncReport,
} from '@/platform/utils/addepar-commands';
import { getMatters, useMatterStore } from '@/platform/matter/matterStore';
import {
  buildAddeparMatterMap,
  normalizeClientName,
} from '@/platform/rag/matterResolver';
import { Button } from '@/ui/kp';

export function AddeparConnect() {
  const [connected, setConnected] = useState(false);
  const [info, setInfo] = useState<AddeparConnectInfo | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [firmId, setFirmId] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AddeparSyncReport | null>(null);
  const [linkedCount, setLinkedCount] = useState(0);
  const [unmatched, setUnmatched] = useState<AddeparEntityDto[]>([]);
  const [progress, setProgress] = useState<AddeparSyncProgress | null>(null);

  const addAddeparKey = useMatterStore((s) => s.addAddeparKey);

  useEffect(() => {
    addeparIsConnected().then(setConnected).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<AddeparSyncProgress>(ADDEPAR_SYNC_EVENT, (event) => {
      setProgress(event.payload);
    });
    return () => {
      void unlisten.then((fn) => { fn(); });
    };
  }, []);

  useEffect(() => {
    if (progress?.status === 'syncing') setSyncing(true);
    if (progress && progress.status !== 'syncing') setSyncing(false);
  }, [progress]);

  async function connect() {
    setError(null);
    const fields = [apiKey, apiSecret, subdomain, firmId].map((v) => v.trim());
    if (fields.some((v) => !v)) {
      setError('API key, API secret, firm subdomain, and firm id are required.');
      return;
    }
    setBusy(true);
    try {
      const connectedInfo = await addeparConnect(
        apiKey.trim(),
        apiSecret.trim(),
        subdomain.trim(),
        firmId.trim(),
      );
      setInfo(connectedInfo);
      setConnected(true);
      setApiKey('');
      setApiSecret('');
      setSubdomain('');
      setFirmId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setError(null);
    setReport(null);
    setLinkedCount(0);
    setUnmatched([]);
    setSyncing(true);
    try {
      const entities = await addeparListEntities();
      const matched = linkExactHouseholdMatches(entities, addAddeparKey);
      setLinkedCount(matched.linked);
      setUnmatched(matched.unmatched);
      const result = await addeparSync(buildAddeparMatterMap(getMatters()));
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
      await addeparCancel();
      const result = await addeparDisconnect();
      if (result.dataRemains) {
        setError(result.warnings.join('; ') || 'Disconnect is not finished. Some local Addepar data may remain.');
      } else {
        setConnected(false);
        setInfo(null);
        setReport(null);
        setLinkedCount(0);
        setUnmatched([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!isTauri()) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Addepar</h3>
        <p className="mt-1 text-xs text-slate-500">Addepar sync is available in the desktop app.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-slate-100 p-2 text-slate-600">
            <Landmark className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Addepar</h3>
            <p className="mt-1 max-w-xl text-xs text-slate-500">
              Import household holdings, asset allocation, accounts, and performance summaries. Keepance only reads Addepar data.
            </p>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {info && (
        <p className="mt-3 text-xs text-slate-500">
          Firm: <span className="font-medium text-slate-700">{info.subdomain}</span>
          {' '}({info.firmId})
        </p>
      )}

      {!connected ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <AddeparInput label="API key" value={apiKey} onChange={setApiKey} secret />
          <AddeparInput label="API secret" value={apiSecret} onChange={setApiSecret} secret />
          <AddeparInput label="Firm subdomain" value={subdomain} onChange={setSubdomain} placeholder="examplefirm" />
          <AddeparInput label="Firm id" value={firmId} onChange={setFirmId} placeholder="1" />
          <div className="sm:col-span-2">
            <Button size="sm" onClick={() => { void connect(); }} disabled={busy}>
              {busy ? 'Connecting...' : 'Connect Addepar'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => { void syncNow(); }} disabled={syncing || busy}>
            {syncing ? 'Syncing...' : 'Sync households'}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { void addeparCancel(); }} disabled={!syncing}>
            Stop
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { void disconnect(); }} disabled={busy || syncing}>
            Disconnect
          </Button>
        </div>
      )}

      {report && (
        <p className="mt-3 text-xs text-slate-600">
          Found {report.entitiesFetched} households, linked {linkedCount} by exact client name, indexed {report.recordsIndexed} records, and left {report.needsAssignment} needing assignment.
        </p>
      )}
      {unmatched.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-medium text-amber-900">Needs assignment</p>
          <ul className="mt-1 space-y-1 text-xs text-amber-800">
            {unmatched.slice(0, 3).map((item) => (
              <li key={item.id}>{item.name || item.id}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </section>
  );
}

function AddeparInput({
  label,
  value,
  onChange,
  placeholder,
  secret = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  secret?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <input
        type={secret ? 'password' : 'text'}
        value={value}
        placeholder={placeholder}
        onChange={(event) => { onChange(event.target.value); }}
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        autoComplete="off"
      />
    </label>
  );
}

function linkExactHouseholdMatches(
  entities: AddeparEntityDto[],
  addAddeparKey: (matterId: string, key: string) => void,
): { linked: number; unmatched: AddeparEntityDto[] } {
  let linked = 0;
  const unmatched: AddeparEntityDto[] = [];
  const claimedMatterIds = new Set<string>();

  for (const entity of entities) {
    const matters = getMatters();
    const alreadyLinked = matters.find((m) => (m.addeparKeys ?? []).includes(entity.id));
    if (alreadyLinked) continue;

    const normalizedName = normalizeClientName(entity.name);
    const matches = normalizedName
      ? matters.filter(
          (m) =>
            normalizeClientName(m.name) === normalizedName ||
            normalizeClientName(m.client) === normalizedName,
        )
      : [];

    if (matches.length === 1) {
      const match = matches[0];
      if (match && (match.addeparKeys ?? []).length === 0 && !claimedMatterIds.has(match.id)) {
        addAddeparKey(match.id, entity.id);
        claimedMatterIds.add(match.id);
        linked += 1;
        continue;
      }
    }
    unmatched.push(entity);
  }

  return { linked, unmatched };
}

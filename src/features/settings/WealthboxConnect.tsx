import { useEffect, useMemo, useState } from 'react';
import {
  wealthboxConnect,
  wealthboxDisconnect,
  wealthboxIsConnected,
  wealthboxListContacts,
  wealthboxSync,
  type WealthboxContactSummary,
  type WealthboxSyncSummary,
} from '@/platform/utils/wealthbox-commands';
import { useMatterStore, useMatters } from '@/platform/matter/matterStore';
import { buildWealthboxMatterMappings } from '@/platform/wealthbox/wealthboxMatterSync';

function errorMessage(err: unknown, fallback: string): string {
  return typeof err === 'string' ? err : err instanceof Error ? err.message : fallback;
}

export function WealthboxConnect() {
  const matters = useMatters();
  const createMatter = useMatterStore((state) => state.createMatter);
  const [connected, setConnected] = useState(false);
  const [token, setToken] = useState('');
  const [contacts, setContacts] = useState<WealthboxContactSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [connecting, setConnecting] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  useEffect(() => {
    wealthboxIsConnected()
      .then(setConnected)
      .catch(() => {});
  }, []);

  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selected.has(contact.id)),
    [contacts, selected],
  );

  async function connect() {
    setConnecting(true);
    setError(null);
    setMessage(null);
    try {
      await wealthboxConnect(token);
      setConnected(true);
      setToken('');
      setMessage('Connected to Wealthbox.');
    } catch (err) {
      setError(errorMessage(err, 'Could not connect to Wealthbox. Check the token and try again.'));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setError(null);
    setMessage(null);
    try {
      await wealthboxDisconnect();
    } catch {
      // Best-effort disconnect. The UI should still stop showing the account.
    }
    setConnected(false);
    setContacts([]);
    setSelected(new Set());
    setLastSynced(null);
  }

  async function loadContacts() {
    setLoadingContacts(true);
    setError(null);
    setMessage(null);
    try {
      const list = await wealthboxListContacts();
      setContacts(list);
      setSelected(new Set(list.map((contact) => contact.id)));
      setMessage(list.length ? `Loaded ${list.length} Wealthbox contacts.` : 'No Wealthbox contacts found.');
    } catch (err) {
      setError(errorMessage(err, 'Could not load Wealthbox contacts.'));
    } finally {
      setLoadingContacts(false);
    }
  }

  async function syncSelected() {
    if (selectedContacts.length === 0) {
      setError('Choose at least one Wealthbox contact or household to import.');
      return;
    }
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const plans = buildWealthboxMatterMappings(selectedContacts, matters, createMatter);
      const summaries = await wealthboxSync(plans.map((plan) => plan.mapping));
      const failed = summaries.filter((summary) => summary.error);
      const counts = totalCounts(summaries);
      if (failed.length > 0) {
        setError(failed.map((summary) => summary.error).filter(Boolean).join(' '));
      } else {
        setMessage(
          `Synced ${summaries.length} Wealthbox records into ${plans.length} matters. Indexed ${counts.items} items and ${counts.chunks} chunks.`,
        );
        setLastSynced(new Date().toLocaleString());
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not sync Wealthbox.'));
    } finally {
      setSyncing(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Wealthbox CRM</h3>
          <p className="mt-1 text-sm text-slate-600">
            Pull clients, notes, tasks, and events into local Memory. Your token stays in this device's keychain, and CRM content is indexed on this machine.
          </p>
        </div>
        {connected && (
          <span className="rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700">
            Connected
          </span>
        )}
      </div>

      {!connected && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="wealthbox-token" className="text-xs font-medium text-slate-700">
              Personal access token
            </label>
            <input
              id="wealthbox-token"
              type="password"
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
              }}
              required
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="Paste your Wealthbox token"
            />
          </div>
          <button
            type="submit"
            disabled={connecting}
            className="rounded-md bg-[#0A2540] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      )}

      {connected && (
        <div className="mt-3 space-y-3 text-sm text-slate-700">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadContacts()}
              disabled={loadingContacts || syncing}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {loadingContacts ? 'Loading...' : 'Load contacts'}
            </button>
            <button
              type="button"
              onClick={() => void syncSelected()}
              disabled={syncing || selectedContacts.length === 0}
              className="rounded-md bg-[#0A2540] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {syncing ? 'Syncing...' : `Sync selected (${selectedContacts.length})`}
            </button>
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={syncing}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Disconnect
            </button>
          </div>

          {contacts.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-md border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium text-slate-700">Choose contacts and households</p>
                <button
                  type="button"
                  className="text-xs font-medium text-slate-700 underline"
                  onClick={() => {
                    setSelected(
                      selected.size === contacts.length
                        ? new Set()
                        : new Set(contacts.map((contact) => contact.id)),
                    );
                  }}
                >
                  {selected.size === contacts.length ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <ul className="divide-y divide-slate-100">
                {contacts.map((contact) => (
                  <li key={contact.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      id={`wealthbox-contact-${contact.id}`}
                      type="checkbox"
                      checked={selected.has(contact.id)}
                      onChange={() => {
                        toggleSelected(contact.id);
                      }}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <label htmlFor={`wealthbox-contact-${contact.id}`} className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {contact.name}
                      </span>
                      <span className="text-xs capitalize text-slate-500">{contact.type}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {lastSynced && <p className="text-xs text-slate-500">Last synced: {lastSynced}</p>}
        </div>
      )}

      {message && (
        <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">{message}</div>
      )}
      {error && (
        <div className="mt-3 rounded-md bg-red-50 p-3 text-sm font-medium text-red-700">{error}</div>
      )}
    </section>
  );
}

function totalCounts(summaries: WealthboxSyncSummary[]): { items: number; chunks: number } {
  return summaries.reduce(
    (acc, summary) => ({
      items: acc.items + summary.contactsIndexed + summary.notesIndexed + summary.tasksIndexed + summary.eventsIndexed,
      chunks: acc.chunks + summary.chunksIndexed,
    }),
    { items: 0, chunks: 0 },
  );
}

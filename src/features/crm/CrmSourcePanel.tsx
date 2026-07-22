/* eslint-disable lantern-i18n/no-hardcoded-string */
/**
 * CrmSourcePanel — v1 citation viewer for Wealthbox `crm:` source links.
 *
 * When the user clicks a `crm:` citation in a Client Map, `dispatchOpenSource`
 * fires a `lantern:open-crm` window CustomEvent with `{ sourceId, snippet? }`.
 * This component listens for that event and opens the exact decrypted local
 * record when this seat has access to it.
 */
import { useEffect, useState } from 'react';
import { X, Database } from 'lucide-react';
import { EV_OPEN_CRM } from '@/config/identity';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { loadVisibleCrmRecordsForViewer } from '@/platform/crm/useLiveCrmRecords';
import { useFirmStore } from '@/platform/firm/firmStore';

interface CrmSourceState {
  sourceId: string;
  snippet: string | undefined;
}

export function CrmSourcePanel() {
  const [source, setSource] = useState<CrmSourceState | null>(null);
  const [record, setRecord] = useState<LiveCrmRecord | null>(null);
  const workspaceRoot = useWorkspaceStore((state) => state.rootPath);
  const viewerId = useFirmStore((state) => state.session?.userId ?? null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sourceId?: string; snippet?: string } | null>).detail;
      const sourceId = detail?.sourceId;
      if (!sourceId) return;
      setRecord(null);
      setSource({ sourceId, snippet: detail.snippet });
    };
    window.addEventListener(EV_OPEN_CRM, handler);
    return () => { window.removeEventListener(EV_OPEN_CRM, handler); };
  }, []);

  useEffect(() => {
    if (!source || !workspaceRoot) return;
    const parts = source.sourceId.split(':');
    const entityId = parts.length >= 3 ? parts.slice(2).join(':') : null;
    if (!entityId) return;
    let cancelled = false;
    void loadVisibleCrmRecordsForViewer(workspaceRoot, viewerId)
      .then((records) => {
        if (!cancelled) setRecord(records.find((item) => item.id === entityId) ?? null);
      })
      .catch(() => {
        if (!cancelled) setRecord(null);
      });
    return () => { cancelled = true; };
  }, [source, viewerId, workspaceRoot]);

  if (!source) return null;

  // Parse a readable label from the sourceId (e.g. "crm:household:abc123" -> "household abc123").
  function sourceLabelFromId(id: string): string {
    const parts = id.split(':');
    if (parts.length >= 3) {
      return `${parts[1] ?? 'record'} ${parts.slice(2).join(':')}`;
    }
    return id.replace('crm:', '');
  }

  return (
    <div
      role="dialog"
      aria-label="Wealthbox record"
      className="fixed bottom-6 right-6 z-50 w-80 rounded-lg border border-slate-200 bg-white shadow-lg"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Database className="h-4 w-4 text-slate-500" aria-hidden="true" />
          CRM record
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => { setSource(null); }}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="space-y-3 px-4 py-3">
        <p className="text-xs text-slate-500">
          Source: <span className="font-mono text-slate-700">{sourceLabelFromId(source.sourceId)}</span>
        </p>

        {source.snippet && (
          <blockquote className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700 italic">
            {source.snippet.length > 300
              ? `${source.snippet.slice(0, 300)}...`
              : source.snippet}
          </blockquote>
        )}

        {record ? (
          <pre data-testid="crm-citation-record" className="max-h-72 overflow-auto rounded-md bg-slate-50 p-3 text-xs text-slate-700">
            {JSON.stringify(record, null, 2)}
          </pre>
        ) : (
          <p className="text-xs text-slate-400">
            This record is not available to this seat.
          </p>
        )}
      </div>
    </div>
  );
}

/* eslint-disable keepance-i18n/no-hardcoded-string */
/**
 * CrmSourcePanel — v1 citation viewer for Wealthbox `crm:` source links.
 *
 * When the user clicks a `crm:` citation in a Client Map, `dispatchOpenSource`
 * fires a `keepance:open-crm` window CustomEvent with `{ sourceId, snippet? }`.
 * This component listens for that event and shows a lightweight read-only panel
 * with the Wealthbox record id and the cited snippet.
 *
 * TODO(crm-viewer): replace the static display with a live fetch from
 * `crm_get_record(sourceId)` so the panel shows the full stored record text.
 */
import { useEffect, useState } from 'react';
import { X, Database } from 'lucide-react';
import { OPEN_CRM_EVENT } from '@/platform/clientMap/openSource';

interface CrmSourceState {
  sourceId: string;
  snippet: string | undefined;
}

export function CrmSourcePanel() {
  const [source, setSource] = useState<CrmSourceState | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sourceId?: string; snippet?: string } | null>).detail;
      const sourceId = detail?.sourceId;
      if (!sourceId) return;
      setSource({ sourceId, snippet: detail?.snippet });
    };
    window.addEventListener(OPEN_CRM_EVENT, handler);
    return () => window.removeEventListener(OPEN_CRM_EVENT, handler);
  }, []);

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
          Wealthbox record
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => setSource(null)}
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

        {/* TODO(crm-viewer): add a "View full record" action that fetches and displays
            the complete stored Wealthbox record text via a future crm_get_record command. */}
        <p className="text-xs text-slate-400">
          Full record detail coming in a future update.
        </p>
      </div>
    </div>
  );
}

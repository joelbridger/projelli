/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import { FileSignature, X } from 'lucide-react';
import { EV_OPEN_ESIGN } from '@/config/identity';

interface DocusignSourceState {
  sourceId: string;
  snippet?: string;
}

function sourceLabel(sourceId: string): string {
  const parts = sourceId.split(':');
  if (parts.length >= 3) {
    const envelope = parts[2] ?? sourceId;
    if (parts[3] === 'event') return `Signing event ${parts.slice(4).join(':')} on ${envelope}`;
    if (parts[3] === 'doc') return `Document ${parts.slice(4).join(':')} on ${envelope}`;
    return `Envelope ${envelope}`;
  }
  return sourceId;
}

export function DocusignSourcePanel() {
  const [source, setSource] = useState<DocusignSourceState | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sourceId?: string; snippet?: string } | null>).detail;
      if (!detail?.sourceId) return;
      setSource({
        sourceId: detail.sourceId,
        ...(detail.snippet ? { snippet: detail.snippet } : {}),
      });
    };
    window.addEventListener(EV_OPEN_ESIGN, handler);
    return () => { window.removeEventListener(EV_OPEN_ESIGN, handler); };
  }, []);

  if (!source) return null;

  return (
    <div
      role="dialog"
      aria-label="DocuSign source"
      className="fixed bottom-6 right-6 z-50 w-80 rounded-lg border border-slate-200 bg-white shadow-lg"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <FileSignature className="h-4 w-4 text-slate-500" aria-hidden="true" />
          DocuSign source
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
      <div className="space-y-3 px-4 py-3">
        <p className="text-xs text-slate-500">
          Source: <span className="font-mono text-slate-700">{sourceLabel(source.sourceId)}</span>
        </p>
        {source.snippet && (
          <blockquote className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700 italic">
            {source.snippet.length > 300 ? `${source.snippet.slice(0, 300)}...` : source.snippet}
          </blockquote>
        )}
        <p className="text-xs text-slate-400">
          Full DocuSign agreement view will use the locally stored envelope and signing timeline.
        </p>
      </div>
    </div>
  );
}

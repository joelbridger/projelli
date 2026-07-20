/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import { NotebookPen, X } from 'lucide-react';
import { EV_OPEN_ZOCKS } from '@/config/identity';
import { brandText } from '@/config/brandText';
import { BRAND } from '@/config/brand';

interface ZocksSourceState {
  sourceId: string;
  snippet: string | undefined;
}

export function ZocksSourcePanel() {
  const [source, setSource] = useState<ZocksSourceState | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sourceId?: string; snippet?: string } | null>).detail;
      if (!detail?.sourceId) return;
      setSource({ sourceId: detail.sourceId, snippet: detail.snippet });
    };
    window.addEventListener(EV_OPEN_ZOCKS, handler);
    return () => { window.removeEventListener(EV_OPEN_ZOCKS, handler); };
  }, []);

  if (!source) return null;

  return (
    <div
      role="dialog"
      aria-label="Zocks meeting notes"
      className="fixed bottom-6 right-6 z-50 w-80 rounded-lg border border-slate-200 bg-white shadow-lg"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <NotebookPen className="h-4 w-4 text-slate-500" aria-hidden="true" />
          Zocks meeting notes
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
        <p className="break-all text-xs text-slate-500">
          Source: <span className="font-mono text-slate-700">{source.sourceId}</span>
        </p>
        {source.snippet && (
          <blockquote className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700 italic">
            {source.snippet.length > 300 ? `${source.snippet.slice(0, 300)}...` : source.snippet}
          </blockquote>
        )}
        <p className="text-xs text-slate-400">
          {brandText(`${BRAND.name} imported this citation from Zocks as read-only text. Full meeting detail is a fast-follow.`)}
        </p>
      </div>
    </div>
  );
}

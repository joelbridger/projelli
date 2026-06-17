import { CheckCircle2, AlertTriangle, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AnswerCitation } from './askHelpers';

/* -------------------------------------------------------------------------- */
/* CitationText — inline chip renderer                                         */
/* -------------------------------------------------------------------------- */

export function CitationText({
  text,
  citations,
  selected,
  onSelect,
}: {
  text: string;
  citations: AnswerCitation[];
  selected: number | null;
  onSelect: (n: number) => void;
}) {
  const parts = text.split(/(\{\d+\})/g);
  return (
    <p style={{ fontSize: 'var(--kp-font-md)', lineHeight: 'var(--kp-leading-relaxed)', color: 'var(--color-foreground)', margin: 0 }}>
      {parts.map((part, i) => {
        const match = part.match(/^\{(\d+)\}$/);
        if (!match) return <span key={i}>{part}</span>;

        const n = Number(match[1]);
        const cite = citations.find((c) => c.n === n);
        const isSel = selected === n;
        const isVerified = cite?.verified ?? false;
        const isUnresolved = cite?.path === null;

        return (
          <button
            key={i}
            type="button"
            onClick={() => { onSelect(n); }}
            aria-label={`Citation ${String(n)}: ${cite?.label ?? 'unknown'}. ${isVerified ? 'Verified.' : 'Not verified.'}`}
            title={
              isUnresolved
                ? 'Source file not found'
                : isVerified
                  ? `Open ${cite?.path ?? ''}`
                  : 'Unverified citation: check against the source'
            }
            style={isSel ? { outline: '2px solid var(--kp-navy)', outlineOffset: 1 } : undefined}
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded border text-xs font-mono font-medium align-baseline cursor-pointer transition-colors',
              isUnresolved
                ? 'border-amber-400/60 bg-amber-50 text-amber-700 hover:bg-amber-100'
                : isVerified
                  ? 'border-green-400/60 bg-green-50 text-green-800 hover:bg-green-100'
                  : 'border-[#145a8a]/30 bg-[#e9f5ff] text-[#145a8a] hover:bg-[#d0eaff]',
            )}
          >
            {isVerified ? (
              <CheckCircle2 className="h-3 w-3 shrink-0" />
            ) : isUnresolved ? (
              <AlertTriangle className="h-3 w-3 shrink-0" />
            ) : (
              <FileText className="h-3 w-3 shrink-0" />
            )}
            {n}
          </button>
        );
      })}
    </p>
  );
}

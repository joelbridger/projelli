import { CheckCircle2, AlertTriangle } from 'lucide-react';
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
  onOpenFileAtPath,
}: {
  text: string;
  citations: AnswerCitation[];
  selected: number | null;
  onSelect: (n: number) => void;
  /**
   * WS3 (Task 2): when provided, chip click also opens the file at the
   * cited paragraph — single-click navigation matching the Chat surface.
   */
  onOpenFileAtPath?: (path: string, paragraphIndex: number, snippet?: string) => void;
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

        // WS3 (Task 3): data-verified still reflects the underlying state.
        const dataVerified: 'true' | 'false' | 'unknown' = isUnresolved
          ? 'false'
          : isVerified
            ? 'true'
            : 'unknown';
        // BUG-065: STRICT trust display. A chip is green "source found" ONLY when
        // we proved the exact retrieved source AND it verified. Everything else —
        // unresolved OR resolved-but-not-verified — is a red "Unverified" flag.
        const proven = isVerified && !isUnresolved;

        return (
          <button
            key={i}
            type="button"
            data-testid={`ask-citation-chip-${n}`}
            data-verified={dataVerified}
            onClick={() => {
              onSelect(n);
              // WS3 (Task 2): also open the file at the cited paragraph if
              // a path is available — single-click, no second "Open in editor"
              // click required (matches the Chat surface behaviour).
              if (onOpenFileAtPath && cite?.path) {
                onOpenFileAtPath(
                  cite.path,
                  cite.paragraphIndex ?? 0,
                  cite.excerpt || undefined,
                );
              }
            }}
            aria-label={`Citation ${String(n)}: ${cite?.label ?? 'unknown'}. ${proven ? 'Source found.' : 'Unverified.'}`}
            title={
              proven
                ? `Source found — open ${cite?.path ?? ''}`
                : isUnresolved
                  ? 'Unverified: the cited source could not be found in what was retrieved. Do not rely on this without checking.'
                  : 'Unverified: could not confirm this exact passage against the source. Do not rely on this without checking.'
            }
            style={isSel ? { outline: '2px solid var(--kp-navy)', outlineOffset: 1 } : undefined}
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded border text-xs font-mono font-medium align-baseline cursor-pointer transition-colors',
              proven
                ? 'border-green-400/60 bg-green-50 text-green-800 hover:bg-green-100'
                : 'border-red-400/60 bg-red-50 text-red-700 hover:bg-red-100',
            )}
          >
            {proven ? (
              <CheckCircle2 className="h-3 w-3 shrink-0" />
            ) : (
              <AlertTriangle className="h-3 w-3 shrink-0" />
            )}
            {n}
          </button>
        );
      })}
    </p>
  );
}

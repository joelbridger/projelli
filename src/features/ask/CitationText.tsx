import { CheckCircle2, AlertTriangle, Mail } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { AnswerCitation } from './askHelpers';

/* -------------------------------------------------------------------------- */
/* CitationText — the Ask answer renderer (matches the demo Ask answer body).  */
/*                                                                             */
/* Renders the answer as spaced sections with:                                 */
/*   - navy bold lead-ins        **Where things stand.**                       */
/*   - an orange "watch this" callout  ==…==  (a highlight convention)         */
/*   - inline green numbered citation chips  {1} {2} …  (verify state kept)    */
/*   - email drafts as a clean card    ```email\nTo: …\nSubject: …\n\n body``` */
/* -------------------------------------------------------------------------- */

const answerParaStyle: CSSProperties = {
  margin: 0,
  fontSize: '15.5px',
  lineHeight: 1.62,
  color: 'var(--kp-navy)',
};

const boldStyle: CSSProperties = { fontWeight: 700, color: 'var(--kp-navy)' };
const warnStyle: CSSProperties = { color: 'var(--kp-warning, #b45309)', fontWeight: 600 };

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
  /** A single citation chip (verify state + click-to-open preserved). */
  function renderChip(n: number, key: string): ReactNode {
    const cite = citations.find((c) => c.n === n);
    const isSel = selected === n;
    const isVerified = cite?.verified ?? false;
    const isUnresolved = cite?.path === null;
    const dataVerified: 'true' | 'false' | 'unknown' = isUnresolved
      ? 'false'
      : isVerified
        ? 'true'
        : 'unknown';
    // STRICT trust display: green only when the exact source was proven.
    const proven = isVerified && !isUnresolved;
    return (
      <button
        key={key}
        type="button"
        data-testid={`ask-citation-chip-${n}`}
        data-verified={dataVerified}
        onClick={() => {
          onSelect(n);
          if (onOpenFileAtPath && cite?.path) {
            onOpenFileAtPath(cite.path, cite.paragraphIndex ?? 0, cite.excerpt || undefined);
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
          'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md border text-xs font-mono font-semibold align-baseline cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
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
  }

  /** Inline parse: bold (**…**), orange callout (==…==), citation chips ({n}). */
  function renderInline(segment: string, keyBase: string): ReactNode[] {
    const parts = segment.split(/(\{\d+\}|\*\*[^*]+\*\*|==[^=]+==)/g);
    return parts.map((part, i) => {
      const key = `${keyBase}-${String(i)}`;
      const cite = part.match(/^\{(\d+)\}$/);
      if (cite) return renderChip(Number(cite[1]), key);
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={key} style={boldStyle}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('==') && part.endsWith('==')) {
        return (
          <span key={key} style={warnStyle}>
            {part.slice(2, -2)}
          </span>
        );
      }
      return <span key={key}>{part}</span>;
    });
  }

  // Split the answer into blocks: email-draft cards (```email …```) and prose.
  const blocks = text.split(/(```email\n[\s\S]*?```)/g).filter((b) => b.trim() !== '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {blocks.map((block, bi) => {
        const email = block.match(/^```email\n([\s\S]*?)```$/);
        if (email) {
          return <EmailCard key={`b-${String(bi)}`} raw={email[1] ?? ''} />;
        }
        // Prose block → spaced paragraphs (sections).
        const paras = block.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
        return paras.map((para, pi) => (
          <p key={`b-${String(bi)}-p-${String(pi)}`} style={answerParaStyle}>
            {renderInline(para.replace(/\n/g, ' '), `b-${String(bi)}-p-${String(pi)}`)}
          </p>
        ));
      })}
    </div>
  );
}

/** A clean email-draft card (To: line + bold subject + body), matching the demo. */
function EmailCard({ raw }: { raw: string }) {
  const lines = raw.split('\n');
  let to = '';
  let subject = '';
  const bodyLines: string[] = [];
  let inBody = false;
  for (const line of lines) {
    if (!inBody && /^to:/i.test(line.trim())) {
      to = line.replace(/^to:/i, '').trim();
      continue;
    }
    if (!inBody && /^subject:/i.test(line.trim())) {
      subject = line.replace(/^subject:/i, '').trim();
      continue;
    }
    if (!inBody && line.trim() === '') {
      inBody = true;
      continue;
    }
    inBody = true;
    bodyLines.push(line);
  }
  const body = bodyLines.join('\n').trim();
  return (
    <div
      data-testid="ask-email-card"
      style={{
        border: '1px solid var(--kp-divider)',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(10,37,64,0.06), 0 8px 24px rgba(10,37,64,0.10)',
        background: 'var(--color-background)',
      }}
    >
      {to && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderBottom: '1px solid var(--kp-divider)',
            background: 'var(--kp-bg-soft)',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--kp-text-dim)',
          }}
        >
          <Mail size={14} strokeWidth={2} style={{ color: 'var(--kp-accent)', flex: 'none' }} />
          {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
          <span>To: {to}</span>
        </div>
      )}
      <div style={{ padding: '14px 16px', fontSize: 14, lineHeight: 1.6, color: 'var(--kp-navy)', whiteSpace: 'pre-wrap' }}>
        {subject && <div style={{ fontWeight: 700, color: 'var(--kp-navy)', marginBottom: 8 }}>{subject}</div>}
        {body}
      </div>
    </div>
  );
}

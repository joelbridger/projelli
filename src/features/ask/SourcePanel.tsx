import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { FileText, ShieldCheck, CheckCircle2, AlertTriangle, Loader2, Clock, ExternalLink } from 'lucide-react';
import type { AnswerCitation } from './askHelpers';
import { ragVerifyCitation, type CitationVerdict } from '@/platform/utils/tauri-commands';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import type { AuditEntry } from '@/platform/types/audit';
import { provenanceBadgeLabel, isStalePlan } from '@/platform/rag/sourceProvenance';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { EXTERNAL_EXPORT_STALE_DAYS_KEY } from '@/platform/settings/schema';
import { EV_OPEN_EMAIL, EV_MATTER_LAUNCH } from '@/config/identity';

/* -------------------------------------------------------------------------- */
/* SourcePanel — the SOURCES column. A list of clean white numbered cards,     */
/* one per citation in the active answer (matches the demo Ask source panel).  */
/* Each card: number badge + file icon + filename, a grey quote, and a green   */
/* "Verified against source" line that runs the real cryptographic check.      */
/* Clicking a card opens the cited source. All real functionality preserved.   */
/* -------------------------------------------------------------------------- */

const LABEL_SOURCES = 'Sources';
const LABEL_VERIFIED = 'Verified against source';
const LABEL_VERIFY = 'Verify against source';

/** Open the cited source (document → contextual editor; email → reading view). */
function openCitation(cite: AnswerCitation): void {
  if (cite.path?.startsWith('mail:')) {
    window.dispatchEvent(new CustomEvent(EV_OPEN_EMAIL, { detail: { sourceId: cite.path } }));
    return;
  }
  if (cite.path && !cite.path.startsWith('crm:') && cite.matterId) {
    const source: { kind: 'document'; ref: string; snippet?: string } = { kind: 'document', ref: cite.path };
    if (cite.excerpt) source.snippet = cite.excerpt;
    window.dispatchEvent(
      new CustomEvent(EV_MATTER_LAUNCH, {
        detail: { matterId: cite.matterId, surface: 'files', source },
      }),
    );
  }
}

function problemMessage(v: CitationVerdict['verdict']): string {
  switch (v) {
    case 'notFound':
      return 'Quote not found in the source';
    case 'textMismatch':
      return 'Quote does not match the source';
    case 'matterMismatch':
      return 'Belongs to a different client';
    default:
      return 'Could not verify';
  }
}

/**
 * Honest provenance chip for a recognized external export. Renders nothing for
 * an ordinary source. For a recognized RightCapital plan / Jump note it shows
 * "exported from RightCapital · Jun 12, 2026"; for a stale plan it switches to
 * an amber "may be out of date" treatment so a snapshot is never mistaken for
 * live data.
 */
function ProvenanceBadge({ cite }: { cite: AnswerCitation }) {
  const staleDays = useSettingsStore(
    (s) => s.getSetting<number>(EXTERNAL_EXPORT_STALE_DAYS_KEY),
  );
  const prov = cite.provenance;
  if (!prov) return null;
  const stale = isStalePlan(prov, new Date(), staleDays);
  const Icon = stale ? Clock : ExternalLink;
  return (
    <div
      data-testid="provenance-badge"
      data-tool={prov.tool}
      data-stale={stale ? 'true' : 'false'}
      title={
        stale
          ? 'This plan is an exported snapshot and may be out of date. Re-export from the tool for the latest.'
          : 'Advisor Prep Hero reads the file you exported or saved from this tool. It is a point-in-time snapshot, not a live connection.'
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        marginBottom: 7,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        maxWidth: '100%',
        background: stale ? 'var(--kp-direct-bg, #fef3c7)' : 'var(--kp-bg-soft, #f1f5f9)',
        color: stale ? 'var(--kp-direct, #b45309)' : 'var(--kp-text-dim)',
        border: `1px solid ${stale ? 'rgba(180,83,9,0.35)' : 'var(--kp-divider)'}`,
      }}
    >
      <Icon size={11} strokeWidth={2} style={{ flex: 'none' }} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {provenanceBadgeLabel(prov)}
        {stale ? ' · may be out of date' : ''}
      </span>
    </div>
  );
}

function SourceCard({
  cite,
  selected,
  onSelect,
  onAuditLog,
  onOpenCitation,
}: {
  cite: AnswerCitation;
  selected: boolean;
  onSelect: (n: number) => void;
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  onOpenCitation?: (cite: AnswerCitation) => void;
}) {
  const [verdict, setVerdict] = useState<CitationVerdict | 'loading' | null>(null);
  const canVerify = Boolean(cite.id && cite.matterId);
  // QA-56: cards are keyed by citation identity (id + matterId) so an
  // identity change remounts with fresh state. This ref closes the residual
  // gap: while a verify is in flight, the SAME card's cite can change in place
  // (same id/matterId, different quoted excerpt). Compare the freshest cite
  // after the async check so a verdict computed for the OLD quote never paints
  // onto a new one.
  // Synced in a LAYOUT effect (commit phase, before any promise callback) so a
  // late verify always compares against the currently-rendered quote — no gap.
  const citeRef = useRef(cite);
  useLayoutEffect(() => { citeRef.current = cite; }, [cite]);
  // When the host supplies its own opener (e.g. the Client Map, whose sources
  // include CRM / OneDrive / e-sign / meeting kinds the built-in path opener
  // can't route), every card is openable and routes there. Otherwise fall back
  // to the built-in mail/document path opener.
  const openable = onOpenCitation
    ? true
    : Boolean(
        cite.path && (cite.path.startsWith('mail:') || (!cite.path.startsWith('crm:') && cite.matterId)),
      );

  async function runVerify(e: MouseEvent<HTMLButtonElement>): Promise<void> {
    e.stopPropagation();
    if (!cite.id || !cite.matterId) return;
    const verified = { id: cite.id, matterId: cite.matterId, excerpt: cite.excerpt };
    setVerdict('loading');
    try {
      const r = await ragVerifyCitation(verified.id, verified.matterId, verified.excerpt);
      // Drop the result if this card now represents a different citation/quote.
      // Reset to unverified (not the stale verdict, not a stuck 'loading') so the
      // NEW quote shows an actionable verify button rather than a frozen spinner.
      const now = citeRef.current;
      if (now.id !== verified.id || now.matterId !== verified.matterId || now.excerpt !== verified.excerpt) {
        setVerdict(null);
        return;
      }
      setVerdict(r);
      onAuditLog?.(
        auditEventToEntry({
          type: 'citation_verified',
          timestamp: new Date().toISOString(),
          payload: { citationId: cite.id, verdict: r.verdict },
        }),
      );
    } catch {
      // ragVerifyCitation throws in browser/test mode — treat as "not run".
      // Same either way (stale or current): reset to unverified so the button is
      // actionable again and never stuck on 'loading'.
      setVerdict(null);
    }
  }

  const isProblem = verdict !== null && verdict !== 'loading' && verdict.verdict !== 'verified';
  const isGreen =
    (verdict !== null && verdict !== 'loading' && verdict.verdict === 'verified') ||
    (verdict === null && cite.verified);

  function handleOpen(): void {
    onSelect(cite.n);
    if (onOpenCitation) {
      onOpenCitation(cite);
      return;
    }
    if (openable) openCitation(cite);
  }

  return (
    <div
      data-testid="source-card"
      data-cite={cite.n}
      {...(openable ? { role: 'button', tabIndex: 0 } : {})}
      onClick={handleOpen}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (openable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleOpen();
        }
      }}
      style={{
        background: 'var(--color-background)',
        border: selected ? '1px solid var(--kp-accent)' : '1px solid var(--kp-divider)',
        borderRadius: 12,
        padding: '14px 15px',
        marginBottom: 12,
        boxShadow: '0 1px 2px rgba(10,37,64,0.06), 0 8px 24px rgba(10,37,64,0.10)',
        cursor: openable ? 'pointer' : 'default',
      }}
    >
      {/* File row: numbered badge + doc icon + filename */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 7,
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--kp-navy)',
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            background: '#f0fdf4',
            border: '1px solid rgba(74,222,128,0.6)',
            color: '#166534',
            fontSize: 11,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 'none',
          }}
        >
          {cite.n}
        </span>
        <FileText size={14} strokeWidth={1.75} style={{ color: 'var(--kp-accent)', flex: 'none' }} />
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cite.label}
        </span>
      </div>

      {/* Connector-access: honest provenance badge for a recognized external
          export (a RightCapital plan, a Jump meeting note). Says "exported from
          RightCapital", never "integrated" — and turns amber when a plan
          snapshot is older than the configured limit. */}
      <ProvenanceBadge cite={cite} />

      {/* Grey quote with a quiet left rule */}
      <div
        style={{
          fontSize: 12.5,
          lineHeight: 1.5,
          color: 'var(--kp-text-dim)',
          borderLeft: '2px solid var(--kp-divider-strong)',
          paddingLeft: 10,
        }}
      >
        {cite.excerpt}
      </div>

      {/* Verify line — green "Verified against source"; runs the real check. */}
      <div style={{ marginTop: 10 }}>
        {isProblem ? (
          <span
            data-testid="verify-verdict"
            data-verdict={(verdict as CitationVerdict).verdict}
            title={problemMessage((verdict as CitationVerdict).verdict)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: 'var(--kp-danger, #b02a1f)' }}
          >
            <AlertTriangle size={12} strokeWidth={2} style={{ flex: 'none' }} />
            {problemMessage((verdict as CitationVerdict).verdict)}
          </span>
        ) : (
          <button
            type="button"
            data-testid="verify-citation-btn"
            onClick={(e) => { void runVerify(e); }}
            disabled={!canVerify || verdict === 'loading'}
            title={canVerify ? 'Check this quote against the stored source' : 'Verification is not available for this citation (pre-3.0 or browser mode)'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11.5,
              fontWeight: 600,
              color: '#16654a',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: canVerify ? 'pointer' : 'default',
            }}
          >
            {verdict === 'loading' ? (
              <Loader2 size={12} strokeWidth={2} className="animate-spin" style={{ flex: 'none' }} />
            ) : isGreen ? (
              <CheckCircle2 size={12} strokeWidth={2} style={{ flex: 'none' }} />
            ) : (
              <ShieldCheck size={12} strokeWidth={2} style={{ flex: 'none' }} />
            )}
            {isGreen ? LABEL_VERIFIED : LABEL_VERIFY}
          </button>
        )}
      </div>
    </div>
  );
}

export function SourcePanel({
  citations,
  selectedN,
  onSelect,
  onAuditLog,
  onOpenCitation,
  headerSuffix,
  emptyHint,
  footerNote,
}: {
  /** All citations for the answer the user is looking at. */
  citations: AnswerCitation[];
  /** The currently-highlighted citation number (clicked chip / card). */
  selectedN: number | null;
  /** Select citation n (drives the chip↔card highlight). */
  onSelect: (n: number) => void;
  /**
   * When provided, each "Verify against source" result emits a
   * `citation_verified` audit entry so the check is on the record.
   */
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  /**
   * Optional host opener. When provided, clicking a card routes here with the
   * full citation instead of the built-in mail/document opener — for hosts that
   * carry richer source-kind data (the Client Map reuses this column for CRM /
   * OneDrive / e-sign / meeting sources, which the path opener can't route).
   */
  onOpenCitation?: (cite: AnswerCitation) => void;
  /**
   * Ask-smart (opt-in; Client Map does not pass these): a short suffix after the
   * SOURCES header ("· from your files only"), an empty-state node shown when an
   * answer had no file sources, and a footer note under the cards. They make the
   * Sources panel's honest point: general-knowledge answers add nothing here.
   */
  headerSuffix?: string;
  emptyHint?: ReactNode;
  footerNote?: ReactNode;
}) {
  return (
    <div data-testid="source-panel">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          marginBottom: 14,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--kp-text-faint)',
        }}
      >
        <ShieldCheck size={13} strokeWidth={2} style={{ flex: 'none' }} />
        {LABEL_SOURCES}
        {headerSuffix != null && headerSuffix !== '' && (
          <span style={{ fontWeight: 600, letterSpacing: '0.06em' }}>· {headerSuffix}</span>
        )}
      </div>

      {citations.length === 0 && emptyHint != null && (
        <div
          data-testid="source-panel-empty"
          style={{
            border: '1px dashed var(--kp-divider-strong)',
            borderRadius: 12,
            padding: '18px 16px',
            fontSize: 12.5,
            lineHeight: 1.55,
            color: 'var(--kp-text-faint)',
            textAlign: 'center',
          }}
        >
          {emptyHint}
        </div>
      )}

      {citations.map((c) => (
        <SourceCard
          // Key by citation IDENTITY (id/path + matterId), not just the number:
          // switching Ask turns / Client Map sections re-renders this column, and
          // a different source reusing the same number (n) must remount with fresh
          // local state — otherwise a prior card's verify verdict would wrongly
          // carry over onto the new, unchecked source.
          key={`${String(c.n)}:${c.id ?? c.path ?? ''}:${c.matterId ?? ''}`}
          cite={c}
          selected={c.n === selectedN}
          onSelect={onSelect}
          {...(onOpenCitation ? { onOpenCitation } : {})}
          {...(onAuditLog ? { onAuditLog } : {})}
        />
      ))}

      {citations.length > 0 && footerNote != null && (
        <div
          data-testid="source-panel-footer"
          style={{ marginTop: 4, fontSize: 11.5, lineHeight: 1.5, color: 'var(--kp-text-faint)' }}
        >
          {footerNote}
        </div>
      )}
    </div>
  );
}

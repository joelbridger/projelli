import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { FileText, ShieldCheck, CheckCircle2, AlertTriangle, Loader2, Clock, ExternalLink } from 'lucide-react';
import type { AnswerCitation } from './askHelpers';
import { ragVerifyCitationsBatch, type CitationVerdict } from '@/platform/utils/tauri-commands';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import type { AuditEntry } from '@/platform/types/audit';
import { provenanceBadgeLabel, isStalePlan } from '@/platform/rag/sourceProvenance';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { EXTERNAL_EXPORT_STALE_DAYS_KEY } from '@/platform/settings/schema';
import { EV_OPEN_EMAIL, EV_MATTER_LAUNCH } from '@/config/identity';

/* -------------------------------------------------------------------------- */
/* SourcePanel — the SOURCES column. A list of clean white numbered cards,     */
/* one per citation in the active answer (matches the demo Ask source panel).  */
/* Each card: number badge + file icon + filename, a grey quote, and a verify  */
/* line. The moment a citation appears it is checked automatically against    */
/* the real store (rag_verify_citations_batch, QA-85) — the card starts in a  */
/* neutral "Source found" state and only ever earns the green "Verified       */
/* against source" label once that REAL check comes back verified. A genuine  */
/* mismatch degrades to a red problem line; an unavailable check (browser dev */
/* mode) stays neutral forever — it never fakes a verification that didn't    */
/* run. Clicking a card opens the cited source.                               */
/* -------------------------------------------------------------------------- */

const LABEL_SOURCES = 'Sources';
const LABEL_VERIFIED = 'Verified against source';
const LABEL_SOURCE_FOUND = 'Source found';

/**
 * QA-85 — the real check's outcome for one citation. Extends the backend's
 * four verdicts with `'unavailable'`: thrown when the verifier can't run at
 * all (browser/dev mode has no Tauri backend). `'unavailable'` is NEVER
 * treated as verified — the card just stays in the neutral "Source found"
 * state, same as while the check is still pending.
 */
type RealVerdict = CitationVerdict['verdict'] | 'unavailable';

/** Content-addressed key: (id, matterId, excerpt). Keying by the QUOTED TEXT,
 *  not just citation identity, means a citation whose excerpt changes in
 *  place (same card, new quote) can never show a verdict computed for the old
 *  quote — the old key's late-arriving result lands under a key nobody reads
 *  anymore (QA-56's stale-async guard, now structural instead of ref-based). */
function verifyKey(id: string, matterId: string, excerpt: string): string {
  return `${id} ${matterId} ${excerpt}`;
}

/**
 * QA-85 — automatically runs the real backend citation check for every
 * eligible citation (id + matterId present) the moment it appears, batched in
 * one `rag_verify_citations_batch` call per new set of citations. No user
 * action required. A citation without `id`/`matterId` (pre-3.0 persisted
 * data) is simply never fetched — it stays "Source found" forever, honestly.
 */
function useCitationVerification(
  citations: AnswerCitation[],
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void,
): Map<string, RealVerdict> {
  const [verdicts, setVerdicts] = useState<Map<string, RealVerdict>>(new Map());
  const requested = useRef<Set<string>>(new Set());

  const eligible = citations.filter(
    (c): c is AnswerCitation & { id: string; matterId: string } => Boolean(c.id && c.matterId),
  );
  const signature = eligible.map((c) => verifyKey(c.id, c.matterId, c.excerpt)).join('|');

  useEffect(() => {
    // Copy the ref's Set (a single, stable instance across renders — never
    // reassigned) to a local so the effect and its cleanup share the exact
    // same reference without re-reading `requested.current` inside cleanup.
    const requestedKeys = requested.current;
    const toFetch = eligible.filter((c) => !requestedKeys.has(verifyKey(c.id, c.matterId, c.excerpt)));
    if (toFetch.length === 0) return;
    const keys = toFetch.map((c) => verifyKey(c.id, c.matterId, c.excerpt));
    keys.forEach((k) => requestedKeys.add(k));
    let cancelled = false;
    // QA-85 round 2: distinct from `cancelled` — tracks whether THIS batch
    // ever reached a result (stored or not). If the effect is torn down
    // before that happens (citations changed mid-flight), the cleanup below
    // un-marks these keys so a LATER reappearance of the SAME citation (same
    // id/matterId/excerpt) gets re-fetched instead of staying "pending"
    // forever with no result and no audit entry.
    let settled = false;
    const run = async () => {
      try {
        const results = await ragVerifyCitationsBatch(
          toFetch.map((c) => ({ id: c.id, claimedMatterId: c.matterId, quotedText: c.excerpt })),
        );
        settled = true;
        if (!cancelled) {
          setVerdicts((prev) => {
            const next = new Map(prev);
            toFetch.forEach((c, i) => {
              const r = results[i];
              if (r) next.set(verifyKey(c.id, c.matterId, c.excerpt), r.verdict);
            });
            return next;
          });
          toFetch.forEach((c, i) => {
            const r = results[i];
            if (r) {
              onAuditLog?.(
                auditEventToEntry({
                  type: 'citation_verified',
                  timestamp: new Date().toISOString(),
                  payload: { citationId: c.id, verdict: r.verdict },
                }),
              );
            }
          });
        }
      } catch {
        // Browser/dev mode (no Tauri backend) or a verifier error — never
        // fake-verify. Mark 'unavailable' so these exact keys are not
        // endlessly retried; the card stays neutral "Source found".
        settled = true;
        if (!cancelled) {
          setVerdicts((prev) => {
            const next = new Map(prev);
            toFetch.forEach((c) => next.set(verifyKey(c.id, c.matterId, c.excerpt), 'unavailable'));
            return next;
          });
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (!settled) {
        keys.forEach((k) => requestedKeys.delete(k));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch is keyed by `signature` (content), not by the `eligible`/`onAuditLog` references which are recreated every render.
  }, [signature]);

  return verdicts;
}

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

function problemMessage(v: RealVerdict): string {
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
  verifyState,
  onSelect,
  onOpenCitation,
}: {
  cite: AnswerCitation;
  selected: boolean;
  /** QA-85: the REAL check's outcome for this citation — `'pending'` until the
   *  automatic batch verify resolves. Owned by the parent `SourcePanel` (one
   *  batch call covers every card), so a card never runs its own check. */
  verifyState: RealVerdict | 'pending';
  onSelect: (n: number) => void;
  onOpenCitation?: (cite: AnswerCitation) => void;
}) {
  // When the host supplies its own opener (e.g. the Client Map, whose sources
  // include CRM / OneDrive / e-sign / meeting kinds the built-in path opener
  // can't route), every card is openable and routes there. Otherwise fall back
  // to the built-in mail/document path opener.
  const openable = onOpenCitation
    ? true
    : Boolean(
        cite.path && (cite.path.startsWith('mail:') || (!cite.path.startsWith('crm:') && cite.matterId)),
      );

  // Only a REAL negative verdict (a proven mismatch) is a "problem" — pending,
  // unavailable (browser/dev, no backend), and not-yet-checked (no id/matterId)
  // all render the same honest neutral "Source found" state below.
  const isProblem =
    verifyState !== 'pending' && verifyState !== 'unavailable' && verifyState !== 'verified';
  const isVerified = verifyState === 'verified';

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

      {/* Verify line — automatic (QA-85): starts "Source found" the instant the
          citation appears, upgrades to green "Verified against source" only
          once the REAL backend check returns verified, degrades to a red
          problem line on a proven mismatch. Never a button — nothing to click. */}
      <div style={{ marginTop: 10 }}>
        {isProblem ? (
          <span
            data-testid="verify-verdict"
            data-verdict={verifyState}
            title={problemMessage(verifyState as RealVerdict)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: 'var(--kp-danger, #b02a1f)' }}
          >
            <AlertTriangle size={12} strokeWidth={2} style={{ flex: 'none' }} />
            {problemMessage(verifyState as RealVerdict)}
          </span>
        ) : (
          <span
            data-testid="verify-status"
            data-state={isVerified ? 'verified' : verifyState === 'pending' ? 'pending' : 'source-found'}
            title={
              isVerified
                ? 'The stored source was checked and contains this exact quote.'
                : verifyState === 'pending'
                  ? 'Checking this quote against the stored source…'
                  : 'This source was found; the automatic check could not confirm the exact quote (pre-3.0 citation or browser/dev mode).'
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11.5,
              fontWeight: 600,
              color: isVerified ? '#16654a' : 'var(--kp-text-dim)',
            }}
          >
            {verifyState === 'pending' ? (
              <Loader2 size={12} strokeWidth={2} className="animate-spin" style={{ flex: 'none' }} />
            ) : isVerified ? (
              <CheckCircle2 size={12} strokeWidth={2} style={{ flex: 'none' }} />
            ) : (
              <ShieldCheck size={12} strokeWidth={2} style={{ flex: 'none' }} />
            )}
            {isVerified ? LABEL_VERIFIED : LABEL_SOURCE_FOUND}
          </span>
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
   * When provided, each automatic real-verification result emits a
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
  // QA-85: ONE batch call covers every card in the panel — no per-card click,
  // no per-card fetch. Re-derived automatically whenever the citation set
  // changes (a new turn, a reload), so a stale persisted `verified` flag can
  // never be shown as a real verdict; the panel always re-checks live.
  const verdicts = useCitationVerification(citations, onAuditLog);

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
          verifyState={c.id && c.matterId ? (verdicts.get(verifyKey(c.id, c.matterId, c.excerpt)) ?? 'pending') : 'unavailable'}
          onSelect={onSelect}
          {...(onOpenCitation ? { onOpenCitation } : {})}
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

import { useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, CheckCircle2, AlertTriangle, Loader2, Clock, ExternalLink } from 'lucide-react';
import type { AnswerCitation } from './askHelpers';
import type { AuditEntry, AuditSourceIdentity } from '@/platform/types/audit';
import { formatExportDate, isStalePlan } from '@/platform/rag/sourceProvenance';
import { formatSourceIdentity } from '@/platform/audit/sourceCapture';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { EXTERNAL_EXPORT_STALE_DAYS_KEY } from '@/platform/settings/schema';
import { EV_OPEN_CRM, EV_OPEN_EMAIL, EV_MATTER_LAUNCH } from '@/config/identity';
import { getFileIcon } from '@/platform/utils/fileIcons';
import { useCitationVerification, verifyKey, type RealVerdict } from './citationVerification';

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

const PREVIEW_CHAR_LIMIT = 220;

// The QA-85/QA-92 verification hook (and its verdict store) moved to
// ./citationVerification so the answer header aggregates the SAME live
// per-citation verdicts these cards render (lp/badge-consistency).

/** Open the cited source (document → contextual editor; email → reading view). */
function openCitation(cite: AnswerCitation): void {
  if (cite.path?.startsWith('crm:')) {
    const crmParts = cite.path.split(':');
    window.dispatchEvent(
      new CustomEvent(EV_OPEN_CRM, {
        detail: {
          sourceId: cite.path,
          snippet: cite.excerpt,
          // Full record identity: the viewer must open THIS client's record.
          matterId: cite.matterId,
          entityKind: crmParts.length >= 3 ? crmParts[1] : undefined,
        },
      }),
    );
    return;
  }
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

function problemMessage(v: RealVerdict, t: (key: string) => string): string {
  switch (v) {
    case 'notFound':
      return t('ask.sources.status.quote-not-found');
    case 'textMismatch':
      return t('ask.sources.status.quote-mismatch');
    case 'matterMismatch':
      return t('ask.sources.status.wrong-client');
    default:
      return t('ask.sources.status.could-not-verify');
  }
}

function extensionFromCitation(cite: AnswerCitation): string | undefined {
  const sourceType = cite.sourceType?.toLowerCase();
  if (
    sourceType !== undefined &&
    !['document', 'text', 'mail', 'crm', 'onedrive', 'esign', 'meeting', 'box', 'jotform', 'sharefile', 'zocks', 'addepar'].includes(sourceType)
  ) {
    return sourceType;
  }
  const raw = cite.path ?? cite.label;
  const clean = raw.split(/[?#]/)[0] ?? raw;
  const name = clean.split(/[\\/]/).pop() ?? clean;
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) {
    return name.slice(dot + 1).toLowerCase();
  }
  return sourceType;
}

function SourceFileIcon({ cite }: { cite: AnswerCitation }) {
  const { Icon, color } = getFileIcon(extensionFromCitation(cite));
  return (
    <Icon
      data-testid="source-card-file-icon"
      size={14}
      strokeWidth={1.75}
      className={color}
      style={{ flex: 'none' }}
      aria-hidden
    />
  );
}

/**
 * Honest provenance chip for a recognized external export. Renders nothing for
 * an ordinary source. For a recognized RightCapital plan / Jump note it shows
 * "exported from RightCapital · Jun 12, 2026"; for a stale plan it switches to
 * an amber "may be out of date" treatment so a snapshot is never mistaken for
 * live data.
 */
function ProvenanceBadge({ cite }: { cite: AnswerCitation }) {
  const { t } = useTranslation();
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
          ? t('ask.sources.provenance-stale-title')
          : t('ask.sources.provenance-title')
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
        {prov.exportedAt
          ? t('ask.sources.provenance-file-date', { date: formatExportDate(prov.exportedAt) })
          : t('ask.sources.provenance-file')}
        {stale ? ` · ${t('ask.sources.provenance-stale-suffix')}` : ''}
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
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  // When the host supplies its own opener (e.g. the Client Map, whose sources
  // include CRM / OneDrive / e-sign / meeting kinds the built-in path opener
  // can't route), every card is openable and routes there. Otherwise fall back
  // to the built-in mail/document path opener.
  const openable = onOpenCitation
    ? true
    : Boolean(
        cite.path && (cite.path.startsWith('crm:') || cite.path.startsWith('mail:') || cite.matterId),
      );

  // Only a REAL negative verdict (a proven mismatch) is a "problem" — pending,
  // unavailable (browser/dev, no backend), and not-yet-checked (no id/matterId)
  // all render the same honest neutral "Source found" state below.
  const isProblem =
    verifyState !== 'pending' && verifyState !== 'unavailable' && verifyState !== 'verified';
  const isVerified = verifyState === 'verified';
  const hasExpandableExcerpt = cite.excerpt.length > PREVIEW_CHAR_LIMIT || cite.excerpt.split('\n').length > 3;
  const statusText = isVerified ? t('ask.sources.status.verified') : t('ask.sources.status.found');
  const statusTitle = isVerified
    ? t('ask.sources.status.verified-title')
    : verifyState === 'pending'
      ? t('ask.sources.status.checking-title')
      : t('ask.sources.status.found-title');

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
        background: selected ? 'var(--kp-accent-softer)' : 'transparent',
        border: 0,
        borderLeft: selected ? '2px solid var(--kp-accent)' : '2px solid transparent',
        borderBottom: '1px solid var(--kp-divider)',
        borderRadius: 0,
        padding: '10px 2px 12px 10px',
        marginBottom: 0,
        boxShadow: 'none',
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
            borderRadius: 999,
            background: 'var(--kp-bg-soft)',
            border: '1px solid var(--kp-divider-strong)',
            color: 'var(--kp-navy)',
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
        <SourceFileIcon cite={cite} />
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
        data-testid="source-card-preview"
        data-expanded={expanded ? 'true' : 'false'}
        style={{
          fontSize: 12.5,
          lineHeight: 1.45,
          color: 'var(--kp-text-dim)',
          ...(expanded
            ? {}
            : {
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }),
        }}
      >
        {cite.excerpt}
      </div>
      {hasExpandableExcerpt && (
        <button
          type="button"
          data-testid="source-card-preview-toggle"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          style={{
            marginTop: 6,
            padding: 0,
            border: 0,
            background: 'transparent',
            color: 'var(--kp-accent)',
            fontSize: 11.5,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {expanded ? t('ask.sources.show-less') : t('ask.sources.show-more')}
        </button>
      )}

      {/* Verify line — automatic (QA-85): starts "Source found" the instant the
          citation appears, upgrades to green "Verified against source" only
          once the REAL backend check returns verified, degrades to a red
          problem line on a proven mismatch. Never a button — nothing to click. */}
      <div style={{ marginTop: 10 }}>
        {isProblem ? (
          <span
            data-testid="verify-verdict"
            data-verdict={verifyState}
            title={problemMessage(verifyState as RealVerdict, t)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: 'var(--kp-danger, #b02a1f)' }}
          >
            <AlertTriangle size={12} strokeWidth={2} style={{ flex: 'none' }} />
            {problemMessage(verifyState as RealVerdict, t)}
          </span>
        ) : (
          <span
            data-testid="verify-status"
            data-state={isVerified ? 'verified' : verifyState === 'pending' ? 'pending' : 'source-found'}
            title={
              statusTitle
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
            {statusText}
          </span>
        )}
      </div>
    </div>
  );
}

export function SourcePanel({
  citations,
  readSources,
  selectedN,
  onSelect,
  onAuditLog,
  onOpenCitation,
  hideHeader = false,
  headerSuffix,
  emptyHint,
  footerNote,
}: {
  /** All citations for the answer the user is looking at. */
  citations: AnswerCitation[];
  /** B6 — the local source identities actually included in this answer's prompt. */
  readSources?: AuditSourceIdentity[];
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
  /** Hide the built-in Sources heading when the host renders it in its own chrome. */
  hideHeader?: boolean;
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
  const { t } = useTranslation();
  // QA-85: ONE batch call covers every card in the panel — no per-card click,
  // no per-card fetch. Re-derived automatically whenever the citation set
  // changes (a new turn, a reload), so a stale persisted `verified` flag can
  // never be shown as a real verdict; the panel always re-checks live.
  const verdicts = useCitationVerification(citations, onAuditLog);
  const readSourceList = readSources ?? [];
  const visibleReadSources = readSourceList.slice(0, 6);
  const hiddenReadSourceCount = Math.max(0, readSourceList.length - visibleReadSources.length);

  return (
    <div data-testid="source-panel">
      {!hideHeader && (
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
          {t('ask.sources.title')}
          {headerSuffix != null && headerSuffix !== '' && (
            <span style={{ fontWeight: 600, letterSpacing: '0.06em' }}>· {headerSuffix}</span>
          )}
        </div>
      )}
      {hideHeader && headerSuffix != null && headerSuffix !== '' && (
        <div
          style={{
            marginBottom: 14,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--kp-text-faint)',
          }}
        >
          {headerSuffix}
        </div>
      )}

      {readSourceList.length > 0 && (
        <div
          data-testid="source-panel-read-sources"
          style={{
            marginBottom: 14,
            padding: '10px 12px',
            border: '1px solid var(--kp-divider)',
            borderRadius: 10,
            background: 'var(--kp-surface-card)',
            color: 'var(--kp-text-dim)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 8,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--kp-text-faint)',
            }}
          >
            <ShieldCheck size={12} strokeWidth={2} style={{ flex: 'none' }} />
            AI read
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {visibleReadSources.map((source) => (
              <div
                key={source.id}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 6,
                  minWidth: 0,
                  fontSize: 12,
                  lineHeight: 1.35,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--kp-navy)',
                    fontWeight: 650,
                  }}
                >
                  {formatSourceIdentity(source)}
                </span>
                {source.chunkCount > 1 && (
                  <span style={{ flex: 'none', color: 'var(--kp-text-faint)', fontSize: 11 }}>
                    {source.chunkCount} chunks
                  </span>
                )}
              </div>
            ))}
            {hiddenReadSourceCount > 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--kp-text-faint)' }}>
                +{hiddenReadSourceCount} more
              </div>
            )}
          </div>
        </div>
      )}

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
          // CRM and document citations both read the SAME live verdict store:
          // a CRM citation is only green after `crmVerifyCitations` checks the
          // exact live record. No more `grounded → verified` shortcut.
          verifyState={c.id && c.matterId
            ? (verdicts.get(verifyKey(c.id, c.matterId, c.excerpt)) ?? 'pending')
            : 'unavailable'}
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

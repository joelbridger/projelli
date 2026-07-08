/**
 * AnswerBlocks — renders an Ask-smart answer as provenance-labelled blocks.
 *
 * This is the trust UI for the source-aware advisor agent: every block wears a
 * label that says what it is built from — green "From your files" (cited,
 * checkable), grey "General guidance" (the AI's own knowledge, clearly not from
 * your files), blue "Draft" (something it wrote), or "From your files — nothing
 * found" (the honest absence). A per-answer footer tallies it. The cardinal
 * rule the block model enforces: a cited file-claim and an uncited general
 * claim never share a block, so a green badge can never sit over uncited prose.
 *
 * Each block's body reuses {@link CitationText}, so chips, bold lead-ins, the
 * orange watch-this highlight, and email-draft cards all render exactly as they
 * do elsewhere.
 */

import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShieldCheck,
  ShieldAlert,
  Info,
  PencilLine,
  Search,
  Loader2,
} from 'lucide-react';
import type {
  AnswerBlock,
  AnswerBlockKind,
  AnswerCitation,
} from './askHelpers';
import {
  tallyBlocks,
  tallyCitationTrust,
  filesBlockTrustState,
  type CitationTrustState,
} from './answerBlockHelpers';
import {
  useCitationVerification,
  citationTrustState,
} from './citationVerification';
import type { AuditEntry } from '@/platform/types/audit';
import { CitationText } from './CitationText';
import { TrustNote } from '@/ui/kp';

const FILES = { fg: '#16654a', bg: '#e6f5ee', border: '#8fc9b0' };
// B1: a files block whose citations are grounded but NOT verified (post-hoc
// fuzzy matches) wears this amber "source found, not verified" tone instead of
// the green FILES tone — the block-level trust badge must be earned, not given
// for merely landing in a files block.
const AMBER = { fg: '#8a5a00', bg: '#fef6e6', border: '#e3b878' };
const GREY = {
  fg: 'var(--kp-text-dim)',
  bg: 'var(--kp-bg-soft)',
  border: 'var(--kp-divider-strong)',
};
const BLUE = {
  fg: 'var(--kp-accent)',
  bg: 'var(--kp-accent-soft)',
  border: 'var(--kp-action-border)',
};

interface LabelDef {
  labelKey: string;
  Icon: typeof ShieldCheck;
  tone: { fg: string; bg: string; border: string };
}

const LABELS: Record<AnswerBlockKind, LabelDef> = {
  files: { labelKey: 'ask.answer-blocks.label.files', Icon: ShieldCheck, tone: FILES },
  'nothing-found': {
    labelKey: 'ask.answer-blocks.label.nothing-found',
    Icon: Search,
    tone: GREY,
  },
  general: { labelKey: 'ask.answer-blocks.label.general', Icon: Info, tone: GREY },
  draft: { labelKey: 'ask.answer-blocks.label.draft', Icon: PencilLine, tone: BLUE },
};

function BlockLabel({
  kind,
  trust = 'verified',
}: {
  kind: AnswerBlockKind;
  trust?: CitationTrustState;
}) {
  const { t } = useTranslation();
  // B1, rewired to the LIVE verifier (lp/badge-consistency): a files block
  // whose citations the real check has not confirmed must NOT wear the green
  // "From your files" badge — amber once any citation is settled unverified,
  // a quiet "checking" while the check is still in flight. The state comes
  // from the same verdict store the Sources cards render, so this label can
  // never contradict a card. Every other kind is unaffected.
  const filesUnverified = kind === 'files' && trust === 'unverified';
  const filesChecking = kind === 'files' && trust === 'checking';
  const base = LABELS[kind];
  const text = filesUnverified
    ? t('ask.answer-blocks.label.files-unverified')
    : filesChecking
      ? t('ask.answer-blocks.label.files-checking')
      : t(base.labelKey);
  const Icon = filesUnverified
    ? ShieldAlert
    : filesChecking
      ? Loader2
      : base.Icon;
  const tone = filesUnverified ? AMBER : filesChecking ? GREY : base.tone;
  const testId = filesUnverified
    ? 'ask-block-label-files-unverified'
    : filesChecking
      ? 'ask-block-label-files-checking'
      : `ask-block-label-${kind}`;
  return (
    <span
      data-testid={testId}
      style={{
        alignSelf: 'flex-start',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 999,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        color: tone.fg,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0,
        textTransform: 'none',
      }}
    >
      <Icon
        size={12}
        strokeWidth={2}
        {...(filesChecking ? { className: 'animate-spin' } : {})}
        style={{ flex: 'none' }}
      />
      {text}
    </span>
  );
}

const footerBoxStyle = (tone: {
  fg: string;
  bg: string;
  border: string;
}): CSSProperties => ({
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  padding: '9px 12px',
  borderRadius: 10,
  background: tone.bg,
  border: `1px solid ${tone.border}`,
  fontSize: '12.5px',
  lineHeight: 1.5,
  color: tone.fg,
});

const tallyPillStyle = (tone: {
  fg: string;
  bg: string;
  border: string;
}): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  padding: '7px 12px',
  borderRadius: 999,
  background: tone.bg,
  border: `1px solid ${tone.border}`,
  fontSize: '12.5px',
  fontWeight: 600,
  color: tone.fg,
});

export function AnswerBlocks({
  blocks,
  selected,
  onSelect,
  onOpenSourcesPanel,
  onOpenFileAtPath,
  onAuditLog,
}: {
  blocks: AnswerBlock[];
  selected: number | null;
  onSelect: (n: number) => void;
  /** Open the Ask sources rail for this answer. When omitted, the tally renders as plain status text. */
  onOpenSourcesPanel?: () => void;
  onOpenFileAtPath?: (
    path: string,
    paragraphIndex: number,
    snippet?: string,
    matterId?: string
  ) => void;
  /** When provided, each automatic real-verification result this surface
   *  triggers emits a `citation_verified` audit entry (same as SourcePanel —
   *  the shared store guarantees each citation is checked and audited once). */
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
}) {
  const { t } = useTranslation();
  const tally = tallyBlocks(blocks);
  // lp/badge-consistency: the verified/unverified split shown here comes from
  // the LIVE backend verifier — the SAME per-citation verdicts the Sources
  // cards render (shared store; SourcePanel may be hidden at narrow widths,
  // so this surface triggers the check itself — deduped globally). It updates
  // the moment verification completes, so the header can never sit on amber
  // while the cards read green (dry-run Run-2 finding, evidence run2-06).
  const allCitations = blocks.flatMap((b) =>
    b.kind === 'files' ? b.citations : []
  );
  const verdicts = useCitationVerification(allCitations, onAuditLog);
  const stateOf = (c: AnswerCitation): CitationTrustState =>
    citationTrustState(c, verdicts);
  const trust = tallyCitationTrust(blocks, stateOf);
  // Pure-files answer (cited, no general/draft/nothing-found): show the original
  // green attestation box so a cited-only answer reads exactly as before.
  // B1: only when EVERY cited claim is actually LIVE-VERIFIED — a "source
  // found, not verified" or still-checking claim must never earn "every cited
  // claim can be checked against the source".
  const pureFiles =
    tally.citedClaims > 0 &&
    trust.verified === tally.citedClaims &&
    !tally.hasGeneral &&
    !tally.hasDraft &&
    !tally.hasNothingFound;
  const citedTallyText = t('ask.answer-blocks.tally.cited-claims', { count: trust.verified });
  const showGeneralVerifyLine = tally.hasGeneral && tally.citedClaims > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {blocks.map((block, i) => (
        <div
          key={i}
          style={{ display: 'flex', flexDirection: 'column', gap: 9 }}
          data-testid={`ask-block-${block.kind}`}
        >
          <BlockLabel
            kind={block.kind}
            trust={filesBlockTrustState(block, stateOf)}
          />
          {block.text && (
            <CitationText
              text={block.text}
              citations={block.citations}
              selected={selected}
              onSelect={onSelect}
              {...(onOpenFileAtPath !== undefined ? { onOpenFileAtPath } : {})}
            />
          )}

          {/* Per-block footers — the quiet trust lines that live with each block. */}
          {block.kind === 'general' && showGeneralVerifyLine && (
            <TrustNote
              data-testid="ask-general-verifyline"
              icon={Info}
            >
              {t('ask.answer-blocks.general-verifyline')}
            </TrustNote>
          )}
          {block.kind === 'draft' && (
            <div data-testid="ask-draft-note" style={footerBoxStyle(BLUE)}>
              <PencilLine
                size={13}
                strokeWidth={2}
                style={{ flex: 'none', marginTop: 1 }}
              />
              <span>{t('ask.answer-blocks.draft-note')}</span>
            </div>
          )}
        </div>
      ))}

      {/* Per-answer footer — the honest tally of what the whole answer is built from. */}
      {pureFiles ? (
        <TrustNote
          data-testid="ask-cited-attestation"
          icon={ShieldCheck}
          style={{ fontWeight: 600 }}
        >
          {t('ask.answer-blocks.cited-attestation')}
        </TrustNote>
      ) : (
        (tally.citedClaims > 0 ||
          tally.hasGeneral ||
          tally.hasNothingFound) && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 9,
              alignItems: 'center',
            }}
          >
            {trust.verified > 0 && (
              onOpenSourcesPanel ? (
                <button
                  type="button"
                  data-testid="ask-tally-cited"
                  title={t('ask.answer-blocks.show-cited-files')}
                  className="transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  onClick={onOpenSourcesPanel}
                  style={{ ...tallyPillStyle(FILES), cursor: 'pointer' }}
                >
                  <ShieldCheck
                    size={13}
                    strokeWidth={2}
                    style={{ flex: 'none' }}
                  />
                  {citedTallyText}
                </button>
              ) : (
                <span data-testid="ask-tally-cited" style={tallyPillStyle(FILES)}>
                  <ShieldCheck
                    size={13}
                    strokeWidth={2}
                    style={{ flex: 'none' }}
                  />
                  {citedTallyText}
                </span>
              )
            )}
            {/* Live check still in flight — say so instead of a premature
                verdict (mirrors the card's spinner), then settle green/amber. */}
            {trust.checking > 0 && (
              <span
                data-testid="ask-tally-checking"
                style={tallyPillStyle(GREY)}
              >
                <Loader2
                  size={13}
                  strokeWidth={2}
                  className="animate-spin"
                  style={{ flex: 'none' }}
                />
                {t('ask.answer-blocks.tally.checking-sources', { count: trust.checking })}
              </span>
            )}
            {/* B1: claims the live check has not confirmed are shown honestly
                as "found, not verified" — never folded into the green "cited
                from your files" count. */}
            {trust.unverified > 0 && (
              <span
                data-testid="ask-tally-unverified"
                style={tallyPillStyle(AMBER)}
              >
                <ShieldAlert
                  size={13}
                  strokeWidth={2}
                  style={{ flex: 'none' }}
                />
                {t('ask.answer-blocks.tally.sources-unverified', { count: trust.unverified })}
              </span>
            )}
            {tally.hasGeneral && (
              <span
                data-testid="ask-tally-general"
                style={tallyPillStyle(GREY)}
              >
                <Info size={13} strokeWidth={2} style={{ flex: 'none' }} />
                {t('ask.answer-blocks.tally.general')}
              </span>
            )}
          </div>
        )
      )}

      {/* Nothing-found answers get one extra line making the boundary unmissable:
          the guidance below the gap is general knowledge, not the client's records. */}
      {tally.hasNothingFound && tally.hasGeneral && (
        <div data-testid="ask-nothingfound-note" style={footerBoxStyle(GREY)}>
          <Info
            size={13}
            strokeWidth={2}
            style={{ flex: 'none', marginTop: 1 }}
          />
          <span>{t('ask.answer-blocks.nothing-found-note')}</span>
        </div>
      )}
    </div>
  );
}

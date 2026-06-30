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
import { ShieldCheck, Info, PencilLine, Search } from 'lucide-react';
import type { AnswerBlock, AnswerBlockKind } from './askHelpers';
import { tallyBlocks } from './answerBlocks';
import { CitationText } from './CitationText';

/* eslint-disable lantern-i18n/no-hardcoded-string -- design copy matching the approved mockups; localized later with the rest of the surface */

const FILES = { fg: '#16654a', bg: '#e6f5ee', border: '#8fc9b0' };
const GREY = { fg: 'var(--kp-text-dim)', bg: 'var(--kp-bg-soft)', border: 'var(--kp-divider-strong)' };
const BLUE = { fg: 'var(--kp-accent)', bg: 'var(--kp-accent-soft)', border: 'var(--kp-action-border)' };

interface LabelDef {
  text: string;
  Icon: typeof ShieldCheck;
  tone: { fg: string; bg: string; border: string };
}

const LABELS: Record<AnswerBlockKind, LabelDef> = {
  files: { text: 'From your files', Icon: ShieldCheck, tone: FILES },
  'nothing-found': { text: 'From your files — nothing found', Icon: Search, tone: GREY },
  general: { text: 'General guidance', Icon: Info, tone: GREY },
  draft: { text: 'Draft', Icon: PencilLine, tone: BLUE },
};

function BlockLabel({ kind }: { kind: AnswerBlockKind }) {
  const { text, Icon, tone } = LABELS[kind];
  return (
    <span
      data-testid={`ask-block-label-${kind}`}
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
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      <Icon size={12} strokeWidth={2} style={{ flex: 'none' }} />
      {text}
    </span>
  );
}

const footerBoxStyle = (tone: { fg: string; bg: string; border: string }): CSSProperties => ({
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

const tallyPillStyle = (tone: { fg: string; bg: string; border: string }): CSSProperties => ({
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
  onOpenFileAtPath,
}: {
  blocks: AnswerBlock[];
  selected: number | null;
  onSelect: (n: number) => void;
  onOpenFileAtPath?: (path: string, paragraphIndex: number, snippet?: string) => void;
}) {
  const tally = tallyBlocks(blocks);
  // Pure-files answer (cited, no general/draft/nothing-found): show the original
  // green attestation box so a cited-only answer reads exactly as before.
  const pureFiles =
    tally.citedClaims > 0 && !tally.hasGeneral && !tally.hasDraft && !tally.hasNothingFound;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {blocks.map((block, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 9 }} data-testid={`ask-block-${block.kind}`}>
          <BlockLabel kind={block.kind} />
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
          {block.kind === 'general' && (
            <div data-testid="ask-general-verifyline" style={{ ...footerBoxStyle(GREY), background: 'transparent', border: 'none', padding: '0 0 0 2px', color: 'var(--kp-text-faint)', fontStyle: 'normal' }}>
              <Info size={13} strokeWidth={2} style={{ flex: 'none', marginTop: 1 }} />
              <span>General knowledge, not from your files — rules and limits change; confirm current figures before you advise.</span>
            </div>
          )}
          {block.kind === 'draft' && (
            <div data-testid="ask-draft-note" style={footerBoxStyle(BLUE)}>
              <PencilLine size={13} strokeWidth={2} style={{ flex: 'none', marginTop: 1 }} />
              <span>Draft for you to review before sending. Nothing is sent automatically.</span>
            </div>
          )}
        </div>
      ))}

      {/* Per-answer footer — the honest tally of what the whole answer is built from. */}
      {pureFiles ? (
        <div data-testid="ask-cited-attestation" style={{ ...footerBoxStyle(FILES), fontWeight: 600 }}>
          <ShieldCheck size={14} strokeWidth={2} style={{ flex: 'none', marginTop: 1 }} />
          <span>Answered over your own files. Every cited claim can be checked against the source.</span>
        </div>
      ) : (
        (tally.citedClaims > 0 || tally.hasGeneral || tally.hasNothingFound) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, alignItems: 'center' }}>
            {tally.citedClaims > 0 && (
              <span data-testid="ask-tally-cited" style={tallyPillStyle(FILES)}>
                <ShieldCheck size={13} strokeWidth={2} style={{ flex: 'none' }} />
                {tally.citedClaims === 1
                  ? '1 claim cited from your files'
                  : `${String(tally.citedClaims)} claims cited from your files`}
              </span>
            )}
            {tally.hasGeneral && (
              <span data-testid="ask-tally-general" style={tallyPillStyle(GREY)}>
                <Info size={13} strokeWidth={2} style={{ flex: 'none' }} />
                General guidance · verify current rules
              </span>
            )}
          </div>
        )
      )}

      {/* Nothing-found answers get one extra line making the boundary unmissable:
          the guidance below the gap is general knowledge, not the client's records. */}
      {tally.hasNothingFound && tally.hasGeneral && (
        <div data-testid="ask-nothingfound-note" style={footerBoxStyle(GREY)}>
          <Info size={13} strokeWidth={2} style={{ flex: 'none', marginTop: 1 }} />
          <span>Nothing found in your files. The guidance above is general knowledge, clearly marked — not from this client&apos;s records.</span>
        </div>
      )}
    </div>
  );
}

/* eslint-enable lantern-i18n/no-hardcoded-string */

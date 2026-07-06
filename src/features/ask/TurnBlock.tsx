import { Quote, Loader2, ShieldCheck, Save, AlertTriangle, Info, Clock } from 'lucide-react';
import { Button, Callout } from '@/ui/kp';
import type { AskTurn } from './askHelpers';
import { CitationText } from './CitationText';
import { NO_EVIDENCE_DECLINE } from './askPrompt';
import { AnswerBlocks } from './AnswerBlocks';
import { stripBlockMarkers } from './answerBlockMarkers';
import { stalePlanNotices, formatExportDate } from '@/platform/rag/sourceProvenance';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { EXTERNAL_EXPORT_STALE_DAYS_KEY } from '@/platform/settings/schema';
import { ASK_ANSWER_STALL_WARNING } from './askTimeout';

/* -------------------------------------------------------------------------- */
/* TurnBlock — renders a single completed or streaming Q+A pair               */
/* -------------------------------------------------------------------------- */

export function TurnBlock({
  turn,
  turnIdx,
  selectedTurnIdx,
  selected,
  onCitationSelect,
  onSaveToDocument,
  isSaving,
  isPersisted,
  isStreaming = false,
  answerStalled = false,
  onOpenAiStatus,
  onOpenFileAtPath,
}: {
  turn: AskTurn;
  turnIdx: number;
  selectedTurnIdx: number | null;
  selected: number | null;
  onCitationSelect: (turnIdx: number, n: number) => void;
  onSaveToDocument?: ((idx: number, content: string) => Promise<void>) | undefined;
  isSaving: boolean;
  isPersisted: boolean;
  isStreaming?: boolean;
  /**
   * QA-7 — true once the answer stage has gone a while with no token, so the
   * spinner can say so instead of sitting silently. Only meaningful while
   * `isStreaming && !turn.answer`.
   */
  answerStalled?: boolean;
  /** QA-7 — "View AI status" link shown alongside the stalled warning. */
  onOpenAiStatus?: () => void;
  /**
   * WS3 (Task 2): when provided, citation chip clicks open the file at
   * the cited paragraph in the editor — single-click navigation.
   */
  onOpenFileAtPath?: (path: string, paragraphIndex: number, snippet?: string) => void;
}) {
  const isThisTurnSelected = selectedTurnIdx === turnIdx;
  const selectedForThisTurn = isThisTurnSelected ? selected : null;

  // Ask-smart: a completed turn produced by the source-aware agent carries
  // provenance blocks; render those with their labels + per-answer tally instead
  // of the flat CitationText + single green/uncited attestation. Files-only,
  // demo (files-only), and legacy turns have no blocks and use the flat path.
  const usingBlocks = !isStreaming && !!turn.blocks && turn.blocks.length > 0;

  // Connector-access: surface a deterministic freshness warning (not just the
  // model's prose) when this answer leaned on an exported plan snapshot that is
  // older than the configured limit, so a stale RightCapital plan is never
  // mistaken for live data. Driven by the turn's citations (populated for both
  // the flat and the block/smart-agent paths), so it fires regardless of render.
  const staleDays = useSettingsStore((s) => s.getSetting<number>(EXTERNAL_EXPORT_STALE_DAYS_KEY));
  const stalePlans = stalePlanNotices(
    turn.citations.map((c) => c.provenance),
    new Date(),
    staleDays,
  );

  // BUG-016: the "Answered over your own files" attestation must reflect a
  // grounded, verifiable citation — not merely the presence of any citation.
  // The Ask pipeline now drops citations that don't resolve to a retrieved
  // chunk, so every rendered citation is verified; this `.some(verified)` gate
  // is the defense-in-depth that guarantees an unverified citation can never
  // trigger the green banner (and that such an answer shows the uncited
  // warning instead).
  const hasGroundedCitation = turn.citations.some((c) => c.verified);

  // A deliberate "I couldn't find that in your files" decline is not an uncited
  // claim — it's the trust behaviour working. Show a calm "this is on purpose"
  // note instead of the red "verify this" warning the uncited path uses.
  const isDecline = turn.answer.trim() === NO_EVIDENCE_DECLINE;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)' }}>
      {/* The question, echoed at the top in grey italic with a quote mark. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
        }}
      >
        <Quote
          size={14}
          strokeWidth={1.75}
          style={{ color: 'var(--kp-text-faint)', marginTop: 4, flex: 'none' }}
        />
        <span
          style={{
            fontSize: '14.5px',
            color: 'var(--kp-text-dim)',
            fontStyle: 'italic',
            lineHeight: 1.5,
          }}
        >
          {turn.question}
        </span>
      </div>

      {/* Answer — sections with bold lead-ins, green numbered citation chips,
          and (for drafts) a clean email card. */}
      <div
        style={{
          paddingLeft: 23,
          display: 'flex',
          flexDirection: 'column',
          gap: 13,
        }}
      >
        {isStreaming && !turn.answer ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--kp-text-dim)', fontSize: '14.5px' }}>
            <Loader2 size={14} strokeWidth={2} className="animate-spin" />
            <span>Answering…</span>
          </div>
        ) : usingBlocks ? (
          // Source-aware agent: labelled provenance blocks + per-answer tally.
          <AnswerBlocks
            blocks={turn.blocks ?? []}
            selected={selectedForThisTurn}
            onSelect={(n) => { onCitationSelect(turnIdx, n); }}
            {...(onOpenFileAtPath !== undefined ? { onOpenFileAtPath } : {})}
          />
        ) : isPersisted ? (
          // Persisted (loaded history) turns: plain text.
          <p style={{ fontSize: '15.5px', lineHeight: 1.62, color: 'var(--kp-navy)', margin: 0, whiteSpace: 'pre-wrap' }}>
            {turn.answer}
          </p>
        ) : (
          <CitationText
            // While streaming, the raw answer may carry block markers
            // ([[BLOCK:…]]); strip them so they never flash on screen before the
            // completed turn swaps to the labelled block view.
            text={isStreaming ? stripBlockMarkers(turn.answer) : turn.answer}
            citations={turn.citations}
            selected={selectedForThisTurn}
            onSelect={(n) => { onCitationSelect(turnIdx, n); }}
            {...(onOpenFileAtPath !== undefined ? { onOpenFileAtPath } : {})}
          />
        )}

        {/* QA-7 (P2 follow-up): the watchdog re-arms on every streamed chunk,
            so a stream that emits SOME text and then goes silent also sets
            answerStalled — not just the pre-first-token case above. Without
            this, the user would stare at frozen partial text with no
            feedback until the 45s hard timeout. Rendered once, after
            whichever answer view is showing (spinner or partial text), so
            it covers both the empty and the partial-answer stall. */}
        {isStreaming && answerStalled && (
          <div data-testid="ask-answer-stalled-warning">
            <Callout variant="warning" icon={AlertTriangle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>{ASK_ANSWER_STALL_WARNING}</span>
                {onOpenAiStatus && (
                  <Button variant="secondary" size="sm" onClick={onOpenAiStatus}>
                    {/* eslint-disable lantern-i18n/no-hardcoded-string */}
                    View AI status
                    {/* eslint-enable lantern-i18n/no-hardcoded-string */}
                  </Button>
                )}
              </div>
            </Callout>
          </div>
        )}

        {/* Privacy attestation (completed cited turns only) — FLAT path only;
            the block renderer shows its own attestation/tally.
            A2: shown only when citations exist, so it is never contradicted
            by the "No indexed sources" note below — the two are mutually exclusive.
            WS3: add data-testid so tests can assert its presence. */}
        {!usingBlocks && !isStreaming && turn.answer && hasGroundedCitation && (
          <div
            data-testid="ask-cited-attestation"
            style={{
              padding: '9px 12px',
              borderRadius: 10,
              background: '#e6f5ee',
              border: '1px solid #8fc9b0',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              fontSize: '12.5px',
              fontWeight: 600,
              color: '#16654a',
            }}
          >
            <ShieldCheck size={14} strokeWidth={2} style={{ flex: 'none', color: '#16654a' }} />
            {/* eslint-disable lantern-i18n/no-hardcoded-string */}
            Answered over your own files. Every cited claim has a source you can open and check.
            {/* eslint-enable lantern-i18n/no-hardcoded-string */}
          </div>
        )}

        {/* Deliberate decline: Ask found nothing in the files and said so. This
            is the trust behaviour working, not a weak answer — show a calm note
            that it's on purpose (it only answers from your files). Takes the
            place of the red uncited warning for this one exact answer.
            FLAT path only — a smart-mode answer self-labels via its blocks (a
            smart "nothing found" is a nothing-found BLOCK, not this decline). */}
        {!usingBlocks && !isStreaming && isDecline && (
          <div
            data-testid="ask-decline-note"
            style={{
              padding: '9px 12px',
              borderRadius: 10,
              background: '#eef2f7',
              border: '1px solid #c3ccd6',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              fontSize: '12.5px',
              color: 'var(--kp-text-dim)',
            }}
          >
            <Info size={14} strokeWidth={2} style={{ flex: 'none', color: 'var(--kp-text-dim)' }} />
            {/* eslint-disable lantern-i18n/no-hardcoded-string */}
            This is on purpose — I only answer from your files, never from general knowledge. Ask about something in this household and I'll cite the source.
            {/* eslint-enable lantern-i18n/no-hardcoded-string */}
          </div>
        )}

        {/* WS3 (Task 3): uncited warning — upgraded from a muted one-liner to a
            visible Callout so an uncited answer looks clearly LESS trustworthy
            than a cited one. Mutually exclusive with the attestation above.
            A2 guarantee preserved: only shown when there are no citations. The
            deliberate decline is excluded — it has its own calm note above.
            FLAT path only — a smart-mode answer is self-labelling by block, so
            the blanket "not cited" warning would be wrong over a general/draft. */}
        {!usingBlocks && !isStreaming && !hasGroundedCitation && turn.answer && !isDecline && (
          <div data-testid="ask-uncited-warning">
            <Callout variant="warning" icon={AlertTriangle}>
              {/* eslint-disable lantern-i18n/no-hardcoded-string */}
              Not cited from your files. Verify this before relying on it.
              {/* eslint-enable lantern-i18n/no-hardcoded-string */}
            </Callout>
          </div>
        )}

        {/* Connector-access: stale exported-plan warning. Shown when a cited
            source is a plan snapshot older than the limit. Treats a stale plan
            like a stale lab result so the snapshot is never read as live. */}
        {!isStreaming && turn.answer && stalePlans.length > 0 && (
          <div data-testid="ask-stale-plan-warning">
            <Callout variant="warning" icon={Clock}>
              {/* eslint-disable lantern-i18n/no-hardcoded-string */}
              This answer relies on exported plan snapshots that may be out of date:{' '}
              {stalePlans.map((s, i) => (
                <span key={`${s.toolLabel}-${s.exportedAt}`}>
                  {i > 0 ? ', ' : ''}
                  {s.toolLabel} plan from {formatExportDate(s.exportedAt)} ({s.ageDays} days ago)
                </span>
              ))}
              . A plan is a point-in-time snapshot, so figures may be out of date. Re-export the
              latest to refresh it.
              {/* eslint-enable lantern-i18n/no-hardcoded-string */}
            </Callout>
          </div>
        )}

        {/* Save to document button */}
        {!isStreaming && turn.answer && onSaveToDocument && (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={Save}
            loading={isSaving}
            onClick={() => void onSaveToDocument(turnIdx, turn.answer)}
            style={{ alignSelf: 'flex-start' }}
          >
            {/* eslint-disable lantern-i18n/no-hardcoded-string */}
            {isSaving ? 'Saving…' : 'Save to document'}
            {/* eslint-enable lantern-i18n/no-hardcoded-string */}
          </Button>
        )}
      </div>
    </div>
  );
}

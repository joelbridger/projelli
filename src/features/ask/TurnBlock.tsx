import {
  Loader2,
  ShieldCheck,
  Save,
  AlertTriangle,
  Info,
  Clock,
  Download,
  MoreHorizontal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Callout, IconButton, TrustNote } from '@/ui/kp';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import type { AuditEntry } from '@/platform/types/audit';
import type { AskScope, AskTurn } from './askHelpers';
import { CitationText } from './CitationText';
import { NO_EVIDENCE_DECLINE, STILL_IMPORTING_DECLINE } from './askPrompt';
import { AnswerBlocks } from './AnswerBlocks';
import { stripBlockMarkers } from './answerBlockMarkers';
import {
  stalePlanNotices,
  formatExportDate,
} from '@/platform/rag/sourceProvenance';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { EXTERNAL_EXPORT_STALE_DAYS_KEY } from '@/platform/settings/schema';
import {
  ASK_ANSWER_STALL_WARNING,
  ASK_LOCAL_AI_STARTING_MESSAGE,
  ASK_LOCAL_AI_EVALUATING_MESSAGE,
} from './askTimeout';

/* -------------------------------------------------------------------------- */
/* TurnBlock — renders a single completed or streaming Q+A pair               */
/* -------------------------------------------------------------------------- */

export function TurnBlock({
  turn,
  turnIdx,
  selectedTurnIdx,
  selected,
  onCitationSelect,
  onOpenSourcesPanel,
  onSaveToDocument,
  isSaving,
  isPersisted,
  isStreaming = false,
  answerStalled = false,
  localAiStarting = false,
  localEvaluating = false,
  onOpenAiStatus,
  onOpenFileAtPath,
  onAuditLog,
  askScope,
}: {
  turn: AskTurn;
  turnIdx: number;
  selectedTurnIdx: number | null;
  selected: number | null;
  onCitationSelect: (turnIdx: number, n: number) => void;
  /** Open the right-side Sources panel for this answer's cited files. */
  onOpenSourcesPanel?: (turnIdx: number) => void;
  onSaveToDocument?:
    | ((idx: number, content: string) => Promise<void>)
    | undefined;
  isSaving: boolean;
  isPersisted: boolean;
  isStreaming?: boolean;
  /**
   * QA-7 — true once the answer stage has gone a while with no token, so the
   * spinner can say so instead of sitting silently. Only meaningful while
   * `isStreaming && !turn.answer`.
   */
  answerStalled?: boolean;
  /**
   * Fix 1b — true while THIS send is waiting for the embedded llama-server
   * sidecar to become healthy, before the no-token watchdog is even armed.
   * Takes over the pre-first-token spinner with an honest "Local AI is
   * starting…" message instead of the generic "Answering…" (this is an
   * expected wait, not a stall, so `answerStalled`'s warning copy never
   * applies at the same time).
   */
  localAiStarting?: boolean;
  /**
   * lp/localai-patience — true while THIS Local-only send is prompt-evaluating
   * (the engine is up and reading the retrieved documents) BEFORE its first
   * token. A bigger question can legitimately take a minute or two of CPU
   * prompt-eval, so the pre-first-token spinner shows a calm "reading your
   * documents" message instead of "Answering…", and the alarming stalled
   * warning is suppressed until the prompt-scaled budget is actually exceeded.
   * Distinct from `localAiStarting` (engine not up yet) — that one wins if both
   * are somehow set.
   */
  localEvaluating?: boolean;
  /** QA-7 — "View AI status" link shown alongside the stalled warning. */
  onOpenAiStatus?: () => void;
  /**
   * WS3 (Task 2): when provided, citation chip clicks open the file at
   * the cited paragraph in the editor — single-click navigation.
   */
  onOpenFileAtPath?: (
    path: string,
    paragraphIndex: number,
    snippet?: string,
    matterId?: string
  ) => void;
  /**
   * lp/badge-consistency: forwarded to AnswerBlocks, whose header/labels now
   * trigger the same live citation check the Sources cards use (shared store,
   * deduped) — so a check first issued here still lands on the audit log.
   */
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  askScope?: AskScope;
}) {
  const { t } = useTranslation();
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
  const staleDays = useSettingsStore((s) =>
    s.getSetting<number>(EXTERNAL_EXPORT_STALE_DAYS_KEY)
  );
  const stalePlans = stalePlanNotices(
    turn.citations.map((c) => c.provenance),
    new Date(),
    staleDays
  );
  const stalePlanSummary = stalePlans.map((s) => (
    `${s.toolLabel}, ${formatExportDate(s.exportedAt)} (${t('ask.turn.stale-plan-age', { count: s.ageDays })})`
  )).join(', ');

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
  // QA-90: same idea, for the "zero hits while an import is active" decline —
  // a calm, reassuring note (data may just not be in yet), never the red
  // uncited-claim warning.
  const isStillImportingDecline =
    turn.answer.trim() === STILL_IMPORTING_DECLINE;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--kp-space-sm)',
      }}
    >
      <div style={{ fontSize: '14px', color: 'var(--kp-text-dim)', lineHeight: 1.45 }}>
        {turn.question}
      </div>

      {/* Answer — sections with bold lead-ins, green numbered citation chips,
          and (for drafts) a clean email card. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 13,
        }}
      >
        {isStreaming && !turn.answer ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--kp-text-dim)',
              fontSize: '14.5px',
            }}
          >
            <Loader2 size={14} strokeWidth={2} className="animate-spin" />
            <span>
              {localAiStarting
                ? ASK_LOCAL_AI_STARTING_MESSAGE
                : localEvaluating
                  ? ASK_LOCAL_AI_EVALUATING_MESSAGE
                  : t('ask.action.answering')}
            </span>
          </div>
        ) : usingBlocks ? (
          // Source-aware agent: labelled provenance blocks + per-answer tally.
          <AnswerBlocks
            blocks={turn.blocks ?? []}
            selected={selectedForThisTurn}
            onSelect={(n) => {
              onCitationSelect(turnIdx, n);
            }}
            {...(onOpenSourcesPanel !== undefined
              ? { onOpenSourcesPanel: () => { onOpenSourcesPanel(turnIdx); } }
              : {})}
            {...(onOpenFileAtPath !== undefined ? { onOpenFileAtPath } : {})}
            {...(onAuditLog !== undefined ? { onAuditLog } : {})}
          />
        ) : isPersisted ? (
          // Persisted (loaded history) turns: plain text.
          <p
            style={{
              fontSize: '15.5px',
              lineHeight: 1.62,
              color: 'var(--kp-navy)',
              margin: 0,
              whiteSpace: 'pre-wrap',
            }}
          >
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
            onSelect={(n) => {
              onCitationSelect(turnIdx, n);
            }}
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
        {isStreaming && answerStalled && !localEvaluating && (
          <div data-testid="ask-answer-stalled-warning">
            <Callout variant="warning" icon={AlertTriangle}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span>{ASK_ANSWER_STALL_WARNING}</span>
                {onOpenAiStatus && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onOpenAiStatus}
                  >
                    {t('ask.turn.view-ai-status')}
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
          <TrustNote
            data-testid="ask-cited-attestation"
            icon={ShieldCheck}
            style={{ fontWeight: 600 }}
          >
            {t('ask.answer-blocks.cited-attestation')}
          </TrustNote>
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
            <Info
              size={14}
              strokeWidth={2}
              style={{ flex: 'none', color: 'var(--kp-text-dim)' }}
            />
            {t(askScope === 'all-matters' ? 'ask.turn.decline-note-all' : 'ask.turn.decline-note-client')}
          </div>
        )}

        {/* QA-90: same idea as the decline note above, for the "zero hits while
            an active import" case — a calm, reassuring note that data may just
            not be indexed yet, never the red uncited-claim warning below. */}
        {!usingBlocks && !isStreaming && isStillImportingDecline && (
          <div
            data-testid="ask-still-importing-decline-note"
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
            <Download
              size={14}
              strokeWidth={2}
              style={{ flex: 'none', color: 'var(--kp-text-dim)' }}
            />
            {t('ask.turn.still-importing-decline')}
          </div>
        )}

        {/* WS3 (Task 3): uncited warning — upgraded from a muted one-liner to a
            visible Callout so an uncited answer looks clearly LESS trustworthy
            than a cited one. Mutually exclusive with the attestation above.
            A2 guarantee preserved: only shown when there are no citations. The
            deliberate decline is excluded — it has its own calm note above.
            FLAT path only — a smart-mode answer is self-labelling by block, so
            the blanket "not cited" warning would be wrong over a general/draft. */}
        {!usingBlocks &&
          !isStreaming &&
          !hasGroundedCitation &&
          turn.answer &&
          !isDecline &&
          !isStillImportingDecline && (
            <div data-testid="ask-uncited-warning">
              <Callout variant="warning" icon={AlertTriangle}>
                {t('ask.turn.uncited-warning')}
              </Callout>
            </div>
          )}

        {/* Connector-access: stale exported-plan warning. Shown when a cited
            source is a plan snapshot older than the limit. Treats a stale plan
            like a stale lab result so the snapshot is never read as live. */}
        {!isStreaming && turn.answer && stalePlans.length > 0 && (
          <div data-testid="ask-stale-plan-warning">
            <Callout variant="warning" icon={Clock}>
              {t('ask.turn.stale-plan-warning', { exports: stalePlanSummary })}
            </Callout>
          </div>
        )}

        {!isStreaming && turn.answer && onSaveToDocument && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  icon={MoreHorizontal}
                  label={t('ask.turn.answer-actions')}
                  size="sm"
                  variant="ghost"
                  data-testid="ask-answer-actions-menu"
                  disabled={isSaving}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  data-testid="ask-save-to-document"
                  disabled={isSaving}
                  onSelect={() => { void onSaveToDocument(turnIdx, turn.answer); }}
                >
                  <Save className="mr-2 h-3.5 w-3.5" strokeWidth={1.75} />
                  {isSaving ? t('ask.turn.saving') : t('ask.turn.save-to-doc')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
}

import { Quote, Loader2, ShieldCheck, Save, AlertTriangle } from 'lucide-react';
import { Button, Callout } from '@/ui/kp';
import type { AskTurn } from './askHelpers';
import { CitationText } from './CitationText';

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
   * WS3 (Task 2): when provided, citation chip clicks open the file at
   * the cited paragraph in the editor — single-click navigation.
   */
  onOpenFileAtPath?: (path: string, paragraphIndex: number, snippet?: string) => void;
}) {
  const isThisTurnSelected = selectedTurnIdx === turnIdx;
  const selectedForThisTurn = isThisTurnSelected ? selected : null;

  // BUG-016: the "Answered over your own files" attestation must reflect a
  // grounded, verifiable citation — not merely the presence of any citation.
  // The Ask pipeline now drops citations that don't resolve to a retrieved
  // chunk, so every rendered citation is verified; this `.some(verified)` gate
  // is the defense-in-depth that guarantees an unverified citation can never
  // trigger the green banner (and that such an answer shows the uncited
  // warning instead).
  const hasGroundedCitation = turn.citations.some((c) => c.verified);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)' }}>
      {/* User bubble */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--kp-space-xs)',
        }}
      >
        <Quote
          size={14}
          strokeWidth={1.75}
          style={{ color: 'var(--color-muted-foreground)', marginTop: 3, flex: 'none' }}
        />
        <span
          style={{
            fontSize: 'var(--kp-font-sm)',
            color: 'var(--color-muted-foreground)',
            fontStyle: 'italic',
            lineHeight: 'var(--kp-leading-normal)',
          }}
        >
          {turn.question}
        </span>
      </div>

      {/* Answer */}
      <div
        style={{
          paddingLeft: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--kp-space-sm)',
        }}
      >
        {isStreaming && !turn.answer ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-sm)' }}>
            <Loader2 size={14} strokeWidth={2} className="animate-spin" />
            <span>Answering…</span>
          </div>
        ) : isPersisted || turn.citations.length === 0 ? (
          // Persisted turns or no-citation turns: plain text
          <p style={{ fontSize: 'var(--kp-font-md)', lineHeight: 'var(--kp-leading-relaxed)', color: 'var(--color-foreground)', margin: 0 }}>
            {turn.answer}
          </p>
        ) : (
          <CitationText
            text={turn.answer}
            citations={turn.citations}
            selected={selectedForThisTurn}
            onSelect={(n) => { onCitationSelect(turnIdx, n); }}
            {...(onOpenFileAtPath !== undefined ? { onOpenFileAtPath } : {})}
          />
        )}

        {/* Privacy attestation (completed cited turns only).
            A2: shown only when citations exist, so it is never contradicted
            by the "No indexed sources" note below — the two are mutually exclusive.
            WS3: add data-testid so tests can assert its presence. */}
        {!isStreaming && turn.answer && hasGroundedCitation && (
          <div
            data-testid="ask-cited-attestation"
            style={{
              padding: '9px 12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--kp-local-bg)',
              border: '1px solid var(--kp-local-line)',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              fontSize: 'var(--kp-font-2xs)',
              color: 'var(--kp-local)',
            }}
          >
            <ShieldCheck size={14} strokeWidth={2} style={{ flex: 'none' }} />
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            Answered over your own files. Every cited claim can be checked against the source.
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
          </div>
        )}

        {/* WS3 (Task 3): uncited warning — upgraded from a muted one-liner to a
            visible Callout so an uncited answer looks clearly LESS trustworthy
            than a cited one. Mutually exclusive with the attestation above.
            A2 guarantee preserved: only shown when there are no citations. */}
        {!isStreaming && !hasGroundedCitation && turn.answer && (
          <div data-testid="ask-uncited-warning">
            <Callout variant="warning" icon={AlertTriangle}>
              {/* eslint-disable keepance-i18n/no-hardcoded-string */}
              Not cited from your files. Verify this before relying on it.
              {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            {isSaving ? 'Saving…' : 'Save to document'}
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
          </Button>
        )}
      </div>
    </div>
  );
}

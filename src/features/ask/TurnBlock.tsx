import { Quote, Loader2, ShieldCheck, Save } from 'lucide-react';
import { Button } from '@/ui/kp';
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
}) {
  const isThisTurnSelected = selectedTurnIdx === turnIdx;
  const selectedForThisTurn = isThisTurnSelected ? selected : null;

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
          />
        )}

        {/* Privacy attestation (completed cited turns only).
            A2: shown only when citations exist, so it is never contradicted
            by the "No indexed sources" note below — the two are mutually exclusive. */}
        {!isStreaming && turn.answer && turn.citations.length > 0 && (
          <div
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

        {/* No citations note — only shows when there are genuinely no citations.
            A2: mutually exclusive with the attestation above. */}
        {!isStreaming && turn.citations.length === 0 && turn.answer && (
          <div style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            No indexed sources were cited. Index your files to get click-to-verify answers.
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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

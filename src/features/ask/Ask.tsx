/**
 * Ask — multi-turn conversational cited-Ask surface.
 *
 * Each question carries prior turns as context (last 6 exchanges) injected
 * into the system prompt. RAG retrieval is fresh per turn. Conversation is
 * persisted via aiChatStore with chatId convention:
 *   "ask-<matterId>"  when a matter is active
 *   "ask-global"      otherwise
 *
 * Citation-first design: {n} chips + SourcePanel for every answer.
 * SourcePanel reflects the most recently clicked citation across the
 * entire conversation (selectedTurnIdx + selected pair).
 *
 * Scope toggle: users can point the Ask box at different slices of their data.
 *   - This matter  (when a matter is active)
 *   - All matters  (cross-matter search)
 *   - Email        (only mail: chunks)
 *   - Documents    (only non-mail: chunks)
 * Email/Documents are hidden on the sample matter so the demo chips stay front
 * and center.
 */

import {
  Sparkles, ArrowRight, AlertTriangle,
  MessageSquare, Plus,
} from 'lucide-react';
import { Button, Chip, Eyebrow, EmptyState, SurfaceToolbar, SearchField } from '@/ui/kp';
import { ScopeToggle } from './ScopeToggle';
import { SourcePanel } from './SourcePanel';
import { SampleBridgeCallout } from './SampleBridgeCallout';
import { TurnBlock } from './TurnBlock';
import { SAMPLE_MATTER_ID } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { isMemoryEnabled } from '@/platform/rag/MemoryService';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { EgressIndicator } from '@/platform/privacy/ui/EgressIndicator';
import { useAsk, type UseAskProps } from './useAsk';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';

/* -------------------------------------------------------------------------- */
/* Main component                                                               */
/* -------------------------------------------------------------------------- */

export function Ask(props: UseAskProps) {
  const { onSaveToDocument } = props;
  const entityLabel = useEntityLabel();
  // This surface is the 3-tab IA's "Ask" tab.
  const askVerb = 'Ask';
  const {
    activeMatter,
    isSampleMatterActive,
    demoQuestions,
    chatId,
    askScope,
    setAskScope,
    turns,
    streamingTurn,
    question,
    setQuestion,
    selected,
    selectedTurnIdx,
    errorMsg,
    status,
    savingIdx,
    displayedProvider,
    confidentialityMode,
    bottomRef,
    composerInputRef,
    recentSessions,
    matterRecentSessions,
    selectedCite,
    anyHasCitations,
    handleCitationSelect,
    handleNewAsk,
    handleLoadSession,
    handleAsk,
    handleKeyDown,
    handleSaveToDocument,
    onOpenFileAtPath,
    isBusy,
  } = useAsk(props);

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-background)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: 'var(--kp-surface-header-pad)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <SurfaceHeader
          Icon={Sparkles}
          title="Ask"
          description="Ask anything across your work. Every answer cites its source."
        />
      </div>

      {/* Toolbar: New question/search (button) -> scope (filters) -> field + submit */}
      <SurfaceToolbar>
        {turns.length > 0 && (
          <Button variant="secondary" size="md" iconLeft={Plus} onClick={handleNewAsk}>
            New question
          </Button>
        )}
        <ScopeToggle
          scope={askScope}
          onChange={setAskScope}
          hasMatter={!!activeMatter}
          isSample={isSampleMatterActive}
        />
        <SearchField
          ref={composerInputRef}
          icon={Sparkles}
          value={question}
          onChange={(v) => { setQuestion(v); }}
          onKeyDown={handleKeyDown}
          placeholder={
            askScope === 'email'
              ? 'Ask about your imported email…'
              : askScope === 'documents'
                ? 'Ask across your documents…'
                : activeMatter
                  ? `${askVerb} ${matterLabel(activeMatter)}…`
                  : `${askVerb} across all ${entityLabel.other}…`
          }
          disabled={isBusy}
          aria-label={`${askVerb} this ${entityLabel.one}`}
          data-testid="ask-composer-input"
          size="md"
          style={{ flex: 1, minWidth: 240 }}
        />
        <Button
          variant="primary"
          size="md"
          onClick={() => void handleAsk()}
          disabled={isBusy || !question.trim()}
          loading={isBusy}
          iconLeft={isBusy ? undefined : ArrowRight}
          aria-label={status === 'retrieving' ? 'Searching your documents' : status === 'answering' ? 'Answering' : undefined}
        >
          <span role={isBusy ? 'status' : undefined}>
            {status === 'retrieving' ? 'Searching…' : status === 'answering' ? 'Answering…' : askVerb}
          </span>
        </Button>
      </SurfaceToolbar>

      {/* Egress indicator — where this search's AI request goes. */}
      <div style={{ padding: 'var(--kp-space-xs) var(--kp-gutter)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <EgressIndicator provider={displayedProvider} mode={confidentialityMode} variant="full" />
      </div>

      {/* Recent sessions chips */}
      {/* Fix #4: show whenever there is at least one session other than the current
          one, so the first conversation is not hidden after switching away. */}
      {recentSessions.some((s) => s.chatId !== chatId) && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--kp-space-xs)',
            padding: 'var(--kp-space-xs) var(--kp-gutter)',
            overflowX: 'auto',
            flexShrink: 0,
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          {/* Fix #6: chips now show a date/time sub-label so similar-start sessions are distinguishable. */}
          {recentSessions.map(({ chatId: sid, label, dateLabel }) => (
            <Chip
              key={sid}
              size="sm"
              active={sid === chatId}
              icon={MessageSquare}
              onClick={() => { handleLoadSession(sid); }}
              style={{ flexShrink: 0, maxWidth: 260 }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                  {label.length > 48 ? `${label.slice(0, 48)}…` : label}
                </span>
                {dateLabel && (
                  <span style={{ fontSize: 'var(--kp-font-2xs)', opacity: 0.65, whiteSpace: 'nowrap' }}>
                    {dateLabel}
                  </span>
                )}
              </span>
            </Chip>
          ))}
        </div>
      )}

      {/* Main area: two-column grid (conversation | source panel) */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: anyHasCitations ? '1fr 260px' : '1fr',
          gap: 0,
          overflow: 'hidden',
        }}
      >
        {/* Left: scrollable conversation */}
        <div
          style={{
            overflowY: 'auto',
            padding: 'var(--kp-surface-gap) var(--kp-gutter) var(--kp-gutter)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--kp-stack-gap)',
            minWidth: 0,
          }}
        >
          {/* Empty state */}
          {turns.length === 0 && !streamingTurn && status !== 'error' && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--kp-space-sm)',
                padding: 'var(--kp-space-4xl) 0',
              }}
            >
              <EmptyState
                icon={Sparkles}
                iconSize={36}
                title="What do you want to find?"
                body={
                  activeMatter?.id === SAMPLE_MATTER_ID
                    ? `This is a sample ${entityLabel.one}. Click a question below and see a cited answer. Click any citation to read the exact passage.`
                    : 'Every answer shows the exact document and page it came from. Click any chip to read the passage.'
                }
                actions={
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--kp-space-xs)', justifyContent: 'center', maxWidth: 480 }}>
                    {(activeMatter?.id === SAMPLE_MATTER_ID
                      ? (demoQuestions as unknown as string[])
                      : [
                          `Summarize this ${entityLabel.one}`,
                          'Find all related emails',
                          'What client reviews are coming up?',
                        ]
                    ).map((example) => (
                      <Chip
                        key={example}
                        size="md"
                        onClick={() => {
                          // UX-28: a suggestion chip RUNS the search on click
                          // (it used to only fill the box for non-sample matters,
                          // which read as broken). Sample + real matters now behave
                          // the same.
                          void handleAsk(example);
                        }}
                      >
                        {example}
                      </Chip>
                    ))}
                  </div>
                }
              />
              {/* C1 — "Recent in this matter" for non-sample real matters */}
              {activeMatter && activeMatter.id !== SAMPLE_MATTER_ID && matterRecentSessions.length > 0 && (
                <div
                  data-testid="recent-in-matter"
                  style={{
                    marginTop: 'var(--kp-space-xs)',
                    width: '100%',
                    maxWidth: 380,
                    textAlign: 'left',
                  }}
                >
                  <Eyebrow style={{ marginBottom: 'var(--kp-space-xs)' }}>
                    {`Recent in this ${entityLabel.one}`}
                  </Eyebrow>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-2xs)' }}>
                    {/* Fix #6: each item shows the date/time sub-label so similar-start sessions are distinguishable. */}
                    {matterRecentSessions.map(({ chatId: sid, label, dateLabel }) => (
                      <button
                        key={sid}
                        type="button"
                        data-testid="matter-session-item"
                        onClick={() => { handleLoadSession(sid); }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--kp-space-xs)',
                          padding: 'var(--kp-space-xs) var(--kp-space-sm)',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--color-border)',
                          background: 'var(--color-background)',
                          color: 'var(--color-foreground)',
                          fontSize: 'var(--kp-font-xs)',
                          fontWeight: 'var(--kp-weight-regular)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          width: '100%',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-secondary)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-background)'; }}
                      >
                        <MessageSquare size={13} strokeWidth={1.75} style={{ color: 'var(--kp-navy)', flex: 'none', opacity: 0.55 }} />
                        <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {label.length > 60 ? `${label.slice(0, 60)}…` : label}
                          </span>
                          {dateLabel && (
                            <span style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)', marginTop: 1 }}>
                              {dateLabel}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* B2: bridge callout — only on sample matter, dismissible */}
              {activeMatter?.id === SAMPLE_MATTER_ID && (
                <SampleBridgeCallout />
              )}
            </div>
          )}

          {/* Fix #7: wrap conversation in aria-live region so screen readers announce completed answers. */}
          <div aria-live="polite" aria-atomic="false">
          {/* Completed turns */}
          {turns.map((turn, idx) => (
            <TurnBlock
              key={idx}
              turn={turn}
              turnIdx={idx}
              selectedTurnIdx={selectedTurnIdx}
              selected={selected}
              onCitationSelect={handleCitationSelect}
              onSaveToDocument={onSaveToDocument ? handleSaveToDocument : undefined}
              isSaving={savingIdx === idx}
              isPersisted={false}
              {...(onOpenFileAtPath !== undefined ? { onOpenFileAtPath } : {})}
            />
          ))}

          {/* Streaming turn */}
          {streamingTurn && (
            <TurnBlock
              key="streaming"
              turn={streamingTurn}
              turnIdx={turns.length}
              selectedTurnIdx={selectedTurnIdx}
              selected={selected}
              onCitationSelect={handleCitationSelect}
              onSaveToDocument={undefined}
              isSaving={false}
              isPersisted={false}
              isStreaming
              {...(onOpenFileAtPath !== undefined ? { onOpenFileAtPath } : {})}
            />
          )}
          </div>

          {/* B2: bridge callout below demo answers (sample matter with turns) */}
          {activeMatter?.id === SAMPLE_MATTER_ID && turns.length > 0 && !streamingTurn && (
            <SampleBridgeCallout />
          )}

          {/* Error — announced to assistive tech (acc-04 / UX-29). */}
          {status === 'error' && errorMsg && (
            <div
              role="status"
              aria-live="polite"
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                padding: '9px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--kp-danger-bg)',
                border: '1px solid rgba(176, 42, 31, 0.3)',
                fontSize: 'var(--kp-font-xs)',
                color: 'var(--kp-danger)',
              }}
            >
              <AlertTriangle size={15} strokeWidth={2} style={{ marginTop: 1, flex: 'none' }} />
              {errorMsg}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Right: sticky source panel */}
        {anyHasCitations && (
          <div
            style={{
              borderLeft: '1px solid var(--color-border)',
              padding: 'var(--kp-surface-gap) var(--kp-card-pad)',
              overflowY: 'auto',
              background: 'var(--color-background)',
            }}
          >
            <SourcePanel
              cite={selectedCite}
              {...(props.onAuditLog ? { onAuditLog: props.onAuditLog } : {})}
            />
          </div>
        )}
      </div>

      {/* Memory-off warning — Fix #5: now actionable with "Enable indexing" button. */}
      {!isMemoryEnabled() && turns.length === 0 && !streamingTurn && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            padding: 'var(--kp-space-xs) var(--kp-gutter)',
            fontSize: 'var(--kp-font-xs)',
            color: 'var(--kp-direct)',
            background: 'var(--kp-direct-bg)',
            borderTop: '1px solid var(--kp-direct-line)',
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          <AlertTriangle size={15} strokeWidth={2} style={{ flex: 'none' }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            Cited answers need your documents indexed on your machine. Enable it in Settings.
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('keepance:open-settings', { detail: { category: 'ai' } }));
            }}
            style={{ flexShrink: 0 }}
          >
            Enable indexing
          </Button>
        </div>
      )}

      {/* The composer moved into the toolbar above — the search field now sits
          next to the scope pills (search-first, matching the other tabs). */}
    </div>
  );
}

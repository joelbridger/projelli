/**
 * Ask — multi-turn conversational cited-Ask surface.
 *
 * Each question carries prior turns as context (last 6 exchanges) injected
 * into the system prompt. RAG retrieval is fresh per turn. Conversation is
 * persisted via aiChatStore with chatId convention:
 *   "ask-<matterId>"  when a matter is active
 *   "ask-global"      otherwise
 *
 * Layout (ChatGPT shape):
 *   - A persistent left rail (ConversationsRail) lists every saved conversation
 *     and is the single switcher — "New question" at the top, click-to-switch,
 *     the active thread highlighted, grouped by this client vs. everything else.
 *   - The composer (AskComposer) is BIG and CENTERED while the thread is empty,
 *     then drops to a sticky bottom bar once the thread has any turns. Both
 *     positions render the same controls (scope pills, input, submit, egress).
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
 */

import {
  Sparkles, AlertTriangle,
} from 'lucide-react';
import { Button, Chip, EmptyState } from '@/ui/kp';
import { SourcePanel } from './SourcePanel';
import { SampleBridgeCallout } from './SampleBridgeCallout';
import { TurnBlock } from './TurnBlock';
import { AskComposer } from './AskComposer';
import { ConversationsRail, type RailGroup } from './ConversationsRail';
import { SAMPLE_MATTER_ID } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { isMemoryEnabled } from '@/platform/rag/MemoryService';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
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
    railSessions,
    railCollapsed,
    toggleRailCollapsed,
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

  const isSampleMatter = activeMatter?.id === SAMPLE_MATTER_ID;
  // Empty thread => centered composer; any turn (or a first answer streaming)
  // => the composer has dropped to the sticky bottom bar.
  const isEmptyThread = turns.length === 0 && !streamingTurn;

  const composerPlaceholder =
    askScope === 'email'
      ? 'Ask about your imported email…'
      : askScope === 'documents'
        ? 'Ask across your documents…'
        : activeMatter
          ? `${askVerb} ${matterLabel(activeMatter)}…`
          : `${askVerb} across all ${entityLabel.other}…`;
  const composerAriaLabel = `${askVerb} this ${entityLabel.one}`;

  // Conversations-rail grouping. A session belongs to the active client when its
  // id is exactly "ask-<matterId>" or a timestamped variant "ask-<matterId>-…";
  // everything else (global + other clients) falls into the second group.
  const matterId = activeMatter?.id ?? null;
  const belongsToActiveClient = (sid: string): boolean =>
    matterId !== null && (sid === `ask-${matterId}` || sid.startsWith(`ask-${matterId}-`));
  const railGroups: RailGroup[] = matterId !== null
    ? [
        {
          key: 'this-client',
          title: `This ${entityLabel.one}`,
          items: railSessions.filter((s) => belongsToActiveClient(s.chatId)),
        },
        {
          key: 'other',
          title: 'Other conversations',
          items: railSessions.filter((s) => !belongsToActiveClient(s.chatId)),
        },
      ]
    : [{ key: 'all', title: null, items: railSessions }];

  // Shared composer props (the same controls, different position).
  const composerCommon = {
    askScope,
    setAskScope,
    hasMatter: !!activeMatter,
    isSample: isSampleMatter,
    inputRef: composerInputRef,
    question,
    onQuestionChange: (v: string) => { setQuestion(v); },
    onKeyDown: handleKeyDown,
    onSubmit: () => void handleAsk(),
    placeholder: composerPlaceholder,
    ariaLabel: composerAriaLabel,
    isBusy,
    status,
    submitLabel: askVerb,
    egressProvider: displayedProvider,
    egressMode: confidentialityMode,
  } as const;

  const errorBanner = status === 'error' && errorMsg ? (
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
        maxWidth: 680,
        width: '100%',
      }}
    >
      <AlertTriangle size={15} strokeWidth={2} style={{ marginTop: 1, flex: 'none' }} />
      {errorMsg}
    </div>
  ) : null;

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
          borderBottom: '1px solid var(--kp-divider)',
          flexShrink: 0,
        }}
      >
        <SurfaceHeader
          Icon={Sparkles}
          iconColor="var(--kp-blue)"
          title="Ask"
          description="Ask anything across your work. Every answer cites its source."
        />
      </div>

      {/* Body: conversations rail (left) + conversation/composer column (right) */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <ConversationsRail
          groups={railGroups}
          activeChatId={chatId}
          onSelect={handleLoadSession}
          onNewQuestion={handleNewAsk}
          collapsed={railCollapsed}
          onToggleCollapsed={toggleRailCollapsed}
        />

        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {isEmptyThread ? (
            /* -------- Empty thread: centered composer (ChatGPT first screen) -------- */
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--kp-space-md)',
                padding: 'var(--kp-space-4xl) var(--kp-gutter)',
              }}
            >
              {errorBanner}

              <EmptyState
                icon={Sparkles}
                iconSize={36}
                title="What do you want to find?"
                body={
                  isSampleMatter
                    ? `This is a sample ${entityLabel.one}. Type a question or click one below and see a cited answer. Click any citation to read the exact passage.`
                    : 'Every answer shows the exact document and page it came from. Click any chip to read the passage.'
                }
              />

              {/* The composer, big and centered. */}
              <AskComposer variant="centered" {...composerCommon} />

              {/* Example questions — clicking one RUNS the search (UX-28). */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 'var(--kp-space-xs)',
                  justifyContent: 'center',
                  maxWidth: 480,
                }}
              >
                {(isSampleMatter
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
                      void handleAsk(example);
                    }}
                  >
                    {example}
                  </Chip>
                ))}
              </div>

              {/* Memory-off warning — actionable with an "Enable indexing" button. */}
              {!isMemoryEnabled() && (
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    padding: 'var(--kp-space-xs) var(--kp-space-md)',
                    fontSize: 'var(--kp-font-xs)',
                    color: 'var(--kp-direct)',
                    background: 'var(--kp-direct-bg)',
                    border: '1px solid var(--kp-direct-line)',
                    borderRadius: 'var(--radius-md)',
                    maxWidth: 560,
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

              {/* B2: bridge callout — only on the sample matter, dismissible. */}
              {isSampleMatter && <SampleBridgeCallout />}
            </div>
          ) : (
            /* -------- Active thread: conversation + sticky bottom composer -------- */
            <>
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
                  {/* Conversation lives in an aria-live region so screen readers
                      announce completed answers. */}
                  <div aria-live="polite" aria-atomic="false">
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

                  {/* B2: bridge callout below demo answers (sample matter w/ turns). */}
                  {isSampleMatter && turns.length > 0 && !streamingTurn && (
                    <SampleBridgeCallout />
                  )}

                  {errorBanner}

                  <div ref={bottomRef} />
                </div>

                {/* Right: sticky source panel */}
                {anyHasCitations && (
                  <div
                    style={{
                      borderLeft: '1px solid var(--kp-divider)',
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

              {/* The composer, dropped to a sticky bottom bar. */}
              <AskComposer variant="bottom" {...composerCommon} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

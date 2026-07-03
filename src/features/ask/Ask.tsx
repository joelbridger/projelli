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

import { useState, useRef, useEffect } from 'react';
import {
  Sparkles, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/ui/kp';
import { SourcePanel } from './SourcePanel';
import { SampleBridgeCallout } from './SampleBridgeCallout';
import { TurnBlock } from './TurnBlock';
import { AskComposer } from './AskComposer';
import { FileAccessConsentBanner } from './chat/FileAccessConsentBanner';
import type { ChatProvider } from './chat/providerModelResolution';
import { ConversationsRail, type RailGroup } from './ConversationsRail';
import { SAMPLE_MATTER_ID } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { isMemoryEnabled } from '@/platform/rag/MemoryService';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { EgressIndicator } from '@/platform/privacy/ui/EgressIndicator';
import { useAsk, type UseAskProps } from './useAsk';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { IS_DEMO } from '@/web-demo/demoModeFlag';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EV_OPEN_SETTINGS, EV_MATTER_LAUNCH } from '@/config/identity';
import { ScopeStatusPill } from './ScopeToggle';
import { BookAnswerPanel } from './book/BookAnswerPanel';
import { runWholePracticeAsk } from './book/wholePracticeAsk';
import type { BookAskResult } from './book/bookFacts';

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
    filesOnly,
    setFilesOnly,
    handleCitationSelect,
    handleNewAsk,
    handleLoadSession,
    handleAsk,
    handleKeyDown,
    handleSaveToDocument,
    onOpenFileAtPath,
    isBusy,
    demoQuestions,
    exportConsentDialogProps,
    fileAccessConsent,
    fileAccessConsentScope,
    setFileAccessConsent,
  } = useAsk(props);

  const isSampleMatter = activeMatter?.id === SAMPLE_MATTER_ID;

  // Whole-practice Ask (Wave 4 Track C): a separate answer path over per-client
  // Client Map summaries only — never the turn-based retrieval flow above.
  const [bookResult, setBookResult] = useState<(BookAskResult & { model: string }) | null>(null);
  const [bookLoading, setBookLoading] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  // Stale-response guard: a workspace/client switch (chatId changes) or a
  // second whole-practice question submitted while one is in flight must never
  // let the OLDER response commit over the newer state. One monotonic counter
  // covers both: every submit bumps it (in the event handler below), and every
  // chatId change bumps it too (in the ref-only effect below — no setState
  // there, so this doesn't trip the no-setState-in-effect rule).
  const bookRequestIdRef = useRef(0);
  useEffect(() => {
    bookRequestIdRef.current += 1;
  }, [chatId]);

  // A workspace/client switch changes chatId — clear any lingering result so a
  // stale client's facts never show under the new conversation, even when no
  // new whole-practice question is asked. React's "adjusting state when a prop
  // changes" render-time pattern (setState only, no refs, so this stays clear
  // of the no-refs-during-render rule).
  const [bookResultChatId, setBookResultChatId] = useState(chatId);
  if (chatId !== bookResultChatId) {
    setBookResultChatId(chatId);
    setBookResult(null);
    setBookLoading(false);
    setBookError(null);
  }

  const submitQuestion = (q?: string) => {
    if (askScope === 'whole-practice') {
      const asked = (q ?? question).trim();
      if (!asked) return;
      setQuestion('');
      setBookLoading(true);
      setBookError(null);
      const requestId = ++bookRequestIdRef.current;
      const isStale = () => bookRequestIdRef.current !== requestId;
      const auditOpts = props.onAuditLog ? { onAuditLog: props.onAuditLog } : undefined;
      void runWholePracticeAsk(asked, chatId, auditOpts)
        .then((r) => { if (!isStale()) setBookResult(r); })
        .catch((e: unknown) => { if (!isStale()) setBookError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!isStale()) setBookLoading(false); });
      return;
    }
    void handleAsk(q);
  };
  const composerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (askScope === 'whole-practice') {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitQuestion();
      }
      return;
    }
    handleKeyDown(e);
  };

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
    matterId !== null &&
    // Matches both legacy (`ask-<id>`, `ask-<id>-<ts>`) and F2.5b root-scoped
    // (`ask-<id>::<root>`, `ask-<id>::<root>-<ts>`) session ids.
    (sid === `ask-${matterId}` ||
      sid.startsWith(`ask-${matterId}-`) ||
      sid.startsWith(`ask-${matterId}::`));
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

  // F2.5 — the file-access consent affordance above the composer. Its scope +
  // label mirror the send-path gate (askConsentScope): a single active client
  // names that client; an all-clients Ask (no matter, or the "All matters"
  // scope) names the whole practice and demands its own grant. The banner hides
  // itself for local engines / no-cloud-provider (it only gates cloud sends).
  const fileAccessScopeLabel =
    fileAccessConsentScope.kind === 'matter' && activeMatter
      ? (activeMatter.client || activeMatter.name)
      : `all your ${entityLabel.other}`;
  const consentBanner = (
    <FileAccessConsentBanner
      effectiveProvider={displayedProvider as ChatProvider | 'none' | null}
      consent={fileAccessConsent}
      consentScope={fileAccessConsentScope}
      scopeLabel={fileAccessScopeLabel}
      onChange={(next) => { setFileAccessConsent(chatId, next); }}
    />
  );

  // Shared composer props (the same controls, different position).
  const composerCommon = {
    askScope,
    setAskScope,
    hasMatter: !!activeMatter,
    isSample: isSampleMatter,
    inputRef: composerInputRef,
    question,
    onQuestionChange: (v: string) => { setQuestion(v); },
    onKeyDown: composerKeyDown,
    onSubmit: () => { submitQuestion(); },
    placeholder: composerPlaceholder,
    ariaLabel: composerAriaLabel,
    isBusy,
    status,
    submitLabel: askVerb,
    egressProvider: displayedProvider,
    egressMode: confidentialityMode,
    filesOnly,
    onFilesOnlyChange: setFilesOnly,
    banner: consentBanner,
  } as const;

  // The SOURCES column reflects the answer the user is looking at: the turn of
  // the clicked citation, else the most recent turn that has citations.
  const sourceTurnIdx: number | null = (() => {
    if (selectedTurnIdx !== null) return selectedTurnIdx;
    for (let i = turns.length - 1; i >= 0; i--) {
      if ((turns[i]?.citations.length ?? 0) > 0) return i;
    }
    return null;
  })();
  const sourceTurn =
    sourceTurnIdx !== null
      ? (turns[sourceTurnIdx] ?? streamingTurn)
      : streamingTurn && streamingTurn.citations.length > 0
        ? streamingTurn
        : null;
  const sourceCitations = sourceTurn?.citations ?? [];

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
          iconColor="var(--kp-accent)"
          title="Ask"
          description={
            /* The honest promise (Decision 4): answers from your files are cited
               and checkable; general help is clearly marked as not-from-files. */
            filesOnly
              ? 'Files-only mode — answers come only from your files, every claim cited.'
              : 'Your private practice assistant. Answers from your files are cited; general help is clearly marked.'
          }
          actions={
            /* The egress/privacy indicator lives top-right, on the title line.
               The short "status" form shows ONLY "Using local AI" / "Using cloud
               AI" (dynamic); the full honest copy stays in its tooltip + the
               inspectable data-* attributes. */
            <EgressIndicator provider={displayedProvider} mode={confidentialityMode} variant="status" />
          }
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

        {/* Thread column: the conversation scroll + the sticky bottom composer.
            The composer lives INSIDE this column (left of the Sources column),
            matching the demo — Sources is a full-height sibling, not above it. */}
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
          {/* The conversation scroll area. Empty center (no heading, no example
              pills) when there are no turns — matches the demo Ask. */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: 'var(--kp-surface-gap) var(--kp-gutter) var(--kp-gutter)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--kp-stack-gap)',
              minWidth: 0,
            }}
          >
            {/* Demo-only intro (empty thread): sets the two-trust-modes
                expectation and the "negative space" positioning before the first
                question, then gets out of the way. Demo-scoped so the desktop
                Ask stays the clean empty surface the design system specifies. */}
            {IS_DEMO && turns.length === 0 && !streamingTurn && (
              <div
                data-testid="ask-demo-intro"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--kp-space-xs)',
                  padding: 'var(--kp-space-xs) var(--kp-space-md)',
                  fontSize: 'var(--kp-font-xs)',
                  color: 'var(--kp-text-dim)',
                  lineHeight: 1.5,
                  maxWidth: 680,
                }}
              >
                {/* eslint-disable lantern-i18n/no-hardcoded-string */}
                <span>
                  Answers here are cited to your files — Ask only answers from these documents, never the open internet, and you can click any citation to open the source. For drafting documents, use Workflows, and check current-year figures before you send.
                </span>
                <span>
                  Advisor Prep Hero isn't a CRM or a note-taker. It sits beside your tools and reads across your files.
                </span>
                {/* eslint-enable lantern-i18n/no-hardcoded-string */}
                {/* Suggested questions — one click each. The last one is about
                    something the files don't cover, so it shows Ask declining
                    ("I couldn't find anything…") instead of guessing. */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--kp-space-xs)', marginTop: 'var(--kp-space-xs)' }}>
                  {demoQuestions.map((q) => (
                    <Button
                      key={q}
                      variant="secondary"
                      size="sm"
                      data-testid="ask-demo-question"
                      onClick={() => { void handleAsk(q); }}
                    >
                      {q}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Indexing-off notice — a quiet line at the top of the column, only
                when memory is off; keeps the composer clean. */}
            {!isMemoryEnabled() && (
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  padding: 'var(--kp-space-xs) var(--kp-space-md)',
                  fontSize: 'var(--kp-font-xs)',
                  color: 'var(--kp-text-dim)',
                  flexWrap: 'wrap',
                }}
              >
                <AlertTriangle size={14} strokeWidth={2} style={{ flex: 'none', color: 'var(--kp-direct, #b45309)' }} />
                <span>
                  {/* eslint-disable lantern-i18n/no-hardcoded-string */}
                  Cited answers need your documents indexed on your machine.
                  {/* eslint-enable lantern-i18n/no-hardcoded-string */}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent(EV_OPEN_SETTINGS, { detail: { category: 'ai' } }));
                  }}
                  style={{ flexShrink: 0 }}
                >
                  Enable indexing
                </Button>
              </div>
            )}

            {/* The scope pill: Ask always displays its current scope, one click
                (on the composer's ScopeToggle) to switch. */}
            <div style={{ padding: '0 var(--kp-space-md)' }}>
              <ScopeStatusPill scope={askScope} />
            </div>

            {askScope === 'whole-practice' ? (
              <BookAnswerPanel
                result={bookResult}
                loading={bookLoading}
                error={bookError}
                onOpenClient={(id) => {
                  window.dispatchEvent(new CustomEvent(EV_MATTER_LAUNCH, { detail: { matterId: id } }));
                }}
                onOpenSource={(matterId, ref, snippet) => {
                  window.dispatchEvent(
                    new CustomEvent(EV_MATTER_LAUNCH, {
                      detail: { matterId, surface: 'files', source: { kind: 'document', ref, snippet } },
                    }),
                  );
                }}
              />
            ) : (
              <>
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
              </>
            )}

            <div ref={bottomRef} />
          </div>

          {/* The composer — ONLY the scope filters + the search bar (the egress
              indicator moved to the header, top-right): the demo's clean bottom. */}
          <AskComposer variant="bottom" {...composerCommon} />
        </div>

        {/* SOURCES column — ALWAYS visible, full height. Shows the SOURCES header
            over an empty soft panel until an answer has citations, then fills
            with numbered citation cards. */}
        <div
          style={{
            width: 326,
            flex: 'none',
            borderLeft: '1px solid var(--kp-divider)',
            background: 'var(--kp-bg-soft)',
            overflowY: 'auto',
            padding: 'var(--kp-surface-gap) var(--kp-card-pad)',
          }}
        >
          <SourcePanel
            citations={sourceCitations}
            selectedN={selected}
            onSelect={(n) => { handleCitationSelect(sourceTurnIdx ?? turns.length, n); }}
            {...(props.onAuditLog ? { onAuditLog: props.onAuditLog } : {})}
            {...(filesOnly
              ? {}
              : {
                  headerSuffix: 'from your files only',
                  emptyHint:
                    'When an answer uses your files, the cited sources appear here. General-knowledge answers have nothing to cite — that’s the point.',
                  footerNote:
                    'General-knowledge answers have no source card. The Sources panel only ever fills with your files.',
                })}
          />
        </div>
      </div>

      {/* Connector-access: one-time firm-consent prompt shown before an exported
          RightCapital/Jump report is first used to answer. */}
      <ConfirmDialog {...exportConsentDialogProps} />
    </div>
  );
}

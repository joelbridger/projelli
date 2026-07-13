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
  Sparkles, AlertTriangle, PanelRightClose, ShieldCheck,
} from 'lucide-react';
import { Button, IconButton } from '@/ui/kp';
import { SourcePanel } from './SourcePanel';
import { SampleBridgeCallout } from './SampleBridgeCallout';
import { TurnBlock } from './TurnBlock';
import { AskComposer } from './AskComposer';
import { FileAccessConsentBanner } from './chat/FileAccessConsentBanner';
import { StillImportingBanner } from './StillImportingBanner';
import type { ChatProvider } from './chat/providerModelResolution';
import { ConversationsRail, type RailGroup } from './ConversationsRail';
import {
  askLayoutForWidth,
  SOURCES_WIDTH,
  COMPOSER_MIN_WIDTH,
  type AskLayout,
} from './askResponsive';
import { SAMPLE_MATTER_ID } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { isMemoryEnabled } from '@/platform/rag/MemoryService';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { useAsk, type UseAskProps } from './useAsk';
import { usePromptPreparationDecision } from './usePromptPreparationDecision';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { useTranslation } from 'react-i18next';
import { IS_DEMO } from '@/web-demo/demoModeFlag';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EV_OPEN_SETTINGS, EV_MATTER_LAUNCH } from '@/config/identity';
import { dispatchOpenSource } from '@/features/matters/clientMap/openSource';
import { BookAnswerPanel } from './book/BookAnswerPanel';
import {
  includeSampleMattersForWholePracticeAsk,
  resolveWholePracticeAskProvider,
  runWholePracticeAsk,
} from './book/wholePracticeAsk';
import { buildBookFactsDigest } from './book/bookFacts';
import { getMatters } from '@/platform/matter/matterStore';
import { SAMPLE_WHOLE_BOOK_QUESTION } from '@/platform/matter/samples/sampleMatterDemo';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import {
  resolveWholePracticeConfirm,
  getRememberedWholePracticeConsent,
  setRememberedWholePracticeConsent,
} from './book/wholePracticeSendGate';
import { WholePracticeSendConfirm } from './book/WholePracticeSendConfirm';
import type { BookAskResult } from './book/bookFacts';
import { settleBookSubmission } from './book/bookSubmission';
import { composerIsBusy } from './askHelpers';
import { buildSampleWholeBookAnswer } from './book/sampleWholeBookAnswer';

/* -------------------------------------------------------------------------- */
/* Main component                                                               */
/* -------------------------------------------------------------------------- */

export function Ask(props: UseAskProps) {
  const { onSaveToDocument } = props;
  const promptPreparationDialog = usePromptPreparationDecision();
  const entityLabel = useEntityLabel();
  const { t } = useTranslation();
  // This surface is the 3-tab IA's "Ask" tab.
  const askVerb = t('ask.action.ask');
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
    crmUnavailableNotice,
    status,
    answerStalled,
    localAiStarting,
    localEvaluating,
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
    stillImporting,
    handleCitationSelect,
    handleNewAsk,
    handleLoadSession,
    handleRenameSession,
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

  // QA-6: responsive 3-column layout. Measure the BODY row (excludes the app
  // spine) and degrade gracefully as it narrows — collapse the rail first, then
  // hide the sources column — so the composer's thread column never gets
  // squeezed until the input collapses to 0px. Plain ResizeObserver (not a CSS
  // container query) for Tauri-WebView reliability, mirroring MainPanel.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [autoLayout, setAutoLayout] = useState<AskLayout>({ collapseRail: false, showSources: true });
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [openedSourcesTurnIdx, setOpenedSourcesTurnIdx] = useState<number | null>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const w = el.getBoundingClientRect().width;
      // width 0 during unmount/hidden — don't thrash the layout to its narrowest.
      if (w <= 0) return;
      setAutoLayout(askLayoutForWidth(w));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);
  // The rail collapses when the USER collapsed it OR the layout is too narrow.
  const railEffectivelyCollapsed = railCollapsed || autoLayout.collapseRail;

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
  // The abort side of the same guard: ignoring a stale response in the UI
  // isn't enough — a workspace switch mid-flight must also cancel the
  // in-flight send so the OLD workspace's client summaries never actually
  // reach the provider after the user has moved on (Codex P1).
  const bookAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    bookRequestIdRef.current += 1;
    bookAbortRef.current?.abort();
  }, [chatId]);

  // A workspace/client switch changes chatId — clear any lingering result so a
  // stale client's facts never show under the new conversation, even when no
  // new whole-practice question is asked. React's "adjusting state when a prop
  // changes" render-time pattern (setState only, no refs, so this stays clear
  // of the no-refs-during-render rule).
  // R6 (Tier B trust guard): a whole-practice question awaiting the advisor's
  // one confirm before its book-wide summary leaves for the cloud provider.
  const [bookConfirm, setBookConfirm] = useState<{ asked: string; clientCount: number; providerName: string | null } | null>(null);
  const [bookResultChatId, setBookResultChatId] = useState(chatId);
  if (chatId !== bookResultChatId) {
    setBookResultChatId(chatId);
    setBookResult(null);
    setBookLoading(false);
    setBookError(null);
    // Drop any pending confirm too (Codex review): its client count/question
    // were computed for the OLD workspace/client, but startBookSend rebuilds
    // the digest from the CURRENT stores — so a stale Continue could ship a
    // different client set than the advisor confirmed. Clearing it forces a
    // fresh confirm for the new context.
    setBookConfirm(null);
  }

  // The actual book-wide send (extracted so it runs both directly — local-only
  // or already-confirmed — and after the R6 confirm).
  const startBookSend = (asked: string) => {
    setQuestion('');
    setBookLoading(true);
    setBookError(null);
    bookAbortRef.current?.abort(); // cancel any still-in-flight prior send
    const controller = new AbortController();
    bookAbortRef.current = controller;
    const requestId = ++bookRequestIdRef.current;
    const isStale = () => bookRequestIdRef.current !== requestId;
    const opts = { signal: controller.signal, ...(props.onAuditLog ? { onAuditLog: props.onAuditLog } : {}) };
    void settleBookSubmission(runWholePracticeAsk(asked, chatId, opts), asked, {
      onResult: setBookResult,
      onError: setBookError,
      onSettle: () => { setBookLoading(false); },
      restoreQuestion: setQuestion,
      isStale,
    });
  };

  const submitWholePracticeQuestion = (q?: string) => {
    const asked = (q ?? question).trim();
    if (!asked) return;
    // Decide, from the SAME digest the send uses, whether this cloud send
    // needs the one honest confirm (real client count + real provider).
    // An empty book or a remembered choice skip it up front.
    const matters = getMatters();
    const clientCount = buildBookFactsDigest(
      matters,
      useClientMapStore.getState().maps,
      undefined,
      { includeSampleMatters: includeSampleMattersForWholePracticeAsk(matters) },
    ).clients.length;
    if (clientCount === 0 || getRememberedWholePracticeConsent()) {
      startBookSend(asked);
      return;
    }
    // Resolve the ACTUAL provider the send will use (respects Local-only and
    // the no-cloud-key local fallback), NOT the cached UI value — otherwise a
    // stale "local" display could skip the confirm while the real send goes
    // to the cloud. The resolution is async, so tie it to a request token:
    // if the advisor switches chat/workspace or submits again before it
    // settles, the stale completion is DROPPED — a superseded question must
    // never open a confirm (or, on Continue, send) against a different client
    // set (coordinator + Codex review). The chatId-change effect and each new
    // submit both bump bookRequestIdRef, so the token check covers both.
    const myToken = ++bookRequestIdRef.current;
    void resolveWholePracticeConfirm({
      clientCount,
      remembered: getRememberedWholePracticeConsent(),
      resolveProviderId: async () => {
        try {
          return (await resolveWholePracticeAskProvider()).providerId;
        } catch {
          return null;
        }
      },
      isCurrent: () => bookRequestIdRef.current === myToken,
      onConfirm: (decision) => {
        setBookConfirm({ asked, clientCount: decision.clientCount, providerName: decision.providerName });
      },
      onSendNow: () => { startBookSend(asked); },
    });
  };
  const showSampleWholeBookAnswer = () => {
    if (!activeMatter) return;
    setAskScope('whole-practice');
    setQuestion('');
    setBookLoading(false);
    setBookError(null);
    bookAbortRef.current?.abort();
    bookRequestIdRef.current += 1;
    setBookResult(buildSampleWholeBookAnswer(activeMatter));
  };
  const submitQuestion = (q?: string) => {
    if (askScope === 'whole-practice') {
      submitWholePracticeQuestion(q);
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
      ? t('ask.composer.placeholder-email')
      : askScope === 'documents'
        ? t('ask.composer.placeholder-documents')
        : askScope === 'whole-practice'
          ? t('ask.composer.placeholder-book')
        : activeMatter
          ? t('ask.composer.placeholder-client', { name: matterLabel(activeMatter) })
          : t('ask.composer.placeholder-all-entity', { entity: entityLabel.other });
  const composerAriaLabel = t('ask.composer.aria-label', { entity: entityLabel.one });
  const suggestedQuestions =
    isSampleMatter || IS_DEMO
      ? [
          { label: demoQuestions[0], question: demoQuestions[0], kind: 'client' as const },
          { label: demoQuestions[3], question: demoQuestions[3], kind: 'client' as const },
          {
            label: t('ask.empty.whole-book-prefix', { question: SAMPLE_WHOLE_BOOK_QUESTION }),
            question: SAMPLE_WHOLE_BOOK_QUESTION,
            kind: 'whole-practice' as const,
          },
        ]
      : [];

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
          title: t('ask.scope-toggle.this-entity', { entity: entityLabel.one }),
          items: railSessions.filter((s) => belongsToActiveClient(s.chatId)),
        },
        {
          key: 'other',
          title: t('ask.conversations.other'),
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
      : t('ask.file-access.all-entity-scope', { entity: entityLabel.other });
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
    // A whole-practice send has its own loading state (bookLoading) outside
    // useAsk's turn-based status — combine both so the input/submit button
    // disable during EITHER kind of in-flight request (otherwise a double
    // Enter/click could fire a second book-wide summary send). Gated to the
    // whole-practice scope: a book-wide send running in the background must
    // never disable the composer after the advisor has switched to a
    // different scope (the book request is independently abortable via
    // bookAbortRef, so switching scopes doesn't leave it uncancellable).
    isBusy: composerIsBusy(isBusy, bookLoading, askScope),
    status,
    submitLabel: askVerb,
    egressProvider: displayedProvider,
    egressMode: confidentialityMode,
    filesOnly,
    onFilesOnlyChange: setFilesOnly,
    banner: consentBanner,
  } as const;

  const selectCitation = (turnIdx: number, n: number) => {
    setOpenedSourcesTurnIdx(null);
    handleCitationSelect(turnIdx, n);
  };
  const openSourcesForTurn = (turnIdx: number) => {
    setOpenedSourcesTurnIdx(turnIdx);
    setSourcesExpanded(true);
  };

  // The SOURCES column reflects the answer the user is looking at: the turn of
  // the clicked citation, else the most recent turn that has citations.
  const sourceTurnIdx: number | null = (() => {
    if (
      openedSourcesTurnIdx !== null &&
      (
        (turns[openedSourcesTurnIdx]?.citations.length ?? 0) > 0 ||
        (turns[openedSourcesTurnIdx]?.readSources?.length ?? 0) > 0
      )
    ) {
      return openedSourcesTurnIdx;
    }
    if (selectedTurnIdx !== null) return selectedTurnIdx;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (
        (turns[i]?.citations.length ?? 0) > 0 ||
        (turns[i]?.readSources?.length ?? 0) > 0
      ) return i;
    }
    return null;
  })();
  const sourceTurn =
    sourceTurnIdx !== null
      ? (turns[sourceTurnIdx] ?? streamingTurn)
      : streamingTurn && streamingTurn.citations.length > 0
        ? streamingTurn
        : null;
  // Whole-practice answers cite sources inline per client chip (BookAnswerPanel),
  // never through this turn-based panel — otherwise a PRIOR cited answer's
  // sources would linger next to the new book-wide answer, looking like its
  // citations when they aren't.
  const sourceCitations = askScope === 'whole-practice' ? [] : (sourceTurn?.citations ?? []);
  const sourceReadSources = askScope === 'whole-practice' ? [] : (sourceTurn?.readSources ?? []);
  const sourceSelectedN = sourceTurnIdx !== null && selectedTurnIdx === sourceTurnIdx ? selected : null;
  const hasSourceCitations = sourceCitations.length > 0;
  const hasSourceEvidence = hasSourceCitations || sourceReadSources.length > 0;

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
      {promptPreparationDialog}
      {/* Header */}
      <div
        style={{
          padding: 'var(--kp-surface-header-pad)',
          borderBottom: '1px solid var(--kp-divider)',
          flexShrink: 0,
        }}
      >
        {/* F1: the egress/privacy status lives ONCE, in the top bar. The
            per-surface pill here was a passive duplicate that could contradict
            the top bar on one screen, so it was removed. The pre-send banner in
            the composer still carries the trust signal AT ACTION TIME. */}
        <SurfaceHeader
          Icon={Sparkles}
          iconColor="var(--kp-accent)"
          title={askVerb}
        />
      </div>

      {/* Body: conversations rail (left) + conversation/composer column (right) */}
      <div ref={bodyRef} style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <ConversationsRail
          groups={railGroups}
          activeChatId={chatId}
          onSelect={handleLoadSession}
          onNewQuestion={handleNewAsk}
          onRename={handleRenameSession}
          collapsed={railEffectivelyCollapsed}
          onToggleCollapsed={toggleRailCollapsed}
        />

        {/* Thread column: the conversation scroll + the sticky bottom composer.
            The composer lives INSIDE this column (left of the Sources column),
            matching the demo — Sources is a full-height sibling, not above it. */}
        <div
          style={{
            flex: 1,
            // QA-6: a hard floor so the composer's column (and thus the input)
            // can never be squeezed to 0. The responsive collapse above frees
            // the room; this guarantees the primary input stays usable.
            minWidth: COMPOSER_MIN_WIDTH,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* The conversation scroll area. Empty sample threads show guaranteed
              starter questions so the first demo is not a blank canvas. */}
          <div
            data-testid="ask-thread-scroll"
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
            {(IS_DEMO || isSampleMatter) && turns.length === 0 && !streamingTurn && (
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
                <span>{t('ask.empty.sample-title')}</span>
                <span>{t('ask.demo-intro.body')}</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--kp-space-xs)', marginTop: 'var(--kp-space-xs)' }}>
                  {suggestedQuestions.map((item) => (
                    <Button
                      key={`${item.kind}:${item.question}`}
                      variant="secondary"
                      size="sm"
                      data-testid="ask-demo-question"
                      style={{
                        height: 'auto',
                        minHeight: 30,
                        maxWidth: 320,
                        whiteSpace: 'normal',
                        textAlign: 'left',
                        lineHeight: 1.25,
                      }}
                      onClick={() => {
                        if (item.kind === 'whole-practice') {
                          setAskScope('whole-practice');
                          if (isSampleMatter && item.question === SAMPLE_WHOLE_BOOK_QUESTION) {
                            showSampleWholeBookAnswer();
                          } else {
                            submitWholePracticeQuestion(item.question);
                          }
                          return;
                        }
                        void handleAsk(item.question);
                      }}
                    >
                      {item.label}
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
                <span>{t('ask.indexing.notice')}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent(EV_OPEN_SETTINGS, { detail: { category: 'ai' } }));
                  }}
                  style={{ flexShrink: 0 }}
                >
                  {t('ask.indexing.enable')}
                </Button>
              </div>
            )}

            {askScope === 'whole-practice' ? (
              <BookAnswerPanel
                result={bookResult}
                loading={bookLoading}
                error={bookError}
                onOpenClient={(id) => {
                  // Explicit 'matters' surface: always open THIS client's
                  // Client Map, never a restored snapshot of wherever they
                  // last were (that's the point of the chip).
                  window.dispatchEvent(new CustomEvent(EV_MATTER_LAUNCH, { detail: { matterId: id, surface: 'matters' } }));
                }}
                onOpenSource={(matterId, source) => { dispatchOpenSource(matterId, source); }}
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
                      onCitationSelect={selectCitation}
                      onOpenSourcesPanel={openSourcesForTurn}
                      onSaveToDocument={onSaveToDocument ? handleSaveToDocument : undefined}
                      isSaving={savingIdx === idx}
                      isPersisted={false}
                      askScope={askScope}
                      {...(onOpenFileAtPath !== undefined ? { onOpenFileAtPath } : {})}
                      {...(props.onAuditLog ? { onAuditLog: props.onAuditLog } : {})}
                    />
                  ))}

                  {streamingTurn && (
                    <TurnBlock
                      key="streaming"
                      turn={streamingTurn}
                      turnIdx={turns.length}
                      selectedTurnIdx={selectedTurnIdx}
                      selected={selected}
                      onCitationSelect={selectCitation}
                      onOpenSourcesPanel={openSourcesForTurn}
                      onSaveToDocument={undefined}
                      isSaving={false}
                      isPersisted={false}
                      askScope={askScope}
                      isStreaming
                      answerStalled={answerStalled}
                      localAiStarting={localAiStarting}
                      localEvaluating={localEvaluating}
                      onOpenAiStatus={() => {
                        window.dispatchEvent(new CustomEvent(EV_OPEN_SETTINGS, { detail: { category: 'ai' } }));
                      }}
                      {...(onOpenFileAtPath !== undefined ? { onOpenFileAtPath } : {})}
                      {...(props.onAuditLog ? { onAuditLog: props.onAuditLog } : {})}
                    />
                  )}
                </div>

                {/* B2: bridge callout below demo answers (sample matter w/ turns). */}
                {isSampleMatter && turns.length > 0 && !streamingTurn && (
                  <SampleBridgeCallout />
                )}

                {errorBanner}
                {crmUnavailableNotice && (
                  <div
                    role="status"
                    data-testid="ask-crm-unavailable"
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'flex-start',
                      padding: '9px 12px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--kp-warning-bg)',
                      border: '1px solid var(--kp-warning-line)',
                      fontSize: 'var(--kp-font-xs)',
                      color: 'var(--kp-warning)',
                      maxWidth: 680,
                      width: '100%',
                    }}
                  >
                    <AlertTriangle size={15} strokeWidth={2} style={{ marginTop: 1, flex: 'none' }} />
                    {crmUnavailableNotice}
                  </div>
                )}
              </>
            )}

            <div ref={bottomRef} />
          </div>

          {/* QA-90: still-importing notice, directly above the composer so it's
              visible without scrolling while a demo answer might be incomplete. */}
          <div style={{ padding: '0 var(--kp-gutter)' }}>
            <StillImportingBanner importing={stillImporting} />
          </div>

          {/* The composer — ONLY the scope filters + the search bar (the egress
              indicator moved to the header, top-right): the demo's clean bottom. */}
          <AskComposer variant="bottom" {...composerCommon} />
        </div>

        {/* SOURCES column — hidden until the current answer has citations. */}
        {autoLayout.showSources && hasSourceEvidence && (
          sourcesExpanded ? (
            <div
              data-testid="ask-sources-pane"
              data-collapsed="false"
              style={{
                width: SOURCES_WIDTH,
                flex: 'none',
                borderLeft: '1px solid var(--kp-divider)',
                background: 'var(--kp-bg-soft)',
                overflowY: 'auto',
                padding: 'var(--kp-surface-gap) var(--kp-card-pad)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <IconButton
                  icon={PanelRightClose}
                  label={t('ask.sources.collapse')}
                  size="xs"
                  variant="ghost"
                  data-testid="ask-sources-toggle"
                  onClick={() => { setSourcesExpanded(false); }}
                />
              </div>
              <SourcePanel
                citations={sourceCitations}
                readSources={sourceReadSources}
                selectedN={sourceSelectedN}
                onSelect={(n) => { selectCitation(sourceTurnIdx ?? turns.length, n); }}
                {...(props.onAuditLog ? { onAuditLog: props.onAuditLog } : {})}
                {...(filesOnly
                  ? {}
                  : {
                      headerSuffix: t('ask.sources.header-suffix-files-only'),
                      emptyHint: t('ask.sources.empty-hint'),
                    })}
              />
            </div>
          ) : (
            <div
              data-testid="ask-sources-pane"
              data-collapsed="true"
              style={{
                width: 48,
                flex: 'none',
                borderLeft: '1px solid var(--kp-divider)',
                background: 'var(--kp-bg-soft)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                padding: 'var(--kp-space-sm) 0',
              }}
            >
              <IconButton
                icon={ShieldCheck}
                label={t('ask.sources.title')}
                size="sm"
                variant="ghost"
                data-testid="ask-sources-toggle"
                onClick={() => { setSourcesExpanded(true); }}
              />
            </div>
          )
        )}
      </div>

      {/* Connector-access: one-time firm-consent prompt shown before an exported
          RightCapital/Jump report is first used to answer. */}
      <ConfirmDialog {...exportConsentDialogProps} />

      {/* R6: the one honest confirm before a whole-practice question ships a
          summary of every client to the cloud provider. */}
      <WholePracticeSendConfirm
        open={bookConfirm !== null}
        clientCount={bookConfirm?.clientCount ?? 0}
        providerName={bookConfirm?.providerName ?? null}
        onCancel={() => { setBookConfirm(null); }}
        onConfirm={({ remember }) => {
          if (remember) setRememberedWholePracticeConsent(true);
          const asked = bookConfirm?.asked ?? '';
          setBookConfirm(null);
          if (asked) startBookSend(asked);
        }}
      />
    </div>
  );
}

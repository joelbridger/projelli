/**
 * useAsk — the logic layer for Ask (state, refs, the seven effects, the
 * recent-sessions derivations, and the RAG → provider → citation-parse `handleAsk`
 * orchestrator). Extracted VERBATIM from Ask.tsx so the component is a
 * pure render over this hook's return. See Ask.tsx for the surface-level
 * documentation (scope toggle, citation-first design, chatId convention).
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useActiveMatter, SAMPLE_MATTER_ID } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { getDemoAnswerForWorkspace, getDemoQuestions } from '@/platform/matter/samples/sampleMatterDemo';
import { useProfessionStore } from '@/platform/profile/professionStore';
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import {
  DEFAULT_WORKSPACE_TOP_K,
  buildWorkspaceContextBlock,
} from '@/platform/rag/workspaceCommand';
import type { RagHit, RetrievalScope } from '@/platform/utils/tauri-commands';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import type { ChatMessage } from '@/platform/types/ai';
import type { AuditEntry, AuditScope } from '@/platform/types/audit';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import { resolveEgress, isLocalProvider, type ConfidentialityMode } from '@/platform/privacy/egress';
import { getConfidentialityMode, useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { assertLocalOnlyAllowsSend, isLocalOnlyMode } from '@/platform/privacy/localOnlyGuard';
import type { AskFailureStage, AskScope, AskTurn } from './askHelpers';
import {
  NO_EVIDENCE_DECLINE,
  buildAskSystemPrompt,
  scopeHintForMatter,
} from './askPrompt';
import {
  hasCloudKey,
  buildResolvedAskProvider,
  resolveLocalAskProvider,
  resolveActiveAskProviderId,
  resolveEmailCitationLabels,
  friendlyErrorMessage,
  buildHistoryBlock,
  reconstructTurns,
  filterHitsByScope,
  bindAnswerCitations,
  buildRecentAskSessions,
} from './askHelpers';

export interface UseAskProps {
  onSaveToDocument?: (content: string) => Promise<void>;
  /** When non-null, prefills the composer with the given question and optionally auto-submits. */
  prefillRequest?: { question: string; autoSubmit?: boolean } | null;
  /** Called after a prefill has been consumed so the parent can clear it. */
  onPrefillConsumed?: () => void;
  /**
   * WS3 (Task 2): when provided, citation chip clicks open the file at the
   * cited paragraph in the editor — single-click navigation matching the Chat
   * surface. Signature mirrors AIChatViewer.onOpenFileAtPath.
   */
  onOpenFileAtPath?: (path: string, paragraphIndex?: number, snippet?: string) => void | Promise<void>;
  /** App-level audit sink. When omitted, Ask still works but does not log. */
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
}

export function useAsk({
  onSaveToDocument,
  prefillRequest,
  onPrefillConsumed,
  onOpenFileAtPath,
  onAuditLog,
}: UseAskProps) {
  const activeMatter = useActiveMatter();
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const profession = useProfessionStore((s) => s.profession);
  // B-PRIV-1: subscribe to the confidentiality mode so the egress banner is
  // reactive. The Search/Ask banner must recompute the moment the user switches
  // mode in Settings — it can never keep claiming "nothing leaves" while the
  // next query goes to the cloud. Drives both the EgressIndicator `mode` prop
  // (passed from Ask) and the activeProvider re-resolution effect below.
  const confidentialityMode = useConfidentialityMode();
  const isSampleMatterActive = activeMatter?.id === SAMPLE_MATTER_ID;
  // Profession-aware demo questions: a tax user on the sample matter sees tax
  // questions; a consultant sees consulting questions; legal is the default.
  const demoQuestions = getDemoQuestions(profession);

  // Derive chatId from active matter
  const baseChatId = activeMatter ? `ask-${activeMatter.id}` : 'ask-global';
  const [chatId, setChatId] = useState<string>(baseChatId);

  // Scope toggle — default to 'this-matter' when a matter is active, else 'all-matters'.
  // Reset to appropriate default when the active matter changes.
  const defaultScope = (): AskScope => (activeMatter ? 'this-matter' : 'all-matters');
  const [askScope, setAskScope] = useState<AskScope>(defaultScope);

  // Update chatId + reset scope when active matter changes
  useEffect(() => {
    setChatId(activeMatter ? `ask-${activeMatter.id}` : 'ask-global');
    setAskScope(activeMatter ? 'this-matter' : 'all-matters');
  }, [activeMatter?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Store selectors
  const initSession = useAIChatStore((s) => s.initSession);
  const setSessionWorkspaceRoot = useAIChatStore((s) => s.setSessionWorkspaceRoot);
  const addMessage = useAIChatStore((s) => s.addMessage);
  const sessions = useAIChatStore((s) => s.sessions);

  // Conversation state
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [streamingTurn, setStreamingTurn] = useState<AskTurn | null>(null);
  const [question, setQuestion] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedTurnIdx, setSelectedTurnIdx] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'retrieving' | 'answering' | 'done' | 'error'>('idle');
  const [savingIdx, setSavingIdx] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  // Fix #8 / B-PRIV-1: the provider the egress banner names, TAGGED with the
  // confidentiality mode it was resolved UNDER. `null` means "destination not
  // yet known". We tag the mode so the displayed value (derived synchronously in
  // render below) can fall back to "checking" the instant the mode changes —
  // BEFORE the resolver effect runs — closing the one-frame window where a
  // provider resolved under the OLD mode would otherwise paint under the NEW mode
  // (e.g. a local provider painting "nothing leaves" while the mode is already
  // Direct). The EgressIndicator renders a neutral "checking" badge
  // (data-leaves=false) for null rather than guessing a destination.
  const [activeProvider, setActiveProvider] =
    useState<{ provider: string; mode: ConfidentialityMode } | null>(null);

  // Derived SYNCHRONOUSLY in render: the badge shows a concrete destination only
  // when we have a resolved provider AND it was resolved under the CURRENT mode.
  // Any mismatch (or unresolved) => null => the EgressIndicator's neutral
  // "checking" state. Because this is computed in render, it flips to "checking"
  // on the very render the mode changes, before any effect fires — so the banner
  // can never display a provider resolved under a different mode, even for a frame.
  const displayedProvider: string | null =
    activeProvider && activeProvider.mode === confidentialityMode
      ? activeProvider.provider
      : null;

  // Recent sessions: sessions keyed "ask-*", scoped to the current workspace.
  const recentSessions = buildRecentAskSessions(sessions, rootPath, {
    excludeChatId: chatId,
    limit: 5,
  });

  // Matter-scoped prior sessions: sessions whose key starts with "ask-<matterId>"
  // (covers both the base id and timestamped variants like ask-<matterId>-<ts>).
  // Only shown for non-sample real matters on the empty/landing state.
  const matterSessionPrefix = activeMatter ? `ask-${activeMatter.id}` : null;
  const matterRecentSessions = matterSessionPrefix !== null
    ? buildRecentAskSessions(sessions, rootPath, {
        prefix: matterSessionPrefix,
        excludeChatId: chatId,
        limit: 5,
      })
    : [];

  // On mount / chatId change: init session and reconstruct turns from persisted messages.
  // Fix #1: read getState() instead of the closed-over `sessions` selector so we always
  // see the post-initSession state, not a stale snapshot captured at render time.
  // A3: for the sample matter, always start with the empty chip state (never restore a
  // prior demo answer) so the "click a question" aha moment shows on every fresh visit.
  useEffect(() => {
    initSession(chatId, []);
    setSessionWorkspaceRoot(chatId, rootPath ?? null);
    const isSampleChat = activeMatter?.id === SAMPLE_MATTER_ID;
    const freshSession = useAIChatStore.getState().sessions[chatId];
    if (!isSampleChat && freshSession && freshSession.messages.length > 0) {
      const reconstructed = reconstructTurns(freshSession.messages);
      setTurns(reconstructed);
    } else {
      setTurns([]);
    }
    setSelected(null);
    setSelectedTurnIdx(null);
    setStreamingTurn(null);
    setErrorMsg(null);
    setStatus('idle');
  }, [chatId, rootPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom when turns change or streaming turn updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, streamingTurn]);

  // Fix #2: auto-select the first citation of the most-recently-added completed
  // turn. Running this in an effect (rather than inside the setTurns updater)
  // ensures both pieces of state are committed in the same React batch and
  // SourcePanel is never empty for a frame.
  useEffect(() => {
    if (turns.length === 0) return;
    const lastTurn = turns[turns.length - 1];
    if (lastTurn && lastTurn.citations.length > 0) {
      setSelectedTurnIdx(turns.length - 1);
      setSelected(1);
    }
  }, [turns.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fix #1: prefill + optional auto-submit from the matter hub or other callers.
  useEffect(() => {
    if (!prefillRequest) return;
    setQuestion(prefillRequest.question);
    composerInputRef.current?.focus();
    if (prefillRequest.autoSubmit) {
      void handleAsk(prefillRequest.question);
    }
    onPrefillConsumed?.();
  }, [prefillRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fix #2: pressing '/' while not typing in an input focuses the composer.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
      e.preventDefault();
      composerInputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  }, []);

  // Fix #8: resolve the active provider NAME for the pre-send EgressIndicator.
  // It must name the SAME engine the send will actually use — the embedded
  // Keepance Local AI when it is ready (not a generic "Ollama"), and the local
  // engine in Local-only mode regardless of any cloud key. resolveActiveAskProviderId
  // mirrors buildResolvedAskProvider's destination decision so the two can't drift.
  //
  // B-PRIV-1: re-resolve whenever the confidentiality mode changes (not just on
  // mount). Without this the badge stayed pinned to the mount-time engine — e.g.
  // "keepance-local" — so flipping from Local-only to Cloud mid-session left the
  // banner falsely claiming "nothing leaves" while the query went to the cloud.
  //
  // HOLE #1 (Codex re-review) — resolution is async, so during the in-flight
  // window the OLD provider value combined with the NEW mode could still lie
  // (a stale local provider + Direct mode renders as "nothing leaves"). We close
  // that window by BLANKING to null up front: the banner shows a neutral
  // "checking AI destination" badge for the whole async window, never a
  // concrete-but-stale destination. The cancellation guard drops
  // a superseded in-flight resolution so the displayed engine can't race backwards.
  useEffect(() => {
    let cancelled = false;
    setActiveProvider(null);
    void resolveActiveAskProviderId()
      .then((resolved) => {
        if (!cancelled) setActiveProvider({ provider: resolved, mode: confidentialityMode });
      })
      .catch(() => {
        // The resolver almost never throws (it has internal fallbacks), but if it
        // does we must NOT strand the badge on "checking" forever. Fall back to a
        // CONSERVATIVE cloud identity: in Local-only mode resolveEgress still forces
        // "nothing leaves"; in cloud modes this over-warns ("data leaves"), which is
        // the safe direction for a privacy indicator — it can never UNDER-claim egress.
        if (!cancelled) setActiveProvider({ provider: 'anthropic', mode: confidentialityMode });
      });
    return () => { cancelled = true; };
  }, [confidentialityMode]);

  // Derived: currently selected citation
  const selectedCite = (() => {
    if (selectedTurnIdx === null || selected === null) return null;
    const turn = turns[selectedTurnIdx] ?? streamingTurn;
    if (!turn) return null;
    return turn.citations.find((c) => c.n === selected) ?? null;
  })();

  // Any turn has citations?
  const anyHasCitations = turns.some((t) => t.citations.length > 0) ||
    (streamingTurn !== null && streamingTurn.citations.length > 0);

  const handleCitationSelect = useCallback((turnIdx: number, n: number) => {
    setSelectedTurnIdx(turnIdx);
    setSelected(n);
  }, []);

  const handleNewAsk = useCallback(() => {
    abortRef.current?.abort();
    // Generate a new session id to start fresh
    const newId = activeMatter
      ? `ask-${activeMatter.id}-${String(Date.now())}`
      : `ask-global-${String(Date.now())}`;
    setChatId(newId);
    setTurns([]);
    setStreamingTurn(null);
    setQuestion('');
    setSelected(null);
    setSelectedTurnIdx(null);
    setErrorMsg(null);
    setStatus('idle');
  }, [activeMatter]);

  const handleLoadSession = useCallback((sid: string) => {
    setChatId(sid);
  }, []);

  const buildAuditScope = useCallback((retrievalScope: RetrievalScope): AuditScope => {
    if (retrievalScope.kind === 'matter') {
      return {
        kind: 'matter',
        matterId: retrievalScope.matterId,
        ...(activeMatter ? { matterName: matterLabel(activeMatter) } : {}),
      };
    }
    return { kind: 'allMatters' };
  }, [activeMatter]);

  /**
   * Submit a question. An optional `overrideQuestion` bypasses the text input
   * so chips on the sample matter can auto-submit without typing into the box.
   */
  const handleAsk = useCallback(async (overrideQuestion?: string) => {
    const q = (overrideQuestion ?? question).trim();
    if (!q || status === 'retrieving' || status === 'answering') return;

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setErrorMsg(null);
    setStatus('retrieving');

    // Add user message to stream placeholder
    const newStreamingTurn: AskTurn = {
      question: q,
      answer: '',
      citations: [],
      sources: [],
      isStreaming: true,
    };
    setStreamingTurn(newStreamingTurn);
    setQuestion('');

    let providerAudit:
      | {
          providerId: 'anthropic' | 'openai' | 'google' | 'ollama' | 'keepance-local';
          model: string;
        }
      | null = null;
    let providerCallStarted = false;
    let failedStage: AskFailureStage = 'setup';

    try {
      /* Demo branch: sample matter + no cloud key + matching question */
      const isSampleMatter = activeMatter?.id === SAMPLE_MATTER_ID;
      if (isSampleMatter && rootPath) {
        const cloudKey = await hasCloudKey();
        if (!cloudKey) {
          const demo = getDemoAnswerForWorkspace(q, rootPath, profession);
          if (demo) {
            if (abort.signal.aborted) return;
            const completedTurn: AskTurn = {
              question: q,
              answer: demo.answer,
              citations: demo.citations,
              sources: [],
            };
            const now = new Date().toISOString();
            addMessage(chatId, { role: 'user', content: q, timestamp: now });
            addMessage(chatId, {
              role: 'assistant',
              content: demo.answer,
              timestamp: now,
              askCitations: demo.citations,
              askSources: [],
            });
            setTurns((prev) => [...prev, completedTurn]);
            setStreamingTurn(null);
            setStatus('done');
            return;
          }
          // A4: sample matter + no cloud key + question not in demo set.
          // Do not fall through to RAG or the AI provider — neither will work.
          // Push a calm bridging message and stop.
          if (abort.signal.aborted) return;
          const bridgeAnswer =
            "That question is outside this sample. Connect an AI provider in Settings to ask your own files, or try one of the example questions below.";
          const bridgeTurn: AskTurn = {
            question: q,
            answer: bridgeAnswer,
            citations: [],
            sources: [],
          };
          const nowBridge = new Date().toISOString();
          addMessage(chatId, { role: 'user', content: q, timestamp: nowBridge });
          addMessage(chatId, { role: 'assistant', content: bridgeAnswer, timestamp: nowBridge });
          setTurns((prev) => [...prev, bridgeTurn]);
          setStreamingTurn(null);
          setStatus('done');
          return;
        }
      }

      /* Step 1: RAG retrieval
       * The Tauri-level retrieval scope is matter vs all-matters (confidentiality
       * partition). Email/Documents are client-side type filters applied on top:
       * when a matter is active and scope is Email or Documents we still retrieve
       * within that matter's boundary first, then filter by source type. This
       * preserves the confidentiality partition at the database level.
       */
      const retrievalScope: RetrievalScope =
        activeMatter && askScope !== 'all-matters'
          ? { kind: 'matter', matterId: activeMatter.id }
          : { kind: 'allMatters' };

      let hits: RagHit[] = [];
      const memoryEnabled = isMemoryEnabled();
      if (memoryEnabled) {
        failedStage = 'retrieval';
        const rawHits = await MemoryService.retrieve(q, DEFAULT_WORKSPACE_TOP_K, retrievalScope, false);
        failedStage = 'post-retrieval';
        // Apply client-side type filter for Email/Documents scopes.
        hits = filterHitsByScope(rawHits, askScope);
        const auditScope = buildAuditScope(retrievalScope);
        const topScore = hits.reduce<number | null>(
          (max, hit) => (max === null ? hit.score : Math.max(max, hit.score)),
          null,
        );
        onAuditLog?.(auditEventToEntry({
          type: 'scope_active',
          timestamp: new Date().toISOString(),
          payload: { scope: auditScope },
        }));
        onAuditLog?.(auditEventToEntry({
          type: 'privilege_evaluated',
          timestamp: new Date().toISOString(),
          payload: { excluded: true },
        }));
        onAuditLog?.(auditEventToEntry({
          type: 'retrieval_executed',
          timestamp: new Date().toISOString(),
          payload: {
            query: q,
            scope: auditScope,
            hitCount: hits.length,
            topScore,
          },
        }));
      }

      if (abort.signal.aborted) return;

      /* BUG-016: retrieval-evidence gate.
       * When indexing IS on but retrieval found nothing in scope, decline
       * instead of calling the model — otherwise the model free-associates a
       * confident answer and (worse) a fabricated citation, presented under the
       * "Answered over your own files" banner. Declining here, before the model
       * runs, makes "no evidence" an honest "I couldn't find this" rather than a
       * hallucinated, fake-cited answer. (When indexing is OFF we leave the
       * existing behaviour: the UI already warns that documents aren't indexed.)
       */
      if (memoryEnabled && hits.length === 0) {
        const declineTurn: AskTurn = {
          question: q,
          answer: NO_EVIDENCE_DECLINE,
          citations: [],
          sources: [],
        };
        const nowDecline = new Date().toISOString();
        addMessage(chatId, { role: 'user', content: q, timestamp: nowDecline });
        addMessage(chatId, { role: 'assistant', content: NO_EVIDENCE_DECLINE, timestamp: nowDecline });
        setTurns((prev) => [...prev, declineTurn]);
        setStreamingTurn(null);
        setStatus('done');
        return;
      }

      /* Step 2: call the AI provider */
      setStatus('answering');
      failedStage = 'provider-resolution';

      const workspaceBlock = hits.length > 0 ? buildWorkspaceContextBlock(hits) : '';

      // B4 (audit honesty): build the prompt scope from the SAME retrievalScope
      // the retrieval actually used — NOT from activeMatter. Otherwise, when a
      // matter is active but the user picked the "All matters" scope, the prompt
      // would tell the AI it's answering for the active client while retrieval ran
      // across everything — so the prompt and the audited scope would disagree.
      const matterHint = scopeHintForMatter(
        retrievalScope.kind === 'matter' && activeMatter ? matterLabel(activeMatter) : null,
      );

      // Build history from completed turns (last 6)
      const historyBlock = buildHistoryBlock(turns, 6);

      // BUG-016: the answer prompt is hardened to refuse fabrication. The model
      // must answer ONLY from the retrieved context, decline with the exact
      // NO_EVIDENCE_DECLINE wording when the context doesn't contain the answer,
      // and never state a figure/date/name or cite a source that isn't present
      // in the context. This is the model-side half of the grounding fix; the
      // citation-binding step below structurally drops any citation that still
      // doesn't resolve to a retrieved chunk. The prompt assembly lives in
      // `askPrompt.ts` so the answer-quality eval (tests/eval/ask) tests the
      // exact prompt we ship.
      const systemPrompt = buildAskSystemPrompt({
        scopeHint: matterHint,
        workspaceBlock,
        historyBlock,
      });

      let answerText = '';
      let resolvedProvider = await buildResolvedAskProvider();

      // FINAL SYNCHRONOUS LOCAL-ONLY SEND GUARD (Codex re-review #4 — the
      // important one). This is a real privacy enforcement, not a display fix:
      // buildResolvedAskProvider() checks the mode only at its START and then
      // awaits keychain reads. If the user switches to Local-only DURING those
      // awaits, it can still return a CLOUD provider — which would send the query
      // to the cloud while Local-only is on, breaking that mode's core guarantee
      // (nothing ever leaves the machine). We re-check the CURRENT mode after the
      // await: if Local-only is now on and the resolved provider is NOT local,
      // re-resolve to the on-device engine so the user still gets a private answer
      // instead of a failed query (local sends are always safe, whatever the mode
      // does next).
      if (isLocalOnlyMode() && !isLocalProvider(resolvedProvider.providerId)) {
        resolvedProvider = await resolveLocalAskProvider();
      }
      // Airtight backstop: there is NO await between this assertion and the send
      // below (only synchronous setup + flushSync), so the mode cannot change in
      // between. If we somehow still hold a cloud provider in Local-only mode,
      // fail closed (throw) rather than leak — the catch surfaces the reason.
      assertLocalOnlyAllowsSend(resolvedProvider.providerId);

      const provider = resolvedProvider.provider;
      providerAudit = {
        providerId: resolvedProvider.providerId,
        model: resolvedProvider.model,
      };
      // HOLE #2 (Codex re-review) — pin the egress banner to the engine this send
      // ACTUALLY resolved to (buildResolvedAskProvider is the single source of
      // truth for where the request goes), and do it SYNCHRONOUSLY. A plain
      // setState here may be batched, so the banner is not guaranteed to repaint
      // before the network call on the next line. flushSync forces the React
      // commit now, so the banner DOM reflects the real destination BEFORE
      // sendMessage/sendMessageStreaming runs — even if the badge was still
      // "checking" (null) at click time, or the effective provider changed for a
      // reason the mode-keyed effect doesn't watch (e.g. a cloud key added
      // mid-session). The banner can never be sent-to-cloud-while-showing-local.
      flushSync(() => {
        setActiveProvider({ provider: resolvedProvider.providerId, mode: getConfidentialityMode() });
      });

      const emitSuccessfulEgress = () => {
        if (!providerAudit) return;
        const egress = resolveEgress({
          provider: providerAudit.providerId,
          mode: getConfidentialityMode(),
          isDemo: false,
          assuredAvailable: false,
        });
        onAuditLog?.(auditEventToEntry({
          type: 'egress',
          timestamp: new Date().toISOString(),
          payload: {
            provider: egress.provider,
            model: providerAudit.model,
            mode: getConfidentialityMode(),
            destination: egress.destination,
            dataLeaves: egress.dataLeaves,
            scope: buildAuditScope(retrievalScope),
          },
        }));
      };

      const emitModelCall = (contentLength: number, usage?: { inputTokens?: number; outputTokens?: number }, cost?: number) => {
        if (!providerAudit) return;
        onAuditLog?.({
          action: 'model_call',
          description: `Search question to ${providerAudit.model}`,
          model: providerAudit.model,
          inputs: { promptLength: q.length },
          outputs: { contentLength },
          userDecision: 'auto',
          metadata: { chatId, askScope },
          tokensIn: usage?.inputTokens ?? 0,
          tokensOut: usage?.outputTokens ?? 0,
          costUsd: cost ?? 0,
          provider: providerAudit.providerId,
        });
      };

      if (typeof provider.sendMessageStreaming === 'function') {
        failedStage = 'provider-send';
        providerCallStarted = true;
        const streamResp = await provider.sendMessageStreaming(q, {
          systemPrompt,
          onChunk: (chunk) => {
            if (abort.signal.aborted) return;
            answerText += chunk;
            setStreamingTurn((prev) => prev ? { ...prev, answer: answerText } : prev);
          },
          signal: abort.signal,
        });
        answerText = streamResp.content;
        emitSuccessfulEgress();
        emitModelCall(answerText.length, streamResp.usage, streamResp.cost);
      } else {
        failedStage = 'provider-send';
        providerCallStarted = true;
        const resp = await provider.sendMessage(q, { systemPrompt });
        answerText = resp.content;
        emitSuccessfulEgress();
        emitModelCall(answerText.length, resp.usage, resp.cost);
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (abort.signal.aborted) return;

      /* Step 3: parse and attach citations.
       * A citation is kept only when it points at a real retrieved chunk. Newer
       * rows can also be verified by id + matterId, but older indexed rows are
       * still grounded when the cited file + locator were actually retrieved.
       */
      const expectedMatterId: string | null =
        activeMatter && askScope !== 'all-matters' ? activeMatter.id : null;
      failedStage = 'post-processing';
      const { answer: rewritten, citations: boundCitations, sources } = bindAnswerCitations(answerText, hits, expectedMatterId);
      // Cosmetic: name email citations by their subject line instead of the raw
      // `mail:<id>` message-id (display-only; path/verification untouched).
      const citations = await resolveEmailCitationLabels(boundCitations);

      const completedTurn: AskTurn = {
        question: q,
        answer: rewritten,
        citations,
        sources,
      };

      // Persist to store as two ChatMessage entries.
      // A1: persist askCitations + askSources on the assistant message so that
      // clickable {n} chips and the Verified source panel survive navigation/reload.
      const now = new Date().toISOString();
      const userMsg: ChatMessage = { role: 'user', content: q, timestamp: now };
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: rewritten,
        timestamp: now,
        ...(citations.length > 0 ? { askCitations: citations, askSources: sources } : {}),
      };
      addMessage(chatId, userMsg);
      addMessage(chatId, assistantMsg);

      // Add completed turn to local state.
      // Fix #2: auto-selection is handled by the useEffect below keyed on turns.length,
      // so we do NOT call setSelectedTurnIdx / setSelected inside the updater — doing so
      // inside the functional updater can leave them out of sync for one frame.
      setTurns((prev) => [...prev, completedTurn]);
      setStreamingTurn(null);
      setStatus('done');
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error('Ask failed', err);
      if (providerCallStarted && providerAudit) {
        const egress = resolveEgress({
          provider: providerAudit.providerId,
          mode: getConfidentialityMode(),
          isDemo: false,
          assuredAvailable: false,
        });
        onAuditLog?.({
          action: 'user_action',
          description: `Search request failed before a response from ${providerAudit.providerId}`,
          model: providerAudit.model,
          inputs: {
            provider: egress.provider,
            model: providerAudit.model,
            mode: getConfidentialityMode(),
            destination: egress.destination,
            dataLeaves: egress.dataLeaves,
            scope: activeMatter && askScope !== 'all-matters'
              ? { kind: 'matter', matterId: activeMatter.id, matterName: matterLabel(activeMatter) }
              : { kind: 'allMatters' },
          },
          outputs: {
            success: false,
            reason: err instanceof Error ? err.message : String(err),
          },
          userDecision: 'auto',
          metadata: {
            auditEventType: 'egress_failed',
            provider: egress.provider,
            model: providerAudit.model,
            mode: getConfidentialityMode(),
            destination: egress.destination,
            dataLeaves: egress.dataLeaves,
          },
        });
      }
      const raw = err instanceof Error ? err.message : '';
      // Fix #4 / UX-29: plain-language copy that is mode- and stage-aware.
      // `providerCallStarted === false` means the failure was in the file-search
      // stage (not the AI/key), so the message must not blame a key.
      setErrorMsg(
        friendlyErrorMessage(raw, {
          mode: getConfidentialityMode(),
          reachedProvider: providerCallStarted,
          failedStage,
        }),
      );
      setStreamingTurn(null);
      setStatus('error');
      // BUG-002: restore the typed question so the user can retry without
      // re-typing. The input was cleared optimistically before the try block;
      // on error we put it back.
      setQuestion(q);
    }
  }, [question, status, activeMatter, turns, chatId, addMessage, rootPath, askScope, profession, onAuditLog, buildAuditScope]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void handleAsk();
      }
    },
    [handleAsk],
  );

  const handleSaveToDocument = useCallback(async (idx: number, content: string) => {
    if (!onSaveToDocument) return;
    setSavingIdx(idx);
    try {
      await onSaveToDocument(content);
    } finally {
      setSavingIdx(null);
    }
  }, [onSaveToDocument]);

  const isBusy = status === 'retrieving' || status === 'answering';

  return {
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
  };
}

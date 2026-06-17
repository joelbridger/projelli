/**
 * useAsk — the logic layer for Ask (state, refs, the seven effects, the
 * recent-sessions derivations, and the RAG → provider → citation-parse `handleAsk`
 * orchestrator). Extracted VERBATIM from Ask.tsx so the component is a
 * pure render over this hook's return. See Ask.tsx for the surface-level
 * documentation (scope toggle, citation-first design, chatId convention).
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useActiveMatter, SAMPLE_MATTER_ID } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { getDemoAnswerForWorkspace, getDemoQuestions } from '@/platform/matter/samples/sampleMatterDemo';
import { useProfessionStore } from '@/platform/profile/professionStore';
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import {
  DEFAULT_WORKSPACE_TOP_K,
  buildWorkspaceContextBlock,
  citationBasename,
  parseCitations,
  resolveCitationPath,
} from '@/platform/rag/workspaceCommand';
import type { WorkspaceSource } from '@/platform/types/ai';
import type { RagHit, RetrievalScope } from '@/platform/utils/tauri-commands';
import { KeychainService } from '@/platform/providers/KeychainService';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import type { ChatMessage } from '@/platform/types/ai';
import type { AskScope, AnswerCitation, AskTurn } from './askHelpers';
import {
  sourceLocator,
  hasCloudKey,
  buildProviderAsync,
  friendlyErrorMessage,
  buildHistoryBlock,
  reconstructTurns,
  filterHitsByScope,
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
}

export function useAsk({
  onSaveToDocument,
  prefillRequest,
  onPrefillConsumed,
  onOpenFileAtPath,
}: UseAskProps) {
  const activeMatter = useActiveMatter();
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const profession = useProfessionStore((s) => s.profession);
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
  // Fix #8: track the active provider name for EgressIndicator
  const [activeProvider, setActiveProvider] = useState<string>('anthropic');

  // Recent sessions: sessions keyed "ask-*"
  const recentSessions = Object.entries(sessions)
    .filter(([key, session]) => key.startsWith('ask-') && session.messages.some((m) => m.role === 'user'))
    .map(([key, session]) => {
      const firstUserMsg = session.messages.find((m) => m.role === 'user');
      // Fix #6: include a readable timestamp for the sub-label so chips are distinguishable.
      const ts = firstUserMsg?.timestamp;
      const dateLabel = ts
        ? (() => {
            try {
              const d = new Date(ts);
              return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
            } catch {
              return '';
            }
          })()
        : '';
      return { chatId: key, label: firstUserMsg?.content ?? key, dateLabel };
    })
    .slice(0, 5);

  // Matter-scoped prior sessions: sessions whose key starts with "ask-<matterId>"
  // (covers both the base id and timestamped variants like ask-<matterId>-<ts>).
  // Only shown for non-sample real matters on the empty/landing state.
  const matterSessionPrefix = activeMatter ? `ask-${activeMatter.id}` : null;
  const matterRecentSessions = matterSessionPrefix !== null
    ? Object.entries(sessions)
        .filter(([key, session]) =>
          key.startsWith(matterSessionPrefix) &&
          session.messages.some((m) => m.role === 'user') &&
          key !== chatId,
        )
        .map(([key, session]) => {
          const firstUserMsg = session.messages.find((m) => m.role === 'user');
          // Fix #6: include timestamp so chips with similar starts are distinguishable.
          const ts = firstUserMsg?.timestamp;
          const dateLabel = ts
            ? (() => {
                try {
                  const d = new Date(ts);
                  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
                } catch {
                  return '';
                }
              })()
            : '';
          return { chatId: key, label: firstUserMsg?.content ?? key, dateLabel };
        })
        .slice(0, 5)
    : [];

  // On mount / chatId change: init session and reconstruct turns from persisted messages.
  // Fix #1: read getState() instead of the closed-over `sessions` selector so we always
  // see the post-initSession state, not a stale snapshot captured at render time.
  // A3: for the sample matter, always start with the empty chip state (never restore a
  // prior demo answer) so the "click a question" aha moment shows on every fresh visit.
  useEffect(() => {
    initSession(chatId, []);
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
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Fix #8: resolve the active provider name for the EgressIndicator.
  useEffect(() => {
    void (async () => {
      const kc = new KeychainService('localStorage');
      const ak = await kc.getKey('anthropic');
      if (ak?.trim()) { setActiveProvider('anthropic'); return; }
      const ok = await kc.getKey('openai');
      if (ok?.trim()) { setActiveProvider('openai'); return; }
      const gk = await kc.getKey('google');
      if (gk?.trim()) { setActiveProvider('google'); return; }
      setActiveProvider('ollama');
    })();
  }, []);

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
      if (isMemoryEnabled()) {
        const rawHits = await MemoryService.retrieve(q, DEFAULT_WORKSPACE_TOP_K, retrievalScope, false);
        // Apply client-side type filter for Email/Documents scopes.
        hits = filterHitsByScope(rawHits, askScope);
      }

      if (abort.signal.aborted) return;

      /* Step 2: call the AI provider */
      setStatus('answering');

      const workspaceBlock = hits.length > 0 ? buildWorkspaceContextBlock(hits) : '';

      const matterHint = activeMatter
        ? `You are answering a question scoped to the legal matter "${matterLabel(activeMatter)}".`
        : "You are answering a question across all matters in the attorney's practice.";

      // Build history from completed turns (last 6)
      const historyBlock = buildHistoryBlock(turns, 6);

      const systemPrompt = [
        matterHint,
        "You are a legal research assistant. Answer the attorney's question concisely in prose.",
        "After every factual claim, cite the source document using the format [filename paragraph N] (the exact filename and paragraph number from the context block below).",
        'Never invent citations. If the context does not contain enough information, say so honestly.',
        'Respond in 3-6 sentences maximum.',
        workspaceBlock,
        historyBlock,
      ]
        .filter(Boolean)
        .join('\n\n');

      let answerText = '';
      const provider = await buildProviderAsync();

      if (typeof provider.sendMessageStreaming === 'function') {
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
      } else {
        const resp = await provider.sendMessage(q, { systemPrompt });
        answerText = resp.content;
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (abort.signal.aborted) return;

      /* Step 3: parse citations */
      const parsed = parseCitations(answerText);

      const sources: WorkspaceSource[] = hits.map((h) => ({
        path: h.path,
        chunkText: h.chunkText,
        score: h.score,
        paragraphIndex: h.paragraphIndex,
        ...(h.sourceType !== undefined ? { sourceType: h.sourceType } : {}),
        ...(h.pageNumber !== undefined ? { pageNumber: h.pageNumber } : {}),
        ...(h.extraction !== undefined ? { extraction: h.extraction } : {}),
        ...(h.extractionConfidence !== undefined ? { extractionConfidence: h.extractionConfidence } : {}),
        ...(h.locator !== undefined ? { locator: h.locator } : {}),
        ...(h.id !== undefined ? { id: h.id } : {}),
        ...(h.matterId !== undefined ? { matterId: h.matterId } : {}),
      }));

      const citationMap = new Map<string, number>();
      const citations: AnswerCitation[] = [];
      let chipCounter = 0;
      let rewritten = answerText;
      const sorted = [...parsed].sort((a, b) => b.start - a.start);

      for (const cite of sorted) {
        const resolvedPath = resolveCitationPath(cite, hits);
        const key = `${resolvedPath ?? cite.basename}:${String(cite.paragraphIndex)}`;

        let n: number;
        if (citationMap.has(key)) {
          n = citationMap.get(key) ?? chipCounter;
        } else {
          chipCounter += 1;
          n = chipCounter;
          citationMap.set(key, n);

          const matchedSource =
            sources.find((s) => s.path === resolvedPath && s.paragraphIndex === cite.paragraphIndex) ??
            sources.find((s) => s.path === resolvedPath);

          // WS3: forward id + matterId from the matched hit so the SourcePanel
          // can call ragVerifyCitation for on-demand source verification.
          // Also forward paragraphIndex so CitationText chip click can open
          // the file directly at the cited passage (one-click navigation).
          const matchedHit = hits.find(
            (h) => h.path === resolvedPath && h.paragraphIndex === cite.paragraphIndex,
          ) ?? hits.find((h) => h.path === resolvedPath);
          citations.push({
            n,
            label: citationBasename(resolvedPath ?? cite.basename),
            excerpt: matchedSource?.chunkText ?? '',
            path: resolvedPath,
            locator: matchedSource ? sourceLocator(matchedSource) : cite.basename,
            verified: resolvedPath !== null,
            paragraphIndex: cite.paragraphIndex,
            ...(matchedHit?.id !== undefined ? { id: matchedHit.id } : {}),
            ...(matchedHit?.matterId !== undefined ? { matterId: matchedHit.matterId } : {}),
          });
        }

        rewritten =
          rewritten.slice(0, cite.start) + `{${String(n)}}` + rewritten.slice(cite.end);
      }

      citations.sort((a, b) => a.n - b.n);

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
      const raw = err instanceof Error ? err.message : '';
      // Fix #4: map raw provider error strings to plain-language user copy.
      setErrorMsg(friendlyErrorMessage(raw));
      setStreamingTurn(null);
      setStatus('error');
    }
  }, [question, status, activeMatter, turns, chatId, addMessage, rootPath, askScope, profession]);

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
    activeProvider,
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

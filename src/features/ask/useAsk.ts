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

/**
 * BUG-016: the single decline message shown when the answer is NOT in the
 * user's indexed files. Used both by the retrieval-evidence gate (when nothing
 * is retrieved) and referenced in the answer prompt (so the model declines with
 * identical wording), keeping the experience uniform whether the gate or the
 * model produces the decline.
 */
const NO_EVIDENCE_DECLINE =
  "I couldn't find anything about that in your documents.";

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
      const kc = new KeychainService();
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
      const memoryEnabled = isMemoryEnabled();
      if (memoryEnabled) {
        const rawHits = await MemoryService.retrieve(q, DEFAULT_WORKSPACE_TOP_K, retrievalScope, false);
        // Apply client-side type filter for Email/Documents scopes.
        hits = filterHitsByScope(rawHits, askScope);
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

      const workspaceBlock = hits.length > 0 ? buildWorkspaceContextBlock(hits) : '';

      const matterHint = activeMatter
        ? `You are answering a question scoped to the legal matter "${matterLabel(activeMatter)}".`
        : "You are answering a question across all matters in the attorney's practice.";

      // Build history from completed turns (last 6)
      const historyBlock = buildHistoryBlock(turns, 6);

      // BUG-016: the answer prompt is hardened to refuse fabrication. The model
      // must answer ONLY from the retrieved context, decline with the exact
      // NO_EVIDENCE_DECLINE wording when the context doesn't contain the answer,
      // and never state a figure/date/name or cite a source that isn't present
      // in the context. This is the model-side half of the grounding fix; the
      // citation-binding step below structurally drops any citation that still
      // doesn't resolve to a retrieved chunk.
      const systemPrompt = [
        matterHint,
        "You are a legal research assistant. Answer the attorney's question using ONLY the information in the context block below — the attorney's own files. Do not use outside knowledge.",
        `If the context block does not contain the answer, reply with exactly this sentence and nothing else: "${NO_EVIDENCE_DECLINE}" Do not guess, and never state a dollar amount, figure, date, deadline, or name that does not appear in the context block.`,
        "After every factual claim, cite the source in square brackets, copying the filename and its location EXACTLY as they appear in the matching source header in the context block — e.g. [contract.docx paragraph 3] or [filing.pdf page 2]. Only cite filenames that appear in the context block, and only the paragraph/page actually shown there. Never invent a citation or a source.",
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

      /* BUG-016 — citation grounding.
       * A citation is only kept (and shown as a chip / counted toward the
       * "Answered over your own files" banner) when it resolves to an ACTUAL
       * retrieved chunk — matched by the file AND the exact locator the chunk
       * was retrieved at (paragraph for text, page for PDF). This closes two
       * fabrication paths:
       *   - the model cites a file that wasn't retrieved at all (fake source);
       *   - the model cites a REAL retrieved file but attaches the claim to a
       *     paragraph/page that was never in the context (a real filename can't
       *     launder a fabricated claim).
       * Anything else is dropped and its marker stripped from the prose, so it
       * can never render a chip, populate the source panel with a (real or fake)
       * title, or trip the green attestation. We do this in two passes so chip
       * numbers run in reading order while text edits run back-to-front (edits
       * never shift an earlier, not-yet-processed match).
       */
      // BUG-065: the active matter scope for this Ask turn (null = All matters).
      // A citation only counts as grounded ("source found", green) when its
      // retrieved chunk has an id + matterId AND, in a matter-scoped turn,
      // belongs to that matter — fail closed, matching the chat verifier.
      const expectedMatterId: string | null =
        activeMatter && askScope !== 'all-matters' ? activeMatter.id : null;
      const citationMap = new Map<string, number>();
      const citations: AnswerCitation[] = [];
      let chipCounter = 0;
      // Pass 1 (reading order): decide keep/drop + assign chip numbers.
      const decisions: { start: number; end: number; n: number | null }[] = [];
      const inOrder = [...parsed].sort((a, b) => a.start - b.start);

      for (const cite of inOrder) {
        const resolvedPath = resolveCitationPath(cite, hits);
        // The cited LOCATOR must be a real retrieved chunk. The parsed number is
        // matched against a chunk's paragraphIndex (text) OR pageNumber (PDF),
        // so a model that writes "paragraph 3" or "page 3" for a page-3 source
        // both ground correctly, while a fabricated "paragraph 99" does not.
        const matchedHit = resolvedPath === null
          ? undefined
          : hits.find(
              (h) =>
                h.path === resolvedPath &&
                (h.paragraphIndex === cite.paragraphIndex || h.pageNumber === cite.paragraphIndex),
            );

        if (!matchedHit) {
          decisions.push({ start: cite.start, end: cite.end, n: null });
          continue;
        }

        const key = matchedHit.id ?? `${matchedHit.path}:${String(matchedHit.paragraphIndex)}`;
        let n: number;
        if (citationMap.has(key)) {
          n = citationMap.get(key) ?? chipCounter;
        } else {
          chipCounter += 1;
          n = chipCounter;
          citationMap.set(key, n);

          const matchedSource = sources.find(
            (s) => s.path === matchedHit.path && s.paragraphIndex === matchedHit.paragraphIndex,
          );
          citations.push({
            n,
            label: citationBasename(matchedHit.path),
            // Excerpt + locator come from the matched RETRIEVED chunk, never
            // from the model's text, so the source panel always shows real
            // retrieved content.
            excerpt: matchedHit.chunkText,
            path: matchedHit.path,
            locator: matchedSource ? sourceLocator(matchedSource) : citationBasename(matchedHit.path),
            // BUG-065: fail closed. Only "source found" when the retrieved chunk
            // is identifiable (id + matterId) and in the active matter scope; a
            // chunk missing those, or from another matter, is NOT shown green.
            verified:
              matchedHit.id !== undefined &&
              matchedHit.matterId !== undefined &&
              (expectedMatterId === null || matchedHit.matterId === expectedMatterId),
            paragraphIndex: matchedHit.paragraphIndex,
            // WS3: forward id + matterId so the SourcePanel can call
            // ragVerifyCitation for on-demand source verification.
            ...(matchedHit.id !== undefined ? { id: matchedHit.id } : {}),
            ...(matchedHit.matterId !== undefined ? { matterId: matchedHit.matterId } : {}),
          });
        }
        decisions.push({ start: cite.start, end: cite.end, n });
      }

      // Pass 2 (back-to-front): rewrite kept markers to {n}, strip dropped ones.
      let rewritten = answerText;
      for (const d of [...decisions].sort((a, b) => b.start - a.start)) {
        if (d.n === null) {
          let start = d.start;
          // Swallow a single leading space so a dropped citation doesn't leave a
          // double space or a " ." gap behind it.
          if (start > 0 && rewritten[start - 1] === ' ') start -= 1;
          rewritten = rewritten.slice(0, start) + rewritten.slice(d.end);
        } else {
          rewritten = rewritten.slice(0, d.start) + `{${String(d.n)}}` + rewritten.slice(d.end);
        }
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
      // BUG-002: restore the typed question so the user can retry without
      // re-typing. The input was cleared optimistically before the try block;
      // on error we put it back.
      setQuestion(q);
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

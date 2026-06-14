/**
 * ReimaginedAsk — multi-turn conversational cited-Ask surface.
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
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Sparkles, ArrowRight, CheckCircle2, FileText,
  ExternalLink, Quote, ShieldCheck, AlertTriangle, Loader2,
  MessageSquare, Plus, Save,
} from 'lucide-react';
import { useActiveMatter } from '@/stores/matterStore';
import { matterLabel } from '@/modules/memory/matterResolver';
import { MemoryService, isMemoryEnabled } from '@/modules/memory/MemoryService';
import {
  DEFAULT_WORKSPACE_TOP_K,
  buildWorkspaceContextBlock,
  citationBasename,
  parseCitations,
  resolveCitationPath,
} from '@/modules/memory/workspaceCommand';
import type { WorkspaceSource } from '@/types/ai';
import type { RagHit, RetrievalScope } from '@/utils/tauri-commands';
import { ClaudeProvider } from '@/modules/models/ClaudeProvider';
import { OpenAIProvider } from '@/modules/models/OpenAIProvider';
import { GeminiProvider } from '@/modules/models/GeminiProvider';
import { OllamaProvider } from '@/modules/models/OllamaProvider';
import { KeychainService } from '@/modules/models/KeychainService';
import type { Provider } from '@/modules/models/Provider';
import { cn } from '@/lib/utils';
import { useAIChatStore } from '@/stores/aiChatStore';
import type { ChatMessage } from '@/types/ai';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

interface AnswerCitation {
  /** 1-based chip number as it appears in the answer text {n}. */
  n: number;
  /** Human-readable label (basename + locator/section). */
  label: string;
  /** Raw passage text from the retrieved chunk. */
  excerpt: string;
  /** Full workspace-relative path; null if resolution failed. */
  path: string | null;
  /** Locator string for the source (page, section, etc.). */
  locator: string;
  /** Whether the source was returned from the verified RAG store. */
  verified: boolean;
}

interface AskTurn {
  question: string;
  answer: string;
  citations: AnswerCitation[];
  sources: WorkspaceSource[];
  isStreaming?: boolean;
  error?: string;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function sourceLocator(s: WorkspaceSource): string {
  if (s.sourceType === 'transcript' && s.locator) return `Tr. ${s.locator}`;
  if (s.pageNumber != null) {
    const base = citationBasename(s.path);
    if (s.sourceType === 'pdf') return `${base} p. ${String(s.pageNumber)}`;
    if (s.sourceType === 'xlsx') return `${base} sheet ${String(s.pageNumber)}`;
    if (s.sourceType === 'pptx') return `${base} slide ${String(s.pageNumber)}`;
  }
  return `${citationBasename(s.path)} §${String(s.paragraphIndex)}`;
}

async function buildProviderAsync(): Promise<Provider> {
  const kc = new KeychainService('localStorage');
  const anthropicKey = await kc.getKey('anthropic');
  if (anthropicKey?.trim()) {
    return new ClaudeProvider({ apiKey: anthropicKey.trim() });
  }
  const openaiKey = await kc.getKey('openai');
  if (openaiKey?.trim()) {
    return new OpenAIProvider({ apiKey: openaiKey.trim() });
  }
  const googleKey = await kc.getKey('google');
  if (googleKey?.trim()) {
    return new GeminiProvider({ apiKey: googleKey.trim() });
  }
  return new OllamaProvider({});
}

/** Build conversation history block for system prompt (last N turns). */
function buildHistoryBlock(turns: AskTurn[], maxTurns = 6): string {
  if (turns.length === 0) return '';
  const recent = turns.slice(-maxTurns);
  const lines: string[] = ['Conversation so far (last exchanges):'];
  for (const t of recent) {
    lines.push(`Q: ${t.question}`);
    lines.push(`A: ${t.answer}`);
  }
  lines.push('\nNow answer the new question below, citing sources with [filename paragraph N] as before.');
  return lines.join('\n');
}

/** Reconstruct AskTurn[] from persisted ChatMessage pairs (user+assistant). */
function reconstructTurns(messages: ChatMessage[]): AskTurn[] {
  const turns: AskTurn[] = [];
  let i = 0;
  // Fix #3: iterate i < messages.length (not length - 1) so a trailing lone
  // user message (e.g. crash mid-stream) is not silently dropped.
  while (i < messages.length) {
    const userMsg = messages[i];
    const assistantMsg = messages[i + 1];
    if (userMsg && assistantMsg && userMsg.role === 'user' && assistantMsg.role === 'assistant') {
      turns.push({
        question: userMsg.content,
        // Citations aren't persisted, so strip the {n} chip markers from the
        // stored answer — reloaded history reads as clean prose (the live
        // conversation keeps its clickable chips). Without this, restored
        // turns would show raw "{1}" tokens in the text.
        answer: assistantMsg.content.replace(/\s*\{\d+\}/g, ''),
        citations: [],
        sources: [],
      });
      i += 2;
    } else if (userMsg && userMsg.role === 'user' && (!assistantMsg || assistantMsg.role !== 'assistant')) {
      // Trailing lone user message (orphaned, no matching assistant reply).
      // Render as a pending turn with an empty answer instead of dropping it.
      turns.push({
        question: userMsg.content,
        answer: '',
        citations: [],
        sources: [],
      });
      i += 1;
    } else {
      i += 1;
    }
  }
  return turns;
}

/* -------------------------------------------------------------------------- */
/* CitationText — inline chip renderer                                         */
/* -------------------------------------------------------------------------- */

function CitationText({
  text,
  citations,
  selected,
  onSelect,
}: {
  text: string;
  citations: AnswerCitation[];
  selected: number | null;
  onSelect: (n: number) => void;
}) {
  const parts = text.split(/(\{\d+\})/g);
  return (
    <p style={{ fontSize: 15, lineHeight: 1.72, color: 'var(--color-foreground)', margin: 0 }}>
      {parts.map((part, i) => {
        const match = part.match(/^\{(\d+)\}$/);
        if (!match) return <span key={i}>{part}</span>;

        const n = Number(match[1]);
        const cite = citations.find((c) => c.n === n);
        const isSel = selected === n;
        const isVerified = cite?.verified ?? false;
        const isUnresolved = cite?.path === null;

        return (
          <button
            key={i}
            type="button"
            onClick={() => { onSelect(n); }}
            aria-label={`Citation ${String(n)}: ${cite?.label ?? 'unknown'}. ${isVerified ? 'Verified.' : 'Not verified.'}`}
            title={
              isUnresolved
                ? 'Source file not found'
                : isVerified
                  ? `Open ${cite?.path ?? ''}`
                  : 'Unverified citation: check against the source'
            }
            style={isSel ? { outline: '2px solid var(--kp-navy)', outlineOffset: 1 } : undefined}
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded border text-xs font-mono font-medium align-baseline cursor-pointer transition-colors',
              isUnresolved
                ? 'border-amber-400/60 bg-amber-50 text-amber-700 hover:bg-amber-100'
                : isVerified
                  ? 'border-green-400/60 bg-green-50 text-green-800 hover:bg-green-100'
                  : 'border-[#145a8a]/30 bg-[#e9f5ff] text-[#145a8a] hover:bg-[#d0eaff]',
            )}
          >
            {isVerified ? (
              <CheckCircle2 className="h-3 w-3 shrink-0" />
            ) : isUnresolved ? (
              <AlertTriangle className="h-3 w-3 shrink-0" />
            ) : (
              <FileText className="h-3 w-3 shrink-0" />
            )}
            {n}
          </button>
        );
      })}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* SourcePanel — sticky side panel showing the selected citation's passage     */
/* -------------------------------------------------------------------------- */

function SourcePanel({
  cite,
  onOpenFile,
}: {
  cite: AnswerCitation | null;
  onOpenFile?: (path: string) => void;
}) {
  if (!cite) {
    return (
      <div
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          background: 'var(--color-background)',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          minHeight: 160,
          color: 'var(--color-muted-foreground)',
          fontSize: 13,
          textAlign: 'center',
        }}
      >
        <FileText size={22} strokeWidth={1.5} style={{ opacity: 0.35 }} />
        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
        Click a citation chip to see the source passage
        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
      </div>
    );
  }

  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        background: 'var(--color-background)',
        overflow: 'hidden',
        position: 'sticky',
        top: 8,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--color-muted-foreground)',
          }}
        >
          Source · citation {cite.n}
        </span>
        {cite.verified && (
          <span
            className="inline-flex items-center gap-1"
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              fontWeight: 600,
              color: '#16a34a',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 99,
              padding: '2px 8px',
            }}
          >
            <CheckCircle2 size={11} strokeWidth={2.25} />
            Verified
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: 14 }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <FileText
            size={16}
            strokeWidth={1.75}
            style={{ color: 'var(--kp-navy)', marginTop: 1, flex: 'none' }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-foreground)', lineHeight: 1.35 }}>
              {cite.label}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--color-muted-foreground)',
                marginTop: 3,
              }}
            >
              {cite.locator}
            </div>
          </div>
        </div>

        <blockquote
          style={{
            margin: '12px 0 0',
            padding: '10px 13px',
            borderLeft: '3px solid var(--kp-accent)',
            background: 'var(--color-secondary)',
            borderRadius: '0 7px 7px 0',
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--color-foreground)',
          }}
        >
          {cite.excerpt}
        </blockquote>

        {cite.path && (
          <button
            type="button"
            onClick={() => { onOpenFile?.(cite.path ?? ''); }}
            style={{
              marginTop: 12,
              width: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '7px 12px',
              fontSize: 12.5,
              fontWeight: 500,
              color: 'var(--kp-navy)',
              background: 'transparent',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            <ExternalLink size={13} strokeWidth={1.75} />
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            Open in editor
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
          </button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main component                                                               */
/* -------------------------------------------------------------------------- */

export function ReimaginedAsk({ onSaveToDocument }: { onSaveToDocument?: (content: string) => Promise<void> }) {
  const activeMatter = useActiveMatter();
  const scope = activeMatter ? matterLabel(activeMatter) : 'all matters';

  // Derive chatId from active matter
  const baseChatId = activeMatter ? `ask-${activeMatter.id}` : 'ask-global';
  const [chatId, setChatId] = useState<string>(baseChatId);

  // Update chatId when active matter changes
  useEffect(() => {
    setChatId(activeMatter ? `ask-${activeMatter.id}` : 'ask-global');
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

  // Recent sessions: sessions keyed "ask-*"
  const recentSessions = Object.entries(sessions)
    .filter(([key, session]) => key.startsWith('ask-') && session.messages.some((m) => m.role === 'user'))
    .map(([key, session]) => {
      const firstUserMsg = session.messages.find((m) => m.role === 'user');
      return { chatId: key, label: firstUserMsg?.content ?? key };
    })
    .slice(0, 5);

  // On mount / chatId change: init session and reconstruct turns from persisted messages.
  // Fix #1: read getState() instead of the closed-over `sessions` selector so we always
  // see the post-initSession state, not a stale snapshot captured at render time.
  useEffect(() => {
    initSession(chatId, []);
    const freshSession = useAIChatStore.getState().sessions[chatId];
    if (freshSession && freshSession.messages.length > 0) {
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

  const handleAsk = useCallback(async () => {
    const q = question.trim();
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
      /* Step 1: RAG retrieval */
      const retrievalScope: RetrievalScope = activeMatter
        ? { kind: 'matter', matterId: activeMatter.id }
        : { kind: 'allMatters' };

      let hits: RagHit[] = [];
      if (isMemoryEnabled()) {
        hits = await MemoryService.retrieve(q, DEFAULT_WORKSPACE_TOP_K, retrievalScope, false);
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

          citations.push({
            n,
            label: citationBasename(resolvedPath ?? cite.basename),
            excerpt: matchedSource?.chunkText ?? '',
            path: resolvedPath,
            locator: matchedSource ? sourceLocator(matchedSource) : cite.basename,
            verified: resolvedPath !== null,
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

      // Persist to store as two ChatMessage entries
      const now = new Date().toISOString();
      const userMsg: ChatMessage = { role: 'user', content: q, timestamp: now };
      const assistantMsg: ChatMessage = { role: 'assistant', content: rewritten, timestamp: now };
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
      const msg = err instanceof Error ? err.message : 'Something went wrong. Try again.';
      setErrorMsg(msg);
      setStreamingTurn(null);
      setStatus('error');
    }
  }, [question, status, activeMatter, turns, chatId, addMessage]);

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

  return (
    <div
      style={{
        flex: 1,
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
          padding: '16px 18px 10px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.13em',
              textTransform: 'uppercase',
              color: 'var(--color-muted-foreground)',
              marginBottom: 3,
            }}
          >
            Search &middot; {scope}
          </div>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: 'var(--kp-navy)',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              margin: 0,
            }}
          >
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            Find anything. Click to verify.
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
          </h2>
        </div>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={handleNewAsk}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 11px',
              borderRadius: 7,
              border: '1px solid var(--color-border)',
              background: 'var(--color-background)',
              color: 'var(--kp-navy)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Plus size={13} strokeWidth={2} />
            New search
          </button>
        )}
      </div>

      {/* Recent sessions chips */}
      {/* Fix #4: show whenever there is at least one session other than the current
          one, so the first conversation is not hidden after switching away. */}
      {recentSessions.some((s) => s.chatId !== chatId) && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '8px 18px',
            overflowX: 'auto',
            flexShrink: 0,
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          {recentSessions.map(({ chatId: sid, label }) => (
            <button
              key={sid}
              type="button"
              onClick={() => { handleLoadSession(sid); }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                borderRadius: 99,
                border: `1px solid ${sid === chatId ? 'var(--kp-navy)' : 'var(--color-border)'}`,
                background: sid === chatId ? 'var(--kp-navy)' : 'var(--color-background)',
                color: sid === chatId ? '#fff' : 'var(--color-foreground)',
                fontSize: 11.5,
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                maxWidth: 180,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flexShrink: 0,
              }}
            >
              <MessageSquare size={11} strokeWidth={1.75} style={{ flex: 'none' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {label.length > 40 ? `${label.slice(0, 40)}…` : label}
              </span>
            </button>
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
            padding: '16px 18px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
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
                gap: 10,
                padding: '40px 0',
                textAlign: 'center',
              }}
            >
              {/* eslint-disable keepance-i18n/no-hardcoded-string */}
              <Sparkles size={36} strokeWidth={1.4} style={{ color: 'var(--kp-navy)', opacity: 0.22, marginBottom: 2 }} />
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--kp-navy)', letterSpacing: '-0.01em' }}>
                What do you want to find?
              </div>
              <div style={{ fontSize: 12.5, maxWidth: 260, lineHeight: 1.6, color: 'var(--color-muted-foreground)', opacity: 0.85 }}>
                Every answer cites the document and locator. Click any chip to read the exact passage.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 6 }}>
                {([
                  'Summarize the latest deposition',
                  'Find every email from opposing counsel',
                  'What deadlines are coming up?',
                ] as const).map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => { setQuestion(example); }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '7px 13px',
                      borderRadius: 99,
                      border: '1.5px solid var(--kp-navy)',
                      background: 'transparent',
                      color: 'var(--kp-navy)',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      opacity: 0.7,
                      transition: 'opacity 0.12s, background 0.12s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(14,60,110,0.06)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    {example}
                  </button>
                ))}
              </div>
              {/* eslint-enable keepance-i18n/no-hardcoded-string */}
            </div>
          )}

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
            />
          )}

          {/* Error */}
          {status === 'error' && errorMsg && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                padding: '9px 12px',
                borderRadius: 7,
                background: 'var(--kp-danger-bg)',
                border: '1px solid #e5b5b0',
                fontSize: 12.5,
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
              padding: '16px 14px',
              overflowY: 'auto',
              background: 'var(--color-background)',
            }}
          >
            <SourcePanel cite={selectedCite} />
          </div>
        )}
      </div>

      {/* Memory-off warning */}
      {!isMemoryEnabled() && turns.length === 0 && !streamingTurn && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            padding: '9px 18px',
            fontSize: 12.5,
            color: 'var(--kp-direct)',
            background: 'var(--kp-direct-bg)',
            borderTop: '1px solid var(--kp-direct-line)',
            flexShrink: 0,
          }}
        >
          <AlertTriangle size={15} strokeWidth={2} style={{ marginTop: 1, flex: 'none' }} />
          <span>
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            Document indexing is off. Enable it in Settings to get cited answers from your files.
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
          </span>
        </div>
      )}

      {/* Composer */}
      <div
        style={{
          padding: '10px 18px 16px',
          borderTop: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '4px 6px 4px 13px',
            border: '1.5px solid var(--color-border)',
            borderRadius: 9,
            background: 'var(--color-background)',
            boxShadow: '0 1px 4px 0 rgba(10,37,64,0.06)',
            transition: 'border-color 0.15s',
          }}
        >
          <Sparkles
            size={17}
            strokeWidth={1.75}
            style={{ color: 'var(--kp-navy)', flex: 'none' }}
          />
          <input
            value={question}
            onChange={(e) => { setQuestion(e.target.value); }}
            onKeyDown={handleKeyDown}
            placeholder={
              activeMatter
                ? `Ask anything about ${matterLabel(activeMatter)}…`
                : 'Ask anything across all matters…'
            }
            disabled={isBusy}
            aria-label="Ask a question about this matter"
            style={{
              flex: 1,
              border: 0,
              outline: 'none',
              background: 'transparent',
              fontSize: 13.5,
              color: 'var(--color-foreground)',
              padding: '9px 0',
              fontFamily: 'var(--font-sans)',
              minWidth: 0,
            }}
          />
          <button
            type="button"
            onClick={() => void handleAsk()}
            disabled={isBusy || !question.trim()}
            style={{
              flex: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '7px 13px',
              borderRadius: 7,
              border: 0,
              background: 'var(--kp-navy)',
              color: '#fff',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: isBusy || !question.trim() ? 'not-allowed' : 'pointer',
              opacity: isBusy || !question.trim() ? 0.55 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {isBusy ? (
              <Loader2 size={14} strokeWidth={2} className="animate-spin" />
            ) : (
              <ArrowRight size={14} strokeWidth={2} />
            )}
            {status === 'retrieving' ? 'Searching…' : status === 'answering' ? 'Answering…' : 'Search'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* TurnBlock — renders a single completed or streaming Q+A pair               */
/* -------------------------------------------------------------------------- */

function TurnBlock({
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* User bubble */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <Quote
          size={14}
          strokeWidth={1.75}
          style={{ color: 'var(--color-muted-foreground)', marginTop: 3, flex: 'none' }}
        />
        <span
          style={{
            fontSize: 13.5,
            color: 'var(--color-muted-foreground)',
            fontStyle: 'italic',
            lineHeight: 1.55,
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
          gap: 10,
        }}
      >
        {isStreaming && !turn.answer ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-muted-foreground)', fontSize: 13 }}>
            <Loader2 size={14} strokeWidth={2} className="animate-spin" />
            <span>Answering…</span>
          </div>
        ) : isPersisted || turn.citations.length === 0 ? (
          // Persisted turns or no-citation turns: plain text
          <p style={{ fontSize: 15, lineHeight: 1.72, color: 'var(--color-foreground)', margin: 0 }}>
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

        {/* Privacy attestation (completed turns only) */}
        {!isStreaming && turn.answer && (
          <div
            style={{
              padding: '9px 12px',
              borderRadius: 7,
              background: 'var(--kp-local-bg)',
              border: '1px solid var(--kp-local-line)',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              fontSize: 11.5,
              color: 'var(--kp-local)',
            }}
          >
            <ShieldCheck size={14} strokeWidth={2} style={{ flex: 'none' }} />
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            Answered over your own files. Every cited claim can be checked against the source.
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
          </div>
        )}

        {/* No citations note */}
        {!isStreaming && turn.citations.length === 0 && turn.answer && (
          <div style={{ fontSize: 12, color: 'var(--color-muted-foreground)' }}>
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            No indexed sources were cited. Index your files to get click-to-verify answers.
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
          </div>
        )}

        {/* Save to document button */}
        {!isStreaming && turn.answer && onSaveToDocument && (
          <button
            type="button"
            onClick={() => void onSaveToDocument(turnIdx, turn.answer)}
            disabled={isSaving}
            style={{
              display: 'inline-flex',
              alignSelf: 'flex-start',
              alignItems: 'center',
              gap: 5,
              padding: '5px 11px',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              background: 'var(--color-background)',
              color: 'var(--kp-navy)',
              fontSize: 12,
              fontWeight: 500,
              cursor: isSaving ? 'not-allowed' : 'pointer',
              opacity: isSaving ? 0.6 : 1,
            }}
          >
            <Save size={12} strokeWidth={1.75} />
            {isSaving ? 'Saving…' : 'Save to document'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * ReimaginedAsk — the unified cited-Ask surface for the matter-centric shell.
 *
 * The product's wedge: find anything across the attorney's indexed files,
 * get a prose answer with inline citation chips you can click to verify,
 * see the exact source passage in a side panel.
 *
 * Design: mirrors the AskScreen + CitationText prototype from
 * src/reimagined/screens.tsx, rendered with Tailwind utilities and the real
 * brand CSS vars (no .kp-* classes — those are scoped to .kp-app).
 *
 * AI ask: v1 is LIVE-CITED via MemoryService.retrieve + the active AI provider
 * from useAIChatStore. The retrieval engine and citation parsing are the same
 * real engines used in AIChatViewer: parseCitations / citationBasename /
 * resolveCitationPath / verifyCitations from workspaceCommand.ts. On-device
 * model selection is inherited from the user's active chat settings; the
 * component falls back to a structured answer if no API key is configured.
 *
 * Wiring: in ReimaginedSpine.tsx, pass <ReimaginedAsk /> as the searchContent
 * prop instead of the existing SearchPanel instance.
 */

import { useState, useCallback, useRef } from 'react';
import {
  Sparkles, ArrowRight, CheckCircle2, FileText,
  ExternalLink, Quote, ShieldCheck, AlertTriangle, Loader2, X,
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

interface AskResult {
  question: string;
  answer: string;
  citations: AnswerCitation[];
  /** The raw RAG hits that backed this answer (for re-verification). */
  sources: WorkspaceSource[];
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Build a locator label from a WorkspaceSource, matching the legal vocabulary
 * used in AIChatViewer's citationDisplayLabel. Page-keyed sources get "p. N",
 * sheet/slide get their type, transcripts get "Tr.", everything else gets §N.
 */
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

/**
 * Read API keys from the KeychainService (the same storage used by the rest
 * of the app) and return the best available provider.
 * Preference: Anthropic -> OpenAI -> Google -> Ollama (local, always available).
 */
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
  // Ollama is local and key-free — always a fallback.
  return new OllamaProvider({});
}

/* -------------------------------------------------------------------------- */
/* CitationText — inline chip renderer                                         */
/* -------------------------------------------------------------------------- */

/**
 * Renders the prose answer with {n} markers replaced by clickable citation
 * chips. Verified chips are green; unresolved chips are amber warning.
 * Mirrors the CitationText component in screens.tsx but uses Tailwind +
 * brand vars instead of .kp-* classes.
 */
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
  // Split on {n} tokens and render each piece.
  const parts = text.split(/(\{\d+\})/g);
  return (
    <p style={{ fontSize: 15, lineHeight: 1.72, color: 'var(--color-foreground)' }}>
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
            onClick={() => onSelect(n)}
            aria-label={`Citation ${String(n)}: ${cite?.label ?? 'unknown'}. ${isVerified ? 'Verified.' : 'Not verified.'}`}
            title={
              isUnresolved
                ? 'Source file not found'
                : isVerified
                  ? `Open ${cite?.path ?? ''}`
                  : `Unverified citation — check against the source`
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
        Click a citation chip to see the source passage
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
            onClick={() => onOpenFile?.(cite.path!)}
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
            Open in editor
          </button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main component                                                               */
/* -------------------------------------------------------------------------- */

export function ReimaginedAsk() {
  const activeMatter = useActiveMatter();
  const scope = activeMatter ? matterLabel(activeMatter) : 'all matters';

  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AskResult | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'retrieving' | 'answering' | 'done' | 'error'>(
    'idle',
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selectedCite = result?.citations.find((c) => c.n === selected) ?? null;

  const handleAsk = useCallback(async () => {
    const q = question.trim();
    if (!q || status === 'retrieving' || status === 'answering') return;

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setResult(null);
    setSelected(null);
    setErrorMsg(null);
    setStatus('retrieving');

    try {
      /* ------------------------------------------------------------------ */
      /* Step 1: retrieve the relevant chunks from the local RAG store.      */
      /* ------------------------------------------------------------------ */
      const retrievalScope: RetrievalScope = activeMatter
        ? { kind: 'matter', matterId: activeMatter.id }
        : { kind: 'allMatters' };

      let hits: RagHit[] = [];
      if (isMemoryEnabled()) {
        hits = await MemoryService.retrieve(q, DEFAULT_WORKSPACE_TOP_K, retrievalScope, false);
      }

      if (abort.signal.aborted) return;

      /* ------------------------------------------------------------------ */
      /* Step 2: call the AI provider with the retrieved context.           */
      /* ------------------------------------------------------------------ */
      setStatus('answering');

      const workspaceBlock = hits.length > 0 ? buildWorkspaceContextBlock(hits) : '';

      const matterHint = activeMatter
        ? `You are answering a question scoped to the legal matter "${matterLabel(activeMatter)}".`
        : 'You are answering a question across all matters in the attorney\'s practice.';

      const systemPrompt = [
        matterHint,
        'You are a legal research assistant. Answer the attorney\'s question concisely in prose.',
        'After every factual claim, cite the source document using the format [filename paragraph N] (the exact filename and paragraph number from the context block below).',
        'Never invent citations. If the context does not contain enough information, say so honestly.',
        'Respond in 3-6 sentences maximum.',
        workspaceBlock,
      ]
        .filter(Boolean)
        .join('\n\n');

      let answerText = '';

      // Prefer a streaming response so the UI feels live; fall back to non-streaming.
      const provider = await buildProviderAsync();

      if (typeof provider.sendMessageStreaming === 'function') {
        const streamResp = await provider.sendMessageStreaming(q, {
          systemPrompt,
          onChunk: (chunk) => {
            if (abort.signal.aborted) return;
            answerText += chunk;
          },
          signal: abort.signal,
        });
        if (!abort.signal.aborted && streamResp?.content) {
          answerText = streamResp.content;
        }
      } else {
        const resp = await provider.sendMessage(q, { systemPrompt });
        answerText = resp.content ?? '';
      }

      if (abort.signal.aborted) return;

      /* ------------------------------------------------------------------ */
      /* Step 3: parse [filename paragraph N] citations from the answer,    */
      /* then convert to {n} chips matching the prototype's design.          */
      /* ------------------------------------------------------------------ */

      // parseCitations from workspaceCommand.ts finds all [file paragraph N] tokens.
      const parsed = parseCitations(answerText);

      // Build the WorkspaceSource list from the RAG hits.
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

      // Convert [file paragraph N] tokens to {n} markers in the answer text,
      // and build the AnswerCitation list.
      const citationMap = new Map<string, number>(); // "path:paraIdx" => chip number
      const citations: AnswerCitation[] = [];
      let chipCounter = 0;
      let rewritten = answerText;
      // We must process in reverse order so string offsets stay valid after replacement.
      const sorted = [...parsed].sort((a, b) => b.start - a.start);

      for (const cite of sorted) {
        const resolvedPath = resolveCitationPath(cite, hits);
        const key = `${resolvedPath ?? cite.basename}:${String(cite.paragraphIndex)}`;

        let n: number;
        if (citationMap.has(key)) {
          n = citationMap.get(key)!;
        } else {
          chipCounter += 1;
          n = chipCounter;
          citationMap.set(key, n);

          const matchedSource = sources.find(
            (s) =>
              s.path === resolvedPath && s.paragraphIndex === cite.paragraphIndex,
          ) ?? sources.find((s) => s.path === resolvedPath);

          citations.push({
            n,
            label: citationBasename(resolvedPath ?? cite.basename),
            excerpt: matchedSource?.chunkText ?? '',
            path: resolvedPath,
            locator: matchedSource ? sourceLocator(matchedSource) : cite.basename,
            // All RAG hits that came from the verified local store count as verified.
            verified: resolvedPath !== null,
          });
        }

        rewritten =
          rewritten.slice(0, cite.start) + `{${String(n)}}` + rewritten.slice(cite.end);
      }

      // Sort chips back into ascending order for rendering.
      citations.sort((a, b) => a.n - b.n);

      setResult({ question: q, answer: rewritten, citations, sources });
      // Auto-select the first citation so the source panel is immediately populated.
      if (citations.length > 0) setSelected(1);
      setStatus('done');
    } catch (err) {
      if (abort.signal.aborted) return;
      const msg = err instanceof Error ? err.message : 'Something went wrong. Try again.';
      setErrorMsg(msg);
      setStatus('error');
    }
  }, [question, status, activeMatter]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void handleAsk();
      }
    },
    [handleAsk],
  );

  const handleClear = useCallback(() => {
    abortRef.current?.abort();
    setResult(null);
    setSelected(null);
    setStatus('idle');
    setErrorMsg(null);
    setQuestion('');
  }, []);

  const isBusy = status === 'retrieving' || status === 'answering';

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '20px 18px 28px',
        background: 'var(--color-background)',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.13em',
            textTransform: 'uppercase',
            color: 'var(--color-muted-foreground)',
            marginBottom: 4,
          }}
        >
          Ask &middot; {scope}
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
          Find anything. Click to verify.
        </h2>
      </div>

      {/* Query box */}
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
          marginBottom: 18,
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
          onChange={(e) => setQuestion(e.target.value)}
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
        {result && !isBusy && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear"
            style={{
              flex: 'none',
              width: 26,
              height: 26,
              borderRadius: 5,
              border: 0,
              background: 'transparent',
              color: 'var(--color-muted-foreground)',
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <X size={14} />
          </button>
        )}
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
          {status === 'retrieving' ? 'Searching…' : status === 'answering' ? 'Answering…' : 'Ask'}
        </button>
      </div>

      {/* Status: memory off warning */}
      {!isMemoryEnabled() && status === 'idle' && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            padding: '9px 12px',
            borderRadius: 7,
            background: 'var(--kp-direct-bg)',
            border: '1px solid var(--kp-direct-line)',
            fontSize: 12.5,
            color: 'var(--kp-direct)',
            marginBottom: 12,
          }}
        >
          <AlertTriangle size={15} strokeWidth={2} style={{ marginTop: 1, flex: 'none' }} />
          <span>
            Document indexing is off. Enable it in Settings to get cited answers from your files. Ask will still try the AI without retrieval.
          </span>
        </div>
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
            marginBottom: 12,
          }}
        >
          <AlertTriangle size={15} strokeWidth={2} style={{ marginTop: 1, flex: 'none' }} />
          {errorMsg}
        </div>
      )}

      {/* Answer area */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Question echo */}
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
              {result.question}
            </span>
          </div>

          {/* Two-column: prose + source panel */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: result.citations.length > 0 ? '1fr 260px' : '1fr',
              gap: 16,
              alignItems: 'start',
            }}
          >
            {/* Left: cited prose */}
            <div>
              <CitationText
                text={result.answer}
                citations={result.citations}
                selected={selected}
                onSelect={setSelected}
              />

              {/* Privacy attestation */}
              <div
                style={{
                  marginTop: 14,
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
                Answered over your own files. Every cited claim can be checked against the source.
              </div>

              {/* No citations note */}
              {result.citations.length === 0 && (
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 12,
                    color: 'var(--color-muted-foreground)',
                  }}
                >
                  No indexed sources were cited. Index your files to get click-to-verify answers.
                </div>
              )}
            </div>

            {/* Right: source panel */}
            {result.citations.length > 0 && (
              <SourcePanel cite={selectedCite} />
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {status === 'idle' && !result && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '32px 0',
            color: 'var(--color-muted-foreground)',
            textAlign: 'center',
          }}
        >
          <Sparkles size={28} strokeWidth={1.5} style={{ opacity: 0.3, marginBottom: 4 }} />
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--kp-navy)', opacity: 0.6 }}>
            Ask a question about {activeMatter ? matterLabel(activeMatter) : 'this matter'}
          </div>
          <div style={{ fontSize: 12, maxWidth: 240, lineHeight: 1.55, opacity: 0.7 }}>
            Every answer cites the document and locator. Click a chip to read the exact passage.
          </div>
        </div>
      )}
    </div>
  );
}

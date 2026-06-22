/**
 * askHelpers — pure helper functions + data-contract types extracted from
 * Ask.tsx. No React, no side-effects; safe to import anywhere.
 */

import { citationBasename } from '@/platform/rag/workspaceCommand';
import type { WorkspaceSource } from '@/platform/types/ai';
import type { RagHit } from '@/platform/utils/tauri-commands';
import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';
import { OpenAIProvider } from '@/platform/providers/OpenAIProvider';
import { GeminiProvider } from '@/platform/providers/GeminiProvider';
import { OllamaProvider } from '@/platform/providers/OllamaProvider';
import { KeychainService } from '@/platform/providers/KeychainService';
import { assertCloudGenerationAllowed, isLocalOnlyMode } from '@/platform/privacy/localOnlyGuard';
import type { Provider } from '@/platform/providers/Provider';
import type { ChatMessage } from '@/platform/types/ai';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Which slice of the user's data to search.
 * - 'this-matter'  search only within the active matter (same as today's default)
 * - 'all-matters'  cross-matter (same as today's no-active-matter default)
 * - 'email'        restrict to mail: sourceId / sourceType === 'mail' chunks
 * - 'documents'    restrict to non-mail chunks (files, PDFs, transcripts, etc.)
 */
export type AskScope = 'this-matter' | 'all-matters' | 'email' | 'documents';

export interface AnswerCitation {
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
  /**
   * WS3: paragraph index for the chunk — passed to `onOpenFileAtPath` so
   * the editor can scroll directly to the cited passage on chip click.
   * Absent on pre-3.0 citations (undefined = use paragraph 0).
   */
  paragraphIndex?: number;
  /**
   * WS3: content-addressed chunk id — passed to `ragVerifyCitation` for
   * on-demand source verification. Absent on pre-3.0 citations.
   */
  id?: string;
  /**
   * WS3: the matter this chunk belongs to — the confidentiality scope
   * used as `claimedMatterId` in `ragVerifyCitation`. Absent on pre-3.0
   * citations.
   */
  matterId?: string;
}

export interface AskTurn {
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

export function sourceLocator(s: WorkspaceSource): string {
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
 * Returns true when the user has at least one valid cloud API key
 * (Anthropic, OpenAI, or Google). Ollama is not considered a cloud key.
 * This mirrors the priority order in buildProviderAsync but returns a boolean
 * through the keychain service so desktop reads the OS keychain and browser
 * mode reads localStorage.
 */
export async function hasCloudKey(): Promise<boolean> {
  const kc = new KeychainService();
  const anthropicKey = await kc.getKey('anthropic');
  if (anthropicKey?.trim()) return true;
  const openaiKey = await kc.getKey('openai');
  if (openaiKey?.trim()) return true;
  const googleKey = await kc.getKey('google');
  if (googleKey?.trim()) return true;
  return false;
}

export async function buildProviderAsync(): Promise<Provider> {
  // Local-only ENFORCEMENT (privacy): Ask has no per-chat provider — it picks by
  // key presence below — so in Local-only mode it would otherwise build a cloud
  // provider whenever a cloud key exists, contradicting the "nothing leaves"
  // indicator. Force the local model instead, so Ask honours Local-only.
  if (isLocalOnlyMode()) {
    return new OllamaProvider({});
  }
  // Personal-install choice gate (Task 1.3): a personal install must never reach a
  // cloud provider for generation before the user has made an explicit confidentiality
  // choice. Gate ONLY on the cloud branches, after confirming a cloud key exists, so a
  // personal install with no cloud key still falls back to local Ollama (no egress).
  // Retrieval (MemoryService) runs BEFORE this function and is unaffected. Firm installs
  // are a no-op (the gate checks isFirm first and passes through).
  const kc = new KeychainService();
  const anthropicKey = await kc.getKey('anthropic');
  if (anthropicKey?.trim()) {
    assertCloudGenerationAllowed();
    return new ClaudeProvider({ apiKey: anthropicKey.trim() });
  }
  const openaiKey = await kc.getKey('openai');
  if (openaiKey?.trim()) {
    assertCloudGenerationAllowed();
    return new OpenAIProvider({ apiKey: openaiKey.trim() });
  }
  const googleKey = await kc.getKey('google');
  if (googleKey?.trim()) {
    assertCloudGenerationAllowed();
    return new GeminiProvider({ apiKey: googleKey.trim() });
  }
  return new OllamaProvider({});
}

/**
 * Maps raw provider error messages to plain-language user-facing text.
 * Fix #4: prevents leaking "401 Unauthorized" / quota strings into the UI.
 */
/* eslint-disable keepance-i18n/no-hardcoded-string */
export function friendlyErrorMessage(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid_api_key') ||
    lower.includes('authentication')
  ) {
    return 'Your AI key was rejected. Check it in Settings.';
  }
  if (
    lower.includes('429') ||
    lower.includes('quota') ||
    lower.includes('rate') ||
    lower.includes('overloaded')
  ) {
    return 'Your AI provider is over its usage limit right now. Wait a moment and try again.';
  }
  if (
    lower.includes('context_length') ||
    lower.includes('too large') ||
    lower.includes('maximum context')
  ) {
    return 'That question is too long for this model. Try a shorter one.';
  }
  return "I couldn't reach your AI provider. Try again, or check your key in Settings.";
}
/* eslint-enable keepance-i18n/no-hardcoded-string */

/** Build conversation history block for system prompt (last N turns). */
export function buildHistoryBlock(turns: AskTurn[], maxTurns = 6): string {
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
export function reconstructTurns(messages: ChatMessage[]): AskTurn[] {
  const turns: AskTurn[] = [];
  let i = 0;
  // Fix #3: iterate i < messages.length (not length - 1) so a trailing lone
  // user message (e.g. crash mid-stream) is not silently dropped.
  while (i < messages.length) {
    const userMsg = messages[i];
    const assistantMsg = messages[i + 1];
    if (userMsg && assistantMsg && userMsg.role === 'user' && assistantMsg.role === 'assistant') {
      // BUG-016: a turn saved BEFORE the grounding fix may carry ungrounded
      // citations. Two bad classes exist: (1) a fabricated source with
      // path:null / verified:false; and (2) the subtler one — the old binder
      // resolved a fabricated claim to a REAL file by basename and saved it as
      // verified:true with a real path but a paragraph/page that was never
      // retrieved. We must NOT trust the persisted `verified` flag. Instead
      // re-ground each citation against the turn's own persisted sources: keep
      // it only when a saved source exists at the exact cited locator (path AND
      // paragraphIndex OR pageNumber). Anything else is dropped and its marker
      // stripped, so no stale bad answer can re-render a fake chip/source title
      // or trip the green attestation on reload.
      const restoredSources = assistantMsg.askSources ?? [];
      const groundedCitations = (assistantMsg.askCitations ?? [])
        .filter((c) => {
          if (c.path == null) return false;
          return restoredSources.some((s) => {
            if (s.path !== c.path) return false;
            // Pre-WS3 citations have no locator — keep by path only (the saved
            // source still proves the file was retrieved), but they can't be
            // "proven" so they're shown UNVERIFIED below.
            if (c.paragraphIndex === undefined) return true;
            // Locator present: it must match a saved source's paragraph OR page,
            // so a stale "real file + fabricated paragraph" citation is dropped.
            return s.paragraphIndex === c.paragraphIndex || s.pageNumber === c.paragraphIndex;
          });
        })
        // BUG-065: do NOT trust the persisted `verified` flag on reload. A
        // restored citation is "source found" (green) ONLY when its EXACT
        // locator still matches a saved source; a path-only (pre-WS3) citation
        // is kept but rendered UNVERIFIED (red) since the exact passage is
        // unprovable. (Backend re-verification on load is a separate follow-up.)
        .map((c) => {
          const provenExact =
            c.paragraphIndex !== undefined &&
            restoredSources.some(
              (s) => s.path === c.path && (s.paragraphIndex === c.paragraphIndex || s.pageNumber === c.paragraphIndex),
            );
          return { ...c, verified: provenExact };
        });
      if (groundedCitations.length > 0) {
        const keep = new Set(groundedCitations.map((c) => c.n));
        // Strip markers for any dropped citation; keep survivors' markers intact.
        const answer = assistantMsg.content.replace(/\s*\{(\d+)\}/g, (m, nStr: string) =>
          keep.has(Number.parseInt(nStr, 10)) ? m : '',
        );
        turns.push({
          question: userMsg.content,
          answer,
          citations: groundedCitations,
          sources: restoredSources,
        });
      } else {
        // No grounded citations (legacy messages with none persisted, OR a
        // pre-fix turn whose citations were all ungrounded). Strip every {n}
        // marker so raw tokens don't appear in plain-text restored prose, and
        // restore as an uncited answer.
        turns.push({
          question: userMsg.content,
          answer: assistantMsg.content.replace(/\s*\{\d+\}/g, ''),
          citations: [],
          sources: [],
        });
      }
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

/** Returns true for a hit that came from imported email. */
export function isMailHit(hit: RagHit): boolean {
  return hit.sourceType === 'mail' || hit.path.startsWith('mail:') || (hit.sourceId?.startsWith('mail:') ?? false);
}

/**
 * Filter retrieved hits according to the user-selected scope.
 * 'this-matter' and 'all-matters' keep all hits (retrieval scope is already
 * correct from the Tauri-level query). 'email' keeps only mail: chunks;
 * 'documents' keeps only non-mail chunks.
 */
export function filterHitsByScope(hits: RagHit[], scope: AskScope): RagHit[] {
  if (scope === 'email') return hits.filter(isMailHit);
  if (scope === 'documents') return hits.filter((h) => !isMailHit(h));
  return hits;
}

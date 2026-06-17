/**
 * Stream A2 — PDF token estimation for the cost meter.
 *
 * Formulas (approximate, per provider documentation and community benchmarks):
 *
 *   Claude  native:  ~1,500 tokens per page (Anthropic bills by image-equivalent
 *                    when using the document content block; each page renders as
 *                    a ~1500-token image). This is a conservative estimate.
 *                    Source: Anthropic's PDF support docs / community benchmarks.
 *   Claude  extract: tokens of extracted text ÷ 4 chars-per-token.
 *   OpenAI  extract: tokens of extracted text ÷ 4 chars-per-token.
 *   Gemini  extract: tokens of extracted text ÷ 4 chars-per-token.
 *   Ollama  extract: 0 (free inference; cost meter contribution skipped).
 *   Mock    any:     0 (test convenience).
 *
 * When extracted text is unavailable, fall back to a page-count estimate
 * using a typical-page word count (300 words × 1.33 tokens/word ≈ 400 tokens).
 */

import type { ChatAttachment } from '@/platform/types/ai';
import type { PdfMode } from '@/platform/providers/pdf-capability';

/** Anthropic's approximate token cost per page in native-PDF mode. */
const CLAUDE_NATIVE_TOKENS_PER_PAGE = 1500;

/** Fallback tokens-per-page for text-extract when no text length is available. */
const FALLBACK_TOKENS_PER_PAGE = 400;

/** Characters per token (tiktoken p50 average for English prose). */
const CHARS_PER_TOKEN = 4;

/**
 * Returns the estimated number of input tokens consumed by a single PDF
 * attachment for the given provider and processing mode.
 *
 * @param provider  - Provider ID ('claude'|'anthropic', 'openai', 'gemini'|'google',
 *                    'ollama', 'mock')
 * @param att       - The ChatAttachment with type 'pdf'
 * @param mode      - Whether the PDF is sent natively or as extracted text
 * @param extractedTextLength - Optional total char count of extracted text;
 *                              used for text-extract token estimation
 */
export function estimatePdfTokens(
  provider: string,
  att: ChatAttachment,
  mode: PdfMode,
  extractedTextLength?: number
): number {
  if (att.type !== 'pdf') return 0;

  const pageCount = att.metadata.pages ?? 1;

  // Ollama and Mock: no cost
  if (provider === 'ollama' || provider === 'mock') return 0;

  // Claude native: billed as images (~1500 tokens per page)
  if ((provider === 'claude' || provider === 'anthropic') && mode === 'native') {
    return CLAUDE_NATIVE_TOKENS_PER_PAGE * pageCount;
  }

  // Text-extract path (all providers including Claude Haiku)
  if (extractedTextLength !== undefined && extractedTextLength > 0) {
    return Math.ceil(extractedTextLength / CHARS_PER_TOKEN);
  }

  // Fallback: estimate from page count
  return FALLBACK_TOKENS_PER_PAGE * pageCount;
}

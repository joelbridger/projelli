/**
 * `@workspace` chat command — parsing, prompt injection, and citation
 * rendering helpers. Used by `AIChatViewer` for both the explicit
 * `@workspace` tag and the Ask-my-workspace chat mode (M2).
 *
 * Design notes:
 *   - `@workspace` can appear anywhere in the user message. We only
 *     recognize it when surrounded by word boundaries / whitespace /
 *     start-or-end of message so "contact@workspace.com" doesn't trip.
 *   - The tag is STRIPPED from the retrieval query (otherwise the
 *     embedding would include the literal token, polluting similarity
 *     scores). It is KEPT in the message content that gets rendered so
 *     the chip stays visible.
 *   - If the message is only `@workspace` (no question), callers pass
 *     the recent conversation history as a fallback query.
 *   - `<workspace_context>` block is provider-agnostic — a plain-text
 *     section that goes into whichever field each provider calls
 *     "system". Claude, OpenAI, and Gemini all already receive
 *     `systemPrompt` through the same `Provider` interface.
 *   - Citation format: `[filename paragraph N]` is the prompt we give
 *     the model. We accept both `§N` and `paragraph N` in responses
 *     when parsing citations so a model that slightly drifts is still
 *     rendered as clickable.
 */

import type { RagHit } from '@/utils/tauri-commands';

/** Regex matching the `@workspace` token with word-ish boundaries. */
const WORKSPACE_TAG_RE = /(^|[\s])@workspace(?=$|[\s\p{P}])/gu;

/** Default retrieval depth for `@workspace` / Ask-mode. */
export const DEFAULT_WORKSPACE_TOP_K = 8;

export interface ParsedWorkspaceCommand {
  /** Whether the message contains an `@workspace` tag. */
  hasCommand: boolean;
  /**
   * The user's question with the `@workspace` tag removed, trimmed.
   * Empty string if the message was only `@workspace` with no other
   * content — callers should fall back to recent context in that case.
   */
  query: string;
  /** The original message verbatim. Preserved so the chip stays visible. */
  raw: string;
}

/**
 * Parse a chat input for the `@workspace` command.
 *
 * Example: "@workspace how did we price the premium tier?"
 *   yields { hasCommand: true, query: "how did we price the premium tier?" }
 *
 * Example: "what's the price? @workspace"
 *   yields { hasCommand: true, query: "what's the price?" }
 *
 * Example: "@workspace"
 *   yields { hasCommand: true, query: "" }
 *
 * Example: "email me at a@workspace.com"
 *   yields { hasCommand: false, query: "email me at a@workspace.com" }
 */
export function parseWorkspaceCommand(message: string): ParsedWorkspaceCommand {
  const raw = message;
  WORKSPACE_TAG_RE.lastIndex = 0;
  const hasCommand = WORKSPACE_TAG_RE.test(message);
  if (!hasCommand) {
    return { hasCommand: false, query: message.trim(), raw };
  }
  // Strip every occurrence of the tag; preserve the single whitespace
  // character that preceded it (if any) so surrounding words don't merge.
  const stripped = message
    .replace(WORKSPACE_TAG_RE, (match) => {
      const first = match.charAt(0);
      return first === ' ' || first === '\t' || first === '\n' ? first : '';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return { hasCommand: true, query: stripped, raw };
}

/**
 * Strip `@workspace` from an arbitrary string. Thin wrapper around
 * `parseWorkspaceCommand` for callers that don't care about the flag.
 */
export function stripWorkspaceCommand(message: string): string {
  return parseWorkspaceCommand(message).query;
}

/** Produce a relative path basename for citation labels (`notes/pricing.md`
 *  becomes `pricing.md`). We keep full paths in the `<workspace_context>`
 *  block so the model can cite unambiguously, but the chip label is the
 *  basename because the paragraph index is the disambiguator users
 *  actually care about. */
export function citationBasename(path: string): string {
  const parts = path.split(/[\\/]/);
  const last = parts[parts.length - 1];
  return last && last.length > 0 ? last : path;
}

/**
 * Build the `<workspace_context>` section that gets prepended to the
 * system prompt. Provider-agnostic: every provider takes a systemPrompt
 * string, so we just prepend this block.
 *
 * Returns an empty string when `hits` is empty so callers can safely
 * string-concatenate without a conditional.
 */
export function buildWorkspaceContextBlock(hits: RagHit[]): string {
  if (hits.length === 0) return '';
  const sourceLines = hits
    .map((hit, idx) => {
      const n = idx + 1;
      return `[${n}] ${hit.path} paragraph ${hit.paragraphIndex}\n${hit.chunkText}`;
    })
    .join('\n\n');
  return (
    '<workspace_context>\n' +
    'Source files for this question:\n\n' +
    sourceLines +
    '\n</workspace_context>\n\n' +
    'Answer the user\'s question using only the workspace context above ' +
    'when possible. Cite sources inline using the format ' +
    '`[filename paragraph N]` where `filename` is the basename from the ' +
    'citation header and `N` is the paragraph number. If the answer ' +
    'cannot be found in the workspace context, say so plainly.'
  );
}

/** Rendered citation descriptor extracted from an assistant message. */
export interface ParsedCitation {
  /** Full matched substring, e.g. `[pricing.md paragraph 3]`. */
  match: string;
  /** Starting index of the match in the input string. */
  start: number;
  /** Ending index (exclusive). */
  end: number;
  /** Basename captured (e.g. `pricing.md`). */
  basename: string;
  /** Paragraph index parsed from the `paragraph N` / `§N` segment (0-based). */
  paragraphIndex: number;
}

/** Regex matching citations in either
 *  `[filename paragraph N]` or `[filename §N]` form. */
const CITATION_RE =
  /\[([^\[\]\n]+?)\s+(?:paragraph\s+|§\s*)(\d+)\]/gi;

/**
 * Scan a message for inline citations. Returns them in source order,
 * non-overlapping.
 */
export function parseCitations(content: string): ParsedCitation[] {
  const out: ParsedCitation[] = [];
  CITATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITATION_RE.exec(content)) !== null) {
    const basename = (m[1] ?? '').trim();
    const paraStr = m[2] ?? '0';
    const paragraphIndex = Number.parseInt(paraStr, 10);
    if (!basename || Number.isNaN(paragraphIndex)) continue;
    out.push({
      match: m[0],
      start: m.index,
      end: m.index + m[0].length,
      basename,
      paragraphIndex,
    });
  }
  return out;
}

/**
 * Resolve a citation basename to a real workspace-relative path using the
 * list of hits that came back from retrieval. Ambiguity is resolved by
 * preferring the hit with matching `paragraphIndex`; if multiple hits
 * share the same basename + paragraph, the first one wins.
 *
 * Returns `null` when no hit matches. The caller is responsible for
 * showing a "source not found" toast in that case.
 */
export function resolveCitationPath(
  citation: ParsedCitation,
  hits: RagHit[],
): string | null {
  if (hits.length === 0) return null;
  const byBasename = hits.filter(
    (h) =>
      citationBasename(h.path).toLowerCase() ===
      citation.basename.toLowerCase(),
  );
  if (byBasename.length === 0) return null;
  const exact = byBasename.find(
    (h) => h.paragraphIndex === citation.paragraphIndex,
  );
  return (exact ?? byBasename[0])?.path ?? null;
}

/**
 * Merge a base system prompt with the workspace context block. When `hits`
 * is empty, returns the base prompt unchanged. Exposed as a helper for
 * tests (and the eventual voice / MCP integration) so every caller builds
 * the exact same prompt shape.
 */
export function injectWorkspaceContext(
  basePrompt: string,
  hits: RagHit[],
): string {
  const block = buildWorkspaceContextBlock(hits);
  if (block.length === 0) return basePrompt;
  return `${block}\n\n${basePrompt}`;
}

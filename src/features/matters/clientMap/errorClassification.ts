// src/features/matters/clientMap/errorClassification.ts
//
// Client Map build/update failures used to collapse into one message: "Check
// your AI connection." That's wrong whenever the real failure was retrieval
// (the local memory/search index), not the AI provider — e.g. the Rust RAG
// layer refuses to serve results when its safety record can't be read
// (`src-tauri/src/commands/rag/query.rs`, "memory integrity is uncertain ...
// re-index this workspace before searching"). Telling an advisor to check
// their AI key for a search-index problem is a dead end.
//
// `buildClientMap`/`computeSourceFingerprint` don't expose a typed retrieval
// error — the Tauri command returns `Result<T, String>`, so the only signal
// on the wire is the message text (there is no discriminated error type to
// check `instanceof` against; changing that is a Rust-side change and out of
// scope here). Provider failures are similarly untyped in practice: real
// providers (`ClaudeProvider`/`OpenAIProvider`/`GeminiProvider`) mostly throw
// plain `Error`s with provider-prefixed messages ("Claude API error: ...",
// "Failed to fetch", etc.) rather than the typed `ProviderError` — only a
// couple of internal branches (tool-loop limits, `MockProvider`) actually
// throw `ProviderError`. So classification here mirrors the same
// message-pattern approach already shipped for Ask's `friendlyErrorMessage`
// (`src/features/ask/askHelpers.ts`, UX-29): typed check first where one
// genuinely exists, text patterns otherwise.

import { ProviderError } from '@/platform/providers/Provider';
import { MODEL_NOT_READY } from '@/platform/utils/tauri-commands';

export type ClientMapErrorKind = 'index' | 'provider' | 'desktopOnly' | 'unknown';

/** Matches the browser build's "no Tauri backend" throw from `ragRetrieve`
 *  (`src/platform/utils/tauri-commands.ts`'s `!isTauri()` guards ahead of
 *  every RAG command: "RAG is only available in the desktop app."). This is
 *  NOT a transient index/rebuild problem (QA-13) — the browser build has no
 *  Rust/LanceDB engine at all, so it can never be resolved by retrying or
 *  reopening the client. Checked before `INDEX_ERROR_PATTERN`, which would
 *  otherwise also match this text. */
const DESKTOP_ONLY_ERROR_PATTERN = /rag is only available in the desktop app/i;

/** Matches the RAG/retrieval-layer failure text — every way `rag_retrieve`
 *  (`src-tauri/src/commands/rag/query.rs` + the `cached_chunks_table` helper
 *  it calls in `state.rs`) can fail before an AI provider is ever called: the
 *  safety-record integrity refusal ("memory integrity ... re-index"), opening
 *  the local vector store ("open lancedb: ...", "list tables: ...", "open
 *  table: ..."), the embedding step ("embed query: ...", including the
 *  `MODEL_NOT_READY` marker for a still-downloading local model — mirrors
 *  `refusalKeyForReason` in `src/features/ask/AIChatViewer.tsx`), and the
 *  vector search step ("nearest: ..."). The browser's "no Tauri backend"
 *  throw is classified separately as 'desktopOnly' (QA-13), not here.
 *  Deliberately excludes "invalid scope matter_id" — that's a caller bug,
 *  not something re-indexing fixes, so it falls to 'unknown' instead. */
const INDEX_ERROR_PATTERN = new RegExp(
  `memory integrity|re-?index|open lancedb|list tables|open table|embed query|nearest:|${MODEL_NOT_READY}`,
  'i',
);

/** Matches known AI-provider failure text: provider-prefixed API errors,
 *  HTTP 4xx/5xx, network/timeout/CORS failures (including "Network error:
 *  Unable to connect to Claude API ..." — `ClaudeProvider.makeRequest`'s
 *  fetch/CORS-failure wrapper, plus the raw "Failed to fetch" other
 *  providers can surface unwrapped), and rate-limit/quota wording. */
const PROVIDER_ERROR_PATTERN =
  /claude api error|openai api error|gemini api error|failed to fetch|network ?error|cors error|http (4|5)\d\d|timed? ?out|timeout|econnrefused|rate.?limit|quota|overloaded|unauthorized|invalid_api_key/i;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
}

/** Classify a Client Map build/update failure into one of four buckets so the
 *  UI can name the real problem instead of always blaming the AI connection. */
export function classifyClientMapError(error: unknown): ClientMapErrorKind {
  if (error instanceof ProviderError) return 'provider';
  const text = errorText(error);
  if (DESKTOP_ONLY_ERROR_PATTERN.test(text)) return 'desktopOnly';
  if (INDEX_ERROR_PATTERN.test(text)) return 'index';
  if (PROVIDER_ERROR_PATTERN.test(text)) return 'provider';
  return 'unknown';
}

const INDEX_ERROR_MESSAGE =
  "This client's memory needs to rebuild before the map can update. Try again in a moment — if it keeps happening, reopen this client to trigger a fresh index.";
const PROVIDER_BUILD_MESSAGE = 'Could not build client map. Check your AI connection and try again.';
const UNKNOWN_BUILD_MESSAGE = 'Could not build client map. Try again in a moment.';
/** QA-13: the browser build has no Rust/LanceDB engine at all, so unlike the
 *  other messages this must never suggest retrying — there is nothing a
 *  retry or a reopen can fix on this seat. */
const DESKTOP_ONLY_BUILD_MESSAGE =
  "Client Map's cited search needs the desktop app. This browser build can't index this client's files — install the desktop app to build the map.";

/** User-facing message for a `generate()` failure (first build / full rebuild). */
export function clientMapBuildErrorMessage(error: unknown): string {
  switch (classifyClientMapError(error)) {
    case 'desktopOnly':
      return DESKTOP_ONLY_BUILD_MESSAGE;
    case 'index':
      return INDEX_ERROR_MESSAGE;
    case 'provider':
      return PROVIDER_BUILD_MESSAGE;
    case 'unknown':
      return UNKNOWN_BUILD_MESSAGE;
  }
}

const INDEX_UPDATE_MESSAGE =
  "This client's memory needs to rebuild before updates can be checked. Try again in a moment — if it keeps happening, reopen this client to trigger a fresh index.";
const GENERIC_UPDATE_MESSAGE = 'Could not check for client map updates. Try again in a moment.';
const DESKTOP_ONLY_UPDATE_MESSAGE =
  "Client Map's cited search needs the desktop app. This browser build can't check for updates — install the desktop app to keep this client's map current.";

/** User-facing message for a `checkForUpdates()` failure. This message never
 *  blamed the AI connection to begin with, so 'provider' and 'unknown' keep
 *  the existing generic copy — 'index' and 'desktopOnly' get specific copy. */
export function clientMapUpdateErrorMessage(error: unknown): string {
  const kind = classifyClientMapError(error);
  if (kind === 'desktopOnly') return DESKTOP_ONLY_UPDATE_MESSAGE;
  if (kind === 'index') return INDEX_UPDATE_MESSAGE;
  return GENERIC_UPDATE_MESSAGE;
}

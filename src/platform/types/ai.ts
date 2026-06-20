// AI Chat Types

/**
 * API key configuration for AI providers
 */
export interface APIKey {
  provider: 'anthropic' | 'openai' | 'google';
  key: string;
  isValid: boolean;
  lastValidated?: Date;
}

/**
 * A file attached to a chat message (image or PDF).
 * The file is stored in the workspace under `media/<YYYY-MM>/`.
 * `id` is the SHA-256 hex hash of the file bytes (enables dedup).
 */
export interface ChatAttachment {
  id: string;
  type: 'image' | 'pdf';
  mimeType: string;
  fileName: string;
  pathInWorkspace: string;
  byteSize: number;
  metadata: {
    pages?: number;
    width?: number;
    height?: number;
    extractionMode?: 'native' | 'text-extract';
  };
}

/**
 * One cited source chip stored with an assistant message.
 * Matches the `AnswerCitation` interface in `Ask.tsx` exactly.
 * Persisted alongside the message so citations survive navigation/reload.
 */
export interface PersistedCitation {
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
   * WS3 — paragraph index of the cited chunk. Persisted so chip-click
   * navigation works after reload and so citations can be RE-GROUNDED against
   * the saved sources on reload (BUG-016). Absent on pre-WS3 citations.
   */
  paragraphIndex?: number;
  /** WS3 — content-addressed chunk id (for ragVerifyCitation). Absent pre-WS3. */
  id?: string;
  /** WS3 — matter scope of the cited chunk. Absent pre-WS3. */
  matterId?: string;
}

/**
 * Message in an AI chat conversation
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO datetime
  isError?: boolean;
  /** Diagnostic info for parse errors — full raw response body, redacted */
  errorDiagnostic?: string;
  /**
   * Ask-surface citations persisted alongside the assistant message so that
   * clickable {n} chips and the Verified source panel survive navigation and
   * reload. Set only on assistant messages produced by Ask.
   * Optional for backward-compatibility with pre-fix legacy messages.
   */
  askCitations?: PersistedCitation[];
  /**
   * Ask-surface workspace sources persisted alongside the assistant message.
   * Set only on assistant messages produced by Ask (RAG path).
   * Optional for backward-compatibility with pre-fix legacy messages.
   */
  askSources?: WorkspaceSource[];
  /**
   * M2 — workspace retrieval hits associated with this turn. For
   * user-role messages this is the list of chunks that were retrieved
   * and injected into the system prompt. For assistant-role messages
   * this is a copy of the same list so the "Sources" accordion
   * rendered below the assistant response has the data it needs to
   * resolve inline `[filename paragraph N]` citations.
   */
  sources?: WorkspaceSource[];
  /**
   * M2 — human-readable warning surfaced inline when retrieval was
   * attempted but couldn't run (e.g. memory toggle is off). Shown as
   * subtle grey text below the message so the user knows the response
   * wasn't workspace-aware.
   */
  workspaceHint?: string;
  /**
   * WS-B/C — the matter scope this turn was retrieved under. Stamped on both
   * the user turn and the assistant reply so the UI can always show which
   * matter (or "All matters") the answer was confined to.
   */
  scope?: TurnScope;
  /**
   * Files attached to this message (images or PDFs).
   * Stored in the workspace under `media/<YYYY-MM>/` with SHA-256 dedup.
   */
  attachments?: ChatAttachment[];
  /**
   * Stream A4 — set to true on messages that are compressed summaries
   * produced by the compression algorithm. These messages are rendered
   * with the ✂️ CompressedSegmentMarker instead of normal message bubbles.
   */
  isCompressedSummary?: boolean;
  /**
   * Stream A4 — how many original messages were collapsed into this summary.
   * Used for the "Compressed: N messages -> X tokens" label.
   */
  originalMessageCount?: number;
  /**
   * Stream A4 — temporary flag set by the Expand action. When true the
   * original messages (marked compressedIntoId) are re-injected for the
   * NEXT send only, then this flag is cleared.
   */
  expandedForNextSend?: boolean;
  /**
   * Stream A4 — set on original messages that have been compressed.
   * Value is the `timestamp` of the CompressedSummary message they belong
   * to. Messages with this field are NOT sent to the AI unless Expand was
   * clicked.
   */
  compressedIntoId?: string;
}

/**
 * M2 — a single retrieval source attached to a chat message. Mirror of
 * `RagHit` from `@/platform/utils/tauri-commands` but redeclared here to keep
 * `@/platform/types/ai` free of Tauri imports (these messages are serialized to
 * `.aichat` files and may be round-tripped in browser mode).
 *
 * A3: adds optional sourceType and pageNumber for PDF chunks.
 */
export interface WorkspaceSource {
  path: string;
  chunkText: string;
  score: number;
  paragraphIndex: number;
  /** A3: 'text' | 'pdf'; G4 adds 'mail'; VG-2b adds the office formats;
   *  VG-3c adds certified deposition transcripts. */
  sourceType?: 'text' | 'pdf' | 'mail' | 'docx' | 'xlsx' | 'pptx' | 'rtf' | 'transcript';
  /** A3: 1-based page number for PDF chunks; VG-2b reuses it for the REAL
   *  1-based sheet/slide number on xlsx/pptx chunks; VG-3c reuses it for a
   *  transcript chunk's start page. Absent on pre-A3 rows. */
  pageNumber?: number;
  /** VG-3c: page:line locator for certified transcript chunks
   *  (`"startPage:startLine-endPage:endLine"`). Citation chips prefer it:
   *  "Tr. 45:12-46:3". Absent on every other source. */
  locator?: string;
  /** VG-2: `'ocr'` when this chunk was read from a scanned page by the local
   *  OCR engine; absent on natively-extracted chunks. Citations disclose it. */
  extraction?: 'ocr';
  /** VG-2: mean OCR word confidence (0-100) for the chunk's page. Below
   *  `OCR_LOW_CONFIDENCE` the citation is labelled a low-confidence scan. */
  extractionConfidence?: number;
  /**
   * WS-B/C: the content-addressed chunk id (the citation key). Passed to
   * `rag_verify_citation` to confirm a cited claim is real before it is
   * presented. Absent on pre-3.0 rows.
   */
  id?: string;
  /**
   * WS-B/C: the matter this chunk belongs to. Used both to scope the source
   * and as the `claimedMatterId` when verifying a citation.
   */
  matterId?: string;
  /**
   * WS-B/C: the resolvable source id — a file path or `mail:<message-id>`.
   * `mail:` sources open the email rather than a file in the editor.
   */
  sourceId?: string;
  /**
   * WS-B/C: result of `rag_verify_citation` for this source against the cited
   * claim. `true` = verified (safe to present); `false` = a citation that
   * pointed at this source did NOT verify (fabricated id, matter mismatch, or
   * misquote) and must be flagged. `undefined` = not verified (no citation
   * referenced it, or verification was skipped — e.g. browser/test mode).
   */
  verified?: boolean;
}

/**
 * WS-B/C — the scope a chat turn was retrieved under, stamped onto the
 * assistant message so the UI can show "Scoped to: <matter>" or
 * "Scoped to: All matters". `matterName` is the human label captured at send
 * time (the matter could be renamed/deleted later).
 */
export interface TurnScope {
  kind: 'matter' | 'allMatters';
  matterId?: string;
  matterName?: string;
}

/**
 * AI Chat file structure
 * Stored as .aichat files in the workspace
 */
export interface AIChatFile {
  id: string;
  title: string;
  created: string; // ISO datetime
  updated: string; // ISO datetime
  messages: ChatMessage[];
  /**
   * Which AI provider this chat sends to. `'ollama'` is a LOCAL provider:
   * inference runs on the user's own machine (127.0.0.1:11434) and nothing
   * leaves the device. The cloud providers (anthropic/openai/google) send the
   * prompt directly to that vendor with the user's own key (BYOK).
   */
  provider?: 'anthropic' | 'openai' | 'google' | 'ollama';
  model?: string; // Optional: specific model ID (e.g. 'claude-sonnet-4-5-20250514' or 'llama3.2:3b')
}

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
 * `RagHit` from `@/utils/tauri-commands` but redeclared here to keep
 * `@/types/ai` free of Tauri imports (these messages are serialized to
 * `.aichat` files and may be round-tripped in browser mode).
 *
 * A3: adds optional sourceType and pageNumber for PDF chunks.
 */
export interface WorkspaceSource {
  path: string;
  chunkText: string;
  score: number;
  paragraphIndex: number;
  /** A3: 'text' | 'pdf'; G4 adds 'mail'. Absent on pre-A3 rows. */
  sourceType?: 'text' | 'pdf' | 'mail';
  /** A3: 1-based page number for PDF chunks. Absent on pre-A3 rows. */
  pageNumber?: number;
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
  provider?: 'anthropic' | 'openai' | 'google'; // Optional: which AI provider
  model?: string; // Optional: specific model ID (e.g. 'claude-sonnet-4-5-20250514')
}

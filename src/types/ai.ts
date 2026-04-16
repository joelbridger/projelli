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
}

/**
 * M2 — a single retrieval source attached to a chat message. Mirror of
 * `RagHit` from `@/utils/tauri-commands` but redeclared here to keep
 * `@/types/ai` free of Tauri imports (these messages are serialized to
 * `.aichat` files and may be round-tripped in browser mode).
 */
export interface WorkspaceSource {
  path: string;
  chunkText: string;
  score: number;
  paragraphIndex: number;
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

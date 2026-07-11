// Provider Interface
// Abstract interface for AI model adapters
import type { ChatAttachment } from '@/platform/types/ai';
import type { PreparationStamp } from '@/platform/privacy/promptPreparationGuard';

/** Claude image block shape (returned by ClaudeProvider.formatAttachmentForRequest). */
export interface ClaudeImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

/** OpenAI image_url block shape. */
export interface OpenAIImageBlock {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

/** Gemini inlineData part shape. */
export interface GeminiInlineDataBlock {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

/**
 * Ollama images payload. Ollama passes images at the message level, not inside
 * a content block. The prefix `_ollama_images` is a convention used by
 * OllamaProvider.formatAttachmentForRequest to carry base64 strings back to
 * the message-construction code, which splices them into the request envelope.
 */
export interface OllamaImagesPayload {
  _ollama_images: string[];
}

/**
 * Stream A2 - Claude native PDF block shape.
 * Sent to the Anthropic Messages API as a content block with type 'document'.
 */
export interface ClaudeDocumentBlock {
  type: 'document';
  source: {
    type: 'base64';
    media_type: 'application/pdf';
    data: string; // base64-encoded PDF bytes
  };
}

/**
 * Stream A2 - Text extraction result block.
 * Used by OpenAI, Gemini, Ollama, and Mock providers when processing PDFs.
 * The provider embeds this text into the user message content rather than
 * as a binary attachment.
 *
 * The `_text_extract` prefix is a convention parallel to `_ollama_images`
 * from Plan A1: it signals to the message-construction code that this block
 * contributes injected text rather than a binary content block.
 */
export interface TextExtractBlock {
  _text_extract: {
    text: string;      // Full extracted text from all pages joined by double newline.
    pageCount: number;
    fileName: string;
  };
}

/**
 * Stream A1 — opaque content block returned by formatAttachmentForRequest.
 * Each provider defines its own shape; the union covers all known cases
 * so the call-site can pass it to the provider API without casting.
 */
export type ProviderContentBlock =
  | ClaudeImageBlock
  | OpenAIImageBlock
  | GeminiInlineDataBlock
  | OllamaImagesPayload
  | ClaudeDocumentBlock   // Stream A2: Claude native PDF
  | TextExtractBlock;     // Stream A2: all other providers, text-extract path

/**
 * Stream A1 — pre-read attachment bytes passed alongside a send call.
 * The AIChatViewer reads bytes from AttachmentService before calling
 * sendMessage/sendMessageStreaming, then bundles them here so each
 * provider can call its own formatAttachmentForRequest() internally
 * and insert the provider-specific content blocks into its API envelope.
 */
export interface AttachmentBytes {
  att: ChatAttachment;
  bytes: Uint8Array;
  /** Local-only OCR/PDF scan text used to prove a binary upload was inspected. */
  extractedText?: string;
}

/**
 * Options for sending a message to the model
 */
export interface SendOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  stopSequences?: string[];
  /** UX-39: AbortSignal so callers can cancel in-flight requests. */
  signal?: AbortSignal;
  /**
   * lp/localai-patience — per-request override for the whole-request timeout
   * that the LOCAL providers wrap around their fetch (see `composeRequestSignal`
   * / `DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS`). Ask sets this for an on-device send
   * to the SAME prompt-scaled budget its first-token watchdog uses, so the
   * request layer never aborts BEFORE that budget on a slow/big local prompt
   * (its default 120s is shorter than the up-to-4-min local budget). Omitted for
   * cloud sends, which keep the provider's default timeout unchanged. Only the
   * local providers (`AppLocalProvider`, `OllamaProvider`) read it.
   */
  requestTimeoutMs?: number;
  /**
   * Stream A1 — image attachments to include in the provider request.
   * Each entry contains the ChatAttachment metadata plus the raw bytes
   * already read from the workspace. Providers call their own
   * formatAttachmentForRequest() to produce provider-specific blocks.
   */
  attachmentBytes?: AttachmentBytes[];
  /**
   * Opaque proof that the cloud-bound request passed local prompt preparation.
   * Cloud adapters validate it immediately before their first network request.
   */
  preparationStamp?: PreparationStamp;
}

/**
 * Metadata about a model provider
 */
export interface ProviderMetadata {
  name?: string;
  providerId?: string;
  model: string;
  costPerInputToken?: number;
  costPerOutputToken?: number;
  costEstimate?: number; // cost per 1K tokens (average of input/output)
  latencyEstimate?: number; // average response time in ms
  estimatedLatencyMs?: number;
  capabilities?: {
    streaming?: boolean;
    functionCalling?: boolean;
    vision?: boolean;
    maxContextTokens?: number;
  };
}

/**
 * Token usage information
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Response from the model
 */
export interface ProviderResponse {
  content: string;
  usage: TokenUsage;
  cost: number;
  latency?: number;
  model: string;
  stopReason?: string;
}

/**
 * Callback for streaming text chunks
 */
export type StreamCallback = (chunk: string) => void;

/**
 * Options for streaming messages
 */
export interface StreamOptions extends SendOptions {
  onChunk: StreamCallback;
  signal?: AbortSignal;
}

/**
 * Options for structured output
 */
export interface StructuredOutputOptions {
  schema: OutputSchema;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Opaque proof that this cloud-bound request was locally prepared. */
  preparationStamp?: PreparationStamp;
}

/**
 * Provider error types
 */
export type ProviderErrorType =
  | 'api_error'
  | 'rate_limit'
  | 'authentication'
  | 'validation'
  | 'timeout'
  | 'network';

/**
 * Error from a model provider
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly type: ProviderErrorType,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Schema for structured output validation
 */
export interface OutputSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  properties?: Record<string, OutputSchema>;
  items?: OutputSchema;
  required?: string[];
  description?: string;
}

/**
 * Provider interface that all model adapters must implement
 */
export interface Provider {
  /**
   * Get metadata about this provider
   */
  getMetadata(): ProviderMetadata;

  /**
   * Check if the provider is properly configured (API key, etc.)
   */
  isConfigured?(): boolean;

  /**
   * Send a message and get a response
   */
  sendMessage(prompt: string, options?: SendOptions): Promise<ProviderResponse>;

  /**
   * Send a message and stream the response chunks
   */
  sendMessageStreaming?(prompt: string, options: StreamOptions): Promise<ProviderResponse>;

  /**
   * Call a tool function
   */
  toolCall?<T>(
    tool: string,
    params: Record<string, unknown>,
    options?: SendOptions
  ): Promise<T>;

  /**
   * Get structured output that conforms to a schema
   */
  structuredOutput<T>(
    prompt: string,
    options: StructuredOutputOptions
  ): Promise<T>;

  /**
   * Format a ChatAttachment + its raw bytes into the provider-specific
   * content-block shape expected by the provider's API.
   *
   * Stream A2: PDF text-extract providers return Promise<ProviderContentBlock>
   * because extractPdfText is async. Claude's native PDF path and all image
   * paths remain synchronous but are allowed to return a promise too.
   */
  formatAttachmentForRequest(
    att: ChatAttachment,
    bytes: Uint8Array,
    extractedText?: string,
  ): ProviderContentBlock | Promise<ProviderContentBlock>;

  /**
   * Return true if the attachment is supported by the given model,
   * or a non-empty string error message if not.
   * Providers return `true | string`; the interface uses a wider type
   * so stubs and implementations can both satisfy the contract until
   * each provider is updated in Stream A1.
   */
  supportsAttachment(att: ChatAttachment, model: string): boolean | string;

  /**
   * Stream A2 - Returns true when this provider instance supports the
   * Anthropic native PDF document block for the given model.
   *
   * For non-Claude providers this always returns false; they use text-extract.
   * Declared as optional so existing provider implementations that have not
   * yet been updated do not fail the type check.
   */
  supportsNativePdf?(model: string): boolean;
}

/**
 * Configuration for a model provider
 */
export interface ProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

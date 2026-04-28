// Provider Interface
// Abstract interface for AI model adapters
import type { ChatAttachment } from '@/types/ai';

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
 * Stream A1 — opaque content block returned by formatAttachmentForRequest.
 * Each provider defines its own shape; the union covers all known cases
 * so the call-site can pass it to the provider API without casting.
 */
export type ProviderContentBlock =
  | ClaudeImageBlock
  | OpenAIImageBlock
  | GeminiInlineDataBlock
  | OllamaImagesPayload;

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
   * Stream A will provide real implementations per provider.
   */
  formatAttachmentForRequest(att: ChatAttachment, bytes: Uint8Array): ProviderContentBlock;

  /**
   * Return true if the attachment is supported by the given model,
   * or a non-empty string error message if not.
   * Providers return `true | string`; the interface uses a wider type
   * so stubs and implementations can both satisfy the contract until
   * each provider is updated in Stream A1.
   */
  supportsAttachment(att: ChatAttachment, model: string): boolean | string;
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

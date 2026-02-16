// Provider Interface
// Abstract interface for AI model adapters

/**
 * Options for sending a message to the model
 */
export interface SendOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  stopSequences?: string[];
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

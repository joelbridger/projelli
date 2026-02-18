// Claude Provider
// Implements the Provider interface for Anthropic's Claude API

import type {
  Provider,
  ProviderResponse,
  SendOptions,
  StreamOptions,
  StructuredOutputOptions,
  ProviderMetadata,
} from './Provider';

// Claude model pricing (per 1K tokens)
const CLAUDE_PRICING: Record<string, { input: number; output: number }> = {
  // Latest models (Claude 4 series)
  'claude-opus-4-5-20251101': { input: 0.015, output: 0.075 },  // Latest Opus
  'claude-sonnet-4-5-20250514': { input: 0.003, output: 0.015 },
  'claude-haiku-4-20250514': { input: 0.00025, output: 0.00125 },
  // Legacy models
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
  'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
  'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
};

// Latency estimates in ms
const LATENCY_ESTIMATES: Record<string, number> = {
  'claude-opus-4-5-20251101': 25000,  // Latest Opus
  'claude-sonnet-4-5-20250514': 8000,
  'claude-haiku-4-20250514': 2000,
  'claude-sonnet-4-20250514': 8000,
  'claude-opus-4-20250514': 30000,
  'claude-3-5-sonnet-20241022': 8000,
  'claude-3-opus-20240229': 30000,
  'claude-3-sonnet-20240229': 10000,
  'claude-3-haiku-20240307': 2000,
};

export interface ClaudeProviderConfig {
  apiKey: string;
  model?: string;
  maxRetries?: number;
  baseUrl?: string;
  dangerouslySkipPermissions?: boolean;
  aiRules?: string;
}

/**
 * Check if we're running in Tauri desktop app
 */
function isTauriApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/**
 * Get the appropriate base URL for Anthropic API
 * - Dev mode (browser or Tauri): Vite proxy to bypass CORS
 * - Production Tauri: Direct API URL
 * - Production browser: Direct URL (would need backend proxy in real deployment)
 */
function getAnthropicBaseUrl(configBaseUrl?: string): string {
  if (configBaseUrl) return configBaseUrl;

  // In development (browser OR Tauri dev), always use Vite proxy to bypass CORS
  // The proxy is configured in vite.config.ts to forward /api/anthropic to api.anthropic.com
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    return '/api/anthropic';
  }

  // In production (Tauri or browser), use direct URL
  return 'https://api.anthropic.com';
}

interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | Array<{ type: string; text?: string }>;
}

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeContentBlock[];
}

interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface ClaudeRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: ClaudeMessage[];
  temperature?: number;
  stop_sequences?: string[];
  tools?: ClaudeTool[];
}

interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
}

interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: string;
  stop_sequence?: string;
  usage: ClaudeUsage;
}

interface ClaudeError {
  type: string;
  error: {
    type: string;
    message: string;
  };
}

/**
 * ClaudeProvider implements the Provider interface for Anthropic's Claude API
 */
export class ClaudeProvider implements Provider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly baseUrl: string;
  private readonly aiRules: string | undefined;
  private tools: ClaudeTool[] = [];
  private toolExecutor?: (toolName: string, parameters: Record<string, unknown>) => Promise<unknown>;

  constructor(config: ClaudeProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'claude-sonnet-4-5-20250514';
    this.maxRetries = config.maxRetries ?? 3;
    this.baseUrl = getAnthropicBaseUrl(config.baseUrl);
    this.aiRules = config.aiRules;
    // Note: dangerouslySkipPermissions in config is accepted but not used
    // as Claude API doesn't have a direct equivalent to Claude Code's permission system
  }

  /**
   * Set available tools for Claude to use
   */
  setTools(tools: ClaudeTool[], executor: (toolName: string, parameters: Record<string, unknown>) => Promise<unknown>): void {
    this.tools = tools;
    this.toolExecutor = executor;
  }

  /**
   * Send a message to Claude and get a response
   */
  async sendMessage(
    prompt: string,
    options?: SendOptions
  ): Promise<ProviderResponse> {
    const messages: ClaudeMessage[] = [{ role: 'user', content: prompt }];

    const request: ClaudeRequest = {
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      messages,
    };

    // Build system prompt with AI Rules prepended if available
    let systemPrompt = options?.systemPrompt || '';
    if (this.aiRules) {
      systemPrompt = this.aiRules + (systemPrompt ? `\n\n---\n\n${systemPrompt}` : '');
    }

    if (systemPrompt) {
      request.system = systemPrompt;
    }

    if (options?.temperature !== undefined) {
      request.temperature = options.temperature;
    }

    if (options?.stopSequences) {
      request.stop_sequences = options.stopSequences;
    }

    // Add tools if available
    if (this.tools.length > 0) {
      request.tools = this.tools;
    }

    let response = await this.makeRequest(request);
    let totalInputTokens = response.usage.input_tokens;
    let totalOutputTokens = response.usage.output_tokens;

    // Handle tool use loops
    while (response.stop_reason === 'tool_use' && this.toolExecutor) {
      const toolUses = response.content.filter((c) => c.type === 'tool_use');

      if (toolUses.length === 0) break;

      // Execute all tool calls
      const toolResults: ClaudeContentBlock[] = [];

      for (const toolUse of toolUses) {
        if (!toolUse.name || !toolUse.id) continue;

        try {
          const result = await this.toolExecutor(toolUse.name, toolUse.input ?? {});
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          });
        } catch (error) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          });
        }
      }

      // Add assistant response and tool results to conversation
      messages.push({
        role: 'assistant',
        content: response.content,
      });
      messages.push({
        role: 'user',
        content: toolResults,
      });

      // Continue conversation
      const nextRequest: ClaudeRequest = {
        ...request,
        messages,
      };

      response = await this.makeRequest(nextRequest);
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
    }

    const textContent = response.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');

    const cost = this.calculateCost(totalInputTokens, totalOutputTokens);

    return {
      content: textContent,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
      },
      cost,
      model: response.model,
      stopReason: response.stop_reason,
    };
  }

  /**
   * Send a message and stream the response
   */
  async sendMessageStreaming(
    prompt: string,
    options: StreamOptions
  ): Promise<ProviderResponse> {
    const { onChunk, signal, ...sendOpts } = options;

    const messages: ClaudeMessage[] = [{ role: 'user', content: prompt }];

    const request: ClaudeRequest & { stream: boolean } = {
      model: this.model,
      max_tokens: sendOpts.maxTokens ?? 4096,
      messages,
      stream: true,
    };

    let systemPrompt = sendOpts.systemPrompt || '';
    if (this.aiRules) {
      systemPrompt = this.aiRules + (systemPrompt ? `\n\n---\n\n${systemPrompt}` : '');
    }
    if (systemPrompt) {
      request.system = systemPrompt;
    }
    if (sendOpts.temperature !== undefined) {
      request.temperature = sendOpts.temperature;
    }
    if (sendOpts.stopSequences) {
      request.stop_sequences = sendOpts.stopSequences;
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      const errorBody = await response.json() as { error?: { message?: string } };
      throw new Error(`Claude API error: ${errorBody.error?.message ?? `HTTP ${response.status}`}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);

            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              const text = event.delta.text ?? '';
              fullContent += text;
              onChunk(text);
            } else if (event.type === 'message_start' && event.message?.usage) {
              inputTokens = event.message.usage.input_tokens ?? 0;
            } else if (event.type === 'message_delta') {
              if (event.usage) {
                outputTokens = event.usage.output_tokens ?? 0;
              }
              if (event.delta?.stop_reason) {
                stopReason = event.delta.stop_reason;
              }
            }
          } catch {
            // skip unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const cost = this.calculateCost(inputTokens, outputTokens);

    return {
      content: fullContent,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      cost,
      model: this.model,
      stopReason,
    };
  }

  /**
   * Get structured output from Claude
   */
  async structuredOutput<T>(
    prompt: string,
    options: StructuredOutputOptions
  ): Promise<T> {
    // Build a prompt that requests JSON output
    const structuredPrompt = `${prompt}

Please respond with valid JSON that matches this schema:
${JSON.stringify(options.schema, null, 2)}

IMPORTANT: Respond ONLY with the JSON object, no additional text or markdown code blocks.`;

    const sendOptions: SendOptions = {
      systemPrompt:
        options.systemPrompt ??
        'You are a helpful assistant that responds only with valid JSON.',
      temperature: options.temperature ?? 0,
    };
    if (options.maxTokens !== undefined) {
      sendOptions.maxTokens = options.maxTokens;
    }
    const response = await this.sendMessage(structuredPrompt, sendOptions);

    // Parse the response
    let jsonContent = response.content.trim();

    // Remove markdown code blocks if present
    if (jsonContent.startsWith('```json')) {
      jsonContent = jsonContent.slice(7);
    } else if (jsonContent.startsWith('```')) {
      jsonContent = jsonContent.slice(3);
    }
    if (jsonContent.endsWith('```')) {
      jsonContent = jsonContent.slice(0, -3);
    }
    jsonContent = jsonContent.trim();

    try {
      const parsed = JSON.parse(jsonContent) as T;
      return parsed;
    } catch (error) {
      throw new Error(
        `Failed to parse Claude response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get provider metadata
   */
  getMetadata(): ProviderMetadata {
    const pricing = CLAUDE_PRICING[this.model] ?? {
      input: 0.003,
      output: 0.015,
    };
    const latency = LATENCY_ESTIMATES[this.model] ?? 10000;

    return {
      name: 'Anthropic Claude',
      model: this.model,
      costPerInputToken: pricing.input / 1000,
      costPerOutputToken: pricing.output / 1000,
      estimatedLatencyMs: latency,
      capabilities: {
        streaming: true,
        functionCalling: true,
        vision: true,
        maxContextTokens: 200000,
      },
    };
  }

  /**
   * Calculate cost based on token usage
   */
  private calculateCost(inputTokens: number, outputTokens: number): number {
    const pricing = CLAUDE_PRICING[this.model] ?? {
      input: 0.003,
      output: 0.015,
    };
    return (
      (inputTokens * pricing.input) / 1000 +
      (outputTokens * pricing.output) / 1000
    );
  }

  /**
   * Make a request to the Claude API with retry logic
   */
  private async makeRequest(request: ClaudeRequest): Promise<ClaudeResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const errorBody = (await response.json()) as ClaudeError;
          const errorMessage =
            errorBody.error?.message ?? `HTTP ${response.status}`;

          // Check for rate limiting
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after');
            const waitTime = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : Math.pow(2, attempt) * 1000;
            await this.sleep(waitTime);
            continue;
          }

          throw new Error(`Claude API error: ${errorMessage}`);
        }

        return (await response.json()) as ClaudeResponse;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Detect network/CORS errors and provide helpful guidance
        if (lastError.message.includes('Failed to fetch') ||
            lastError.message.includes('NetworkError') ||
            lastError.name === 'TypeError') {

          // In Tauri app, this is likely a network connectivity issue
          if (isTauriApp()) {
            throw new Error(
              'Network error: Unable to connect to Claude API. ' +
              'Please check your internet connection and verify your API key is correct.'
            );
          }

          // In browser dev mode, check if we're on the wrong port
          const currentPort = typeof window !== 'undefined' ? window.location.port : '';
          if (import.meta.env.DEV && currentPort && currentPort !== '5173') {
            throw new Error(
              `CORS Error: You're accessing the app on port ${currentPort}. ` +
              `For AI features to work, run "npm run dev" and access the app at http://localhost:5173.`
            );
          }

          throw new Error(
            'Network error: Unable to connect to Claude API. Please check your internet connection.'
          );
        }

        // Don't retry on non-retryable errors
        if (
          lastError.message.includes('API error') &&
          !lastError.message.includes('429')
        ) {
          throw lastError;
        }

        // Exponential backoff
        if (attempt < this.maxRetries - 1) {
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError ?? new Error('Max retries exceeded');
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a Claude provider instance
 */
export function createClaudeProvider(
  config: ClaudeProviderConfig
): ClaudeProvider {
  return new ClaudeProvider(config);
}

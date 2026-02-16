// Claude Provider
// Implements the Provider interface for Anthropic's Claude API

import type {
  Provider,
  ProviderResponse,
  SendOptions,
  StructuredOutputOptions,
  ProviderMetadata,
} from './Provider';

// Claude model pricing (per 1K tokens)
const CLAUDE_PRICING: Record<string, { input: number; output: number }> = {
  'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
  'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
  'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
};

// Latency estimates in ms
const LATENCY_ESTIMATES: Record<string, number> = {
  'claude-3-opus-20240229': 30000,
  'claude-3-sonnet-20240229': 10000,
  'claude-3-haiku-20240307': 2000,
  'claude-3-5-sonnet-20241022': 8000,
  'claude-sonnet-4-20250514': 8000,
  'claude-opus-4-20250514': 30000,
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
 * Get the appropriate base URL for Anthropic API
 * Uses proxy in development to bypass CORS, direct URL otherwise
 */
function getAnthropicBaseUrl(configBaseUrl?: string): string {
  if (configBaseUrl) return configBaseUrl;

  // In development (browser), use Vite proxy to bypass CORS
  // The proxy is configured in vite.config.ts to forward /api/anthropic to api.anthropic.com
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    return '/api/anthropic';
  }

  // In production or non-browser environments, use direct URL
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
    this.model = config.model ?? 'claude-sonnet-4-20250514';
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

        // Detect CORS errors and provide helpful guidance
        if (lastError.message.includes('Failed to fetch') ||
            lastError.message.includes('NetworkError') ||
            lastError.name === 'TypeError') {
          // Check if we're on the wrong port
          const currentPort = typeof window !== 'undefined' ? window.location.port : '';
          if (currentPort && currentPort !== '5173') {
            throw new Error(
              `CORS Error: You're accessing the app on port ${currentPort}. ` +
              `For AI features to work, you must run "npm run dev" and access the app at http://localhost:5173. ` +
              `The Vite dev server provides the necessary CORS proxy for API calls.`
            );
          }
          throw new Error(
            'Failed to fetch: Network error or CORS issue. Make sure you\'re running the app with "npm run dev" at http://localhost:5173.'
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

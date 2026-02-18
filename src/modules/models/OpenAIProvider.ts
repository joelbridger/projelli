// OpenAI Provider
// Implements the Provider interface for OpenAI's GPT API

import type {
  Provider,
  ProviderResponse,
  SendOptions,
  StreamOptions,
  StructuredOutputOptions,
  ProviderMetadata,
} from './Provider';

// OpenAI model pricing (per 1K tokens)
const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4-32k': { input: 0.06, output: 0.12 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
};

// Latency estimates in ms
const LATENCY_ESTIMATES: Record<string, number> = {
  'gpt-4-turbo': 15000,
  'gpt-4': 30000,
  'gpt-4-32k': 45000,
  'gpt-3.5-turbo': 3000,
  'gpt-4o': 8000,
  'gpt-4o-mini': 2000,
};

export interface OpenAIProviderConfig {
  apiKey: string;
  model?: string;
  maxRetries?: number;
  baseUrl?: string;
  organization?: string;
  aiRules?: string;
}

/**
 * Get the appropriate base URL for OpenAI API
 * Uses proxy in development (browser or Tauri) to bypass CORS, direct URL otherwise
 */
function getOpenAIBaseUrl(configBaseUrl?: string): string {
  if (configBaseUrl) return configBaseUrl;

  // In development (browser OR Tauri dev), use Vite proxy to bypass CORS
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    return '/api/openai';
  }

  return 'https://api.openai.com';
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  stop?: string[];
  response_format?: { type: 'json_object' | 'text' };
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIChoice {
  index: number;
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: OpenAIUsage;
}

interface OpenAIError {
  error: {
    message: string;
    type: string;
    param?: string;
    code?: string;
  };
}

/**
 * OpenAIProvider implements the Provider interface for OpenAI's GPT API
 */
export class OpenAIProvider implements Provider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly baseUrl: string;
  private readonly organization: string | undefined;
  private readonly aiRules: string | undefined;

  constructor(config: OpenAIProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'gpt-4o';
    this.maxRetries = config.maxRetries ?? 3;
    this.baseUrl = getOpenAIBaseUrl(config.baseUrl);
    this.organization = config.organization ?? undefined;
    this.aiRules = config.aiRules;
  }

  /**
   * Send a message to OpenAI and get a response
   */
  async sendMessage(
    prompt: string,
    options?: SendOptions
  ): Promise<ProviderResponse> {
    const messages: OpenAIMessage[] = [];

    // Build system prompt with AI Rules prepended if available
    let systemPrompt = options?.systemPrompt || '';
    if (this.aiRules) {
      systemPrompt = this.aiRules + (systemPrompt ? `\n\n---\n\n${systemPrompt}` : '');
    }

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    const request: OpenAIRequest = {
      model: this.model,
      messages,
    };

    if (options?.maxTokens) {
      request.max_tokens = options.maxTokens;
    }

    if (options?.temperature !== undefined) {
      request.temperature = options.temperature;
    }

    if (options?.stopSequences) {
      request.stop = options.stopSequences;
    }

    const response = await this.makeRequest(request);

    const textContent = response.choices[0]?.message.content ?? '';

    const cost = this.calculateCost(
      response.usage.prompt_tokens,
      response.usage.completion_tokens
    );

    return {
      content: textContent,
      usage: {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
      cost,
      model: response.model,
      stopReason: response.choices[0]?.finish_reason ?? 'unknown',
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

    const messages: OpenAIMessage[] = [];

    let systemPrompt = sendOpts.systemPrompt || '';
    if (this.aiRules) {
      systemPrompt = this.aiRules + (systemPrompt ? `\n\n---\n\n${systemPrompt}` : '');
    }
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const request: OpenAIRequest & { stream: boolean } = {
      model: this.model,
      messages,
      stream: true,
    };

    if (sendOpts.maxTokens) request.max_tokens = sendOpts.maxTokens;
    if (sendOpts.temperature !== undefined) request.temperature = sendOpts.temperature;
    if (sendOpts.stopSequences) request.stop = sendOpts.stopSequences;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.organization) headers['OpenAI-Organization'] = this.organization;

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      const errorBody = await response.json() as OpenAIError;
      throw new Error(`OpenAI API error: ${errorBody.error?.message ?? `HTTP ${response.status}`}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullContent = '';
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
            const delta = event.choices?.[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
              onChunk(delta.content);
            }
            if (event.choices?.[0]?.finish_reason) {
              stopReason = event.choices[0].finish_reason;
            }
          } catch {
            // skip unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Estimate tokens since streaming doesn't always include usage
    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(fullContent.length / 4);
    const cost = this.calculateCost(inputTokens, outputTokens);

    return {
      content: fullContent,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      cost,
      model: this.model,
      stopReason,
    };
  }

  /**
   * Get structured output from OpenAI using JSON mode
   */
  async structuredOutput<T>(
    prompt: string,
    options: StructuredOutputOptions
  ): Promise<T> {
    // Build a prompt that requests JSON output
    const structuredPrompt = `${prompt}

Please respond with valid JSON that matches this schema:
${JSON.stringify(options.schema, null, 2)}

Respond ONLY with the JSON object.`;

    const messages: OpenAIMessage[] = [];

    messages.push({
      role: 'system',
      content:
        options.systemPrompt ??
        'You are a helpful assistant that responds only with valid JSON.',
    });

    messages.push({ role: 'user', content: structuredPrompt });

    const request: OpenAIRequest = {
      model: this.model,
      messages,
      response_format: { type: 'json_object' },
    };

    if (options.maxTokens) {
      request.max_tokens = options.maxTokens;
    }

    if (options.temperature !== undefined) {
      request.temperature = options.temperature;
    }

    const response = await this.makeRequest(request);

    const jsonContent = response.choices[0]?.message.content ?? '{}';

    try {
      const parsed = JSON.parse(jsonContent) as T;
      return parsed;
    } catch (error) {
      throw new Error(
        `Failed to parse OpenAI response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get provider metadata
   */
  getMetadata(): ProviderMetadata {
    const pricing = OPENAI_PRICING[this.model] ?? {
      input: 0.005,
      output: 0.015,
    };
    const latency = LATENCY_ESTIMATES[this.model] ?? 10000;

    // Determine max context based on model
    let maxContextTokens = 8192;
    if (this.model.includes('32k')) {
      maxContextTokens = 32768;
    } else if (this.model.includes('turbo') || this.model.includes('4o')) {
      maxContextTokens = 128000;
    } else if (this.model === 'gpt-4') {
      maxContextTokens = 8192;
    }

    return {
      name: 'OpenAI GPT',
      model: this.model,
      costPerInputToken: pricing.input / 1000,
      costPerOutputToken: pricing.output / 1000,
      estimatedLatencyMs: latency,
      capabilities: {
        streaming: true,
        functionCalling: true,
        vision: this.model.includes('4o') || this.model.includes('turbo'),
        maxContextTokens,
      },
    };
  }

  /**
   * Calculate cost based on token usage
   */
  private calculateCost(inputTokens: number, outputTokens: number): number {
    const pricing = OPENAI_PRICING[this.model] ?? {
      input: 0.005,
      output: 0.015,
    };
    return (
      (inputTokens * pricing.input) / 1000 +
      (outputTokens * pricing.output) / 1000
    );
  }

  /**
   * Make a request to the OpenAI API with retry logic
   */
  private async makeRequest(request: OpenAIRequest): Promise<OpenAIResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        };

        if (this.organization) {
          headers['OpenAI-Organization'] = this.organization;
        }

        const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const errorBody = (await response.json()) as OpenAIError;
          const errorMessage = errorBody.error?.message ?? `HTTP ${response.status}`;

          // Check for rate limiting
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after');
            const waitTime = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : Math.pow(2, attempt) * 1000;
            await this.sleep(waitTime);
            continue;
          }

          throw new Error(`OpenAI API error: ${errorMessage}`);
        }

        return (await response.json()) as OpenAIResponse;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

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
 * Create an OpenAI provider instance
 */
export function createOpenAIProvider(
  config: OpenAIProviderConfig
): OpenAIProvider {
  return new OpenAIProvider(config);
}

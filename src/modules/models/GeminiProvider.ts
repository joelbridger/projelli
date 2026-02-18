// Gemini Provider
// Implements the Provider interface for Google's Gemini API

import type {
  Provider,
  ProviderResponse,
  SendOptions,
  StreamOptions,
  StructuredOutputOptions,
  ProviderMetadata,
} from './Provider';

// Gemini model pricing (per 1K tokens) - as of 2024
const GEMINI_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-pro': { input: 0.000125, output: 0.000375 },
  'gemini-pro-vision': { input: 0.000125, output: 0.000375 },
  'gemini-1.5-pro': { input: 0.00125, output: 0.00375 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
};

// Latency estimates in ms
const LATENCY_ESTIMATES: Record<string, number> = {
  'gemini-pro': 5000,
  'gemini-pro-vision': 8000,
  'gemini-1.5-pro': 6000,
  'gemini-1.5-flash': 2000,
};

export interface GeminiProviderConfig {
  apiKey: string;
  model?: string;
  maxRetries?: number;
  baseUrl?: string;
  aiRules?: string;
}

/**
 * Get the appropriate base URL for Gemini API
 * Uses proxy in development (browser or Tauri) to bypass CORS, direct URL otherwise
 */
function getGeminiBaseUrl(configBaseUrl?: string): string {
  if (configBaseUrl) return configBaseUrl;

  // In development (browser OR Tauri dev), use Vite proxy to bypass CORS
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    return '/api/google';
  }

  return 'https://generativelanguage.googleapis.com';
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
}

interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

interface GeminiCandidate {
  content: {
    parts: Array<{ text: string }>;
    role: string;
  };
  finishReason: string;
  index: number;
}

interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata: GeminiUsageMetadata;
  promptFeedback?: {
    blockReason?: string;
  };
}

interface GeminiError {
  error: {
    code: number;
    message: string;
    status: string;
  };
}

/**
 * GeminiProvider implements the Provider interface for Google's Gemini API
 */
export class GeminiProvider implements Provider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly baseUrl: string;
  private readonly aiRules: string | undefined;

  constructor(config: GeminiProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'gemini-1.5-pro';
    this.maxRetries = config.maxRetries ?? 3;
    this.baseUrl = getGeminiBaseUrl(config.baseUrl);
    this.aiRules = config.aiRules;
  }

  /**
   * Send a message to Gemini and get a response
   */
  async sendMessage(
    prompt: string,
    options?: SendOptions
  ): Promise<ProviderResponse> {
    const contents: GeminiContent[] = [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ];

    const request: GeminiRequest = {
      contents,
    };

    // Build system instruction with AI Rules prepended if available
    let systemInstruction = options?.systemPrompt || '';
    if (this.aiRules) {
      systemInstruction = this.aiRules + (systemInstruction ? `\n\n---\n\n${systemInstruction}` : '');
    }

    if (systemInstruction) {
      request.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    // Set generation config
    const generationConfig: GeminiRequest['generationConfig'] = {};
    if (options?.maxTokens) {
      generationConfig.maxOutputTokens = options.maxTokens;
    }
    if (options?.temperature !== undefined) {
      generationConfig.temperature = options.temperature;
    }
    if (options?.stopSequences) {
      generationConfig.stopSequences = options.stopSequences;
    }

    if (Object.keys(generationConfig).length > 0) {
      request.generationConfig = generationConfig;
    }

    const response = await this.makeRequest(request);

    const textContent = response.candidates[0]?.content.parts[0]?.text ?? '';

    const cost = this.calculateCost(
      response.usageMetadata.promptTokenCount,
      response.usageMetadata.candidatesTokenCount
    );

    return {
      content: textContent,
      usage: {
        inputTokens: response.usageMetadata.promptTokenCount,
        outputTokens: response.usageMetadata.candidatesTokenCount,
        totalTokens: response.usageMetadata.totalTokenCount,
      },
      cost,
      model: this.model,
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

    const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: prompt }] }];
    const request: GeminiRequest = { contents };

    let systemInstruction = sendOpts.systemPrompt || '';
    if (this.aiRules) {
      systemInstruction = this.aiRules + (systemInstruction ? `\n\n---\n\n${systemInstruction}` : '');
    }
    if (systemInstruction) {
      request.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const generationConfig: GeminiRequest['generationConfig'] = {};
    if (sendOpts.maxTokens) generationConfig.maxOutputTokens = sendOpts.maxTokens;
    if (sendOpts.temperature !== undefined) generationConfig.temperature = sendOpts.temperature;
    if (sendOpts.stopSequences) generationConfig.stopSequences = sendOpts.stopSequences;
    if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig;

    const url = `${this.baseUrl}/v1beta/models/${this.model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      const errorData: GeminiError = await response.json();
      throw new Error(`Gemini API error: ${errorData.error.message} (${errorData.error.status})`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
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
          if (!data) continue;

          try {
            const event = JSON.parse(data);
            const text = event.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              fullContent += text;
              onChunk(text);
            }
            if (event.usageMetadata) {
              inputTokens = event.usageMetadata.promptTokenCount ?? inputTokens;
              outputTokens = event.usageMetadata.candidatesTokenCount ?? outputTokens;
              totalTokens = event.usageMetadata.totalTokenCount ?? totalTokens;
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
      usage: { inputTokens, outputTokens, totalTokens },
      cost,
      model: this.model,
    };
  }

  /**
   * Generate structured output using JSON mode
   */
  async structuredOutput<T>(
    prompt: string,
    options: StructuredOutputOptions
  ): Promise<T> {
    // Gemini doesn't have native JSON schema support like OpenAI
    // We'll use a system prompt to request JSON format
    const jsonPrompt = `${prompt}\n\nIMPORTANT: Respond with valid JSON only. No markdown, no code blocks, just raw JSON.`;

    const response = await this.sendMessage(jsonPrompt, {
      ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
      temperature: 0.1, // Lower temperature for more consistent JSON
    });

    try {
      return JSON.parse(response.content) as T;
    } catch (error) {
      throw new Error(`Failed to parse Gemini response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get provider metadata for cost/latency estimates
   */
  getMetadata(): ProviderMetadata {
    const pricing = GEMINI_PRICING[this.model] ?? GEMINI_PRICING['gemini-1.5-pro']!;

    return {
      model: this.model,
      costPerInputToken: pricing.input,
      costPerOutputToken: pricing.output,
      latencyEstimate: LATENCY_ESTIMATES[this.model] ?? 5000,
    };
  }

  /**
   * Make HTTP request to Gemini API with retries
   */
  private async makeRequest(request: GeminiRequest, retryCount = 0): Promise<GeminiResponse> {
    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData: GeminiError = await response.json();
        throw new Error(`Gemini API error: ${errorData.error.message} (${errorData.error.status})`);
      }

      const data: GeminiResponse = await response.json();

      // Check for blocked content
      if (data.promptFeedback?.blockReason) {
        throw new Error(`Content blocked by Gemini: ${data.promptFeedback.blockReason}`);
      }

      if (!data.candidates || data.candidates.length === 0) {
        throw new Error('Gemini returned no candidates');
      }

      return data;
    } catch (error) {
      if (retryCount < this.maxRetries) {
        // Exponential backoff
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.makeRequest(request, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Calculate cost based on token usage
   */
  private calculateCost(inputTokens: number, outputTokens: number): number {
    const pricing = GEMINI_PRICING[this.model] || GEMINI_PRICING['gemini-1.5-pro']!;
    const inputCost = (inputTokens / 1000) * pricing.input;
    const outputCost = (outputTokens / 1000) * pricing.output;
    return inputCost + outputCost;
  }
}

/**
 * Factory function to create a GeminiProvider instance
 */
export function createGeminiProvider(
  config: GeminiProviderConfig
): GeminiProvider {
  return new GeminiProvider(config);
}

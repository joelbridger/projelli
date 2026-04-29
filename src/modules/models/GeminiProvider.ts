// Gemini Provider
// Implements the Provider interface for Google's Gemini API

import type {
  Provider,
  ProviderResponse,
  SendOptions,
  StreamOptions,
  StructuredOutputOptions,
  ProviderMetadata,
  ProviderContentBlock,
  GeminiInlineDataBlock,
  AttachmentBytes,
} from './Provider';
import type { ChatAttachment } from '@/types/ai';
import { getCorsSafeFetch, safeJsonParse } from './fetchUtils';
import { isVisionModel } from './vision-capability';
import { bytesToBase64 } from './providerUtils';

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

/**
 * A Gemini content "part" can be either text, a functionCall issued by the
 * model, or a functionResponse supplied by the caller. Fields are mutually
 * exclusive per part.
 */
interface GeminiPart {
  text?: string;
  /** Stream A1 — inline image data part for vision requests. */
  inlineData?: {
    mimeType: string;
    data: string; // base64
  };
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/**
 * Claude-style tool definition (input schema), used as the input format
 * to setTools() so the registration surface matches what Claude expects.
 */
interface ClaudeStyleTool {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Gemini-native function declaration format as sent in the API request
 * (inside a single tools[].functionDeclarations array).
 */
interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
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
  tools?: Array<{
    functionDeclarations: GeminiFunctionDeclaration[];
  }>;
}

interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

interface GeminiCandidate {
  content: {
    parts: GeminiPart[];
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
  private tools: GeminiFunctionDeclaration[] = [];
  private toolExecutor?: (toolName: string, parameters: Record<string, unknown>) => Promise<unknown>;

  constructor(config: GeminiProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'gemini-2.5-flash';
    this.maxRetries = config.maxRetries ?? 3;
    this.baseUrl = getGeminiBaseUrl(config.baseUrl);
    this.aiRules = config.aiRules;
  }

  /**
   * Set available tools for Gemini to use via function calling.
   * Accepts Claude-style tool definitions (with `input_schema`) and converts
   * them to Gemini's functionDeclarations format internally.
   */
  setTools(
    tools: ClaudeStyleTool[],
    executor: (toolName: string, parameters: Record<string, unknown>) => Promise<unknown>
  ): void {
    this.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    }));
    this.toolExecutor = executor;
  }

  /**
   * Build the parts array for the initial user content block.
   * Without attachments: a single text part.
   * With attachments: inlineData parts first, then the text part.
   */
  private buildUserParts(prompt: string, attachmentBytes?: AttachmentBytes[]): GeminiPart[] {
    if (!attachmentBytes || attachmentBytes.length === 0) {
      return [{ text: prompt }];
    }
    const parts: GeminiPart[] = attachmentBytes.map(({ att, bytes }) => {
      const block = this.formatAttachmentForRequest(att, bytes) as GeminiInlineDataBlock;
      return { inlineData: block.inlineData };
    });
    parts.push({ text: prompt });
    return parts;
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
        parts: this.buildUserParts(prompt, options?.attachmentBytes),
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

    // Add tools if available
    if (this.tools.length > 0) {
      request.tools = [{ functionDeclarations: this.tools }];
    }

    // UX-39: thread an optional AbortSignal to the fetch layer.
    const signal = options?.signal;
    let response = await this.makeRequest(request, 0, signal);
    let totalInputTokens = response.usageMetadata.promptTokenCount;
    let totalOutputTokens = response.usageMetadata.candidatesTokenCount;

    // Handle function-call loops. Keep going while the model's response
    // contains functionCall parts. When all parts are text, we're done.
    // Safety cap prevents infinite loops if a tool never terminates.
    const MAX_TOOL_ITERATIONS = 16;
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const candidate = response.candidates[0];
      if (!candidate) break;
      const parts = candidate.content.parts;
      const functionCallParts = parts.filter((p) => p.functionCall !== undefined);
      if (functionCallParts.length === 0 || !this.toolExecutor) break;

      // Append the model's response (containing functionCall parts) to the history
      contents.push({
        role: 'model',
        parts,
      });

      // Execute each function call and build a single user turn containing
      // functionResponse parts (one per call).
      const responseParts: GeminiPart[] = [];
      for (const part of functionCallParts) {
        const call = part.functionCall;
        if (!call) continue;
        try {
          const result = await this.toolExecutor(call.name, call.args);
          responseParts.push({
            functionResponse: {
              name: call.name,
              // Gemini requires the response to be a JSON object — wrap scalar
              // results so the API accepts them.
              response:
                result && typeof result === 'object' && !Array.isArray(result)
                  ? (result as Record<string, unknown>)
                  : { result },
            },
          });
        } catch (error) {
          responseParts.push({
            functionResponse: {
              name: call.name,
              response: {
                error: error instanceof Error ? error.message : String(error),
              },
            },
          });
        }
      }

      contents.push({
        role: 'user',
        parts: responseParts,
      });

      // Send follow-up request. Tools and system prompt are preserved because
      // we spread the original request.
      const nextRequest: GeminiRequest = {
        ...request,
        contents,
      };
      response = await this.makeRequest(nextRequest, 0, signal);
      totalInputTokens += response.usageMetadata.promptTokenCount;
      totalOutputTokens += response.usageMetadata.candidatesTokenCount;
    }

    // Collect all text parts from the final response
    const textContent = (response.candidates[0]?.content.parts ?? [])
      .map((p) => p.text ?? '')
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

    const contents: GeminiContent[] = [{ role: 'user', parts: this.buildUserParts(prompt, sendOpts.attachmentBytes) }];
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

    const safeFetch = await getCorsSafeFetch();
    const response = await safeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      const errorData = await safeJsonParse<GeminiError>(response);
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
  private async makeRequest(request: GeminiRequest, retryCount = 0, signal?: AbortSignal): Promise<GeminiResponse> {
    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    try {
      const safeFetch = await getCorsSafeFetch();
      const response = await safeFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        ...(signal ? { signal } : {}),
      });

      if (!response.ok) {
        const errorData = await safeJsonParse<GeminiError>(response);
        throw new Error(`Gemini API error: ${errorData.error.message} (${errorData.error.status})`);
      }

      const data = await safeJsonParse<GeminiResponse>(response);

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
        return this.makeRequest(request, retryCount + 1, signal);
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

  /**
   * Stream A1 — Format an image attachment for the Gemini API.
   * Output shape: { inlineData: { mimeType, data } }
   * PDF handling deferred to Plan A2.
   */
  formatAttachmentForRequest(att: ChatAttachment, bytes: Uint8Array): ProviderContentBlock {
    if (att.type === 'pdf') {
      throw new Error(
        'PDF attachment support is not implemented in Plan A1. See Plan A2.'
      );
    }
    const block: GeminiInlineDataBlock = {
      inlineData: {
        mimeType: att.mimeType,
        data: bytesToBase64(bytes),
      },
    };
    return block;
  }

  /**
   * Stream A1 — Check vision capability for the given model.
   */
  supportsAttachment(att: ChatAttachment, model: string): true | string {
    if (att.type === 'pdf') {
      return 'PDF support is coming soon (Plan A2).';
    }
    if (att.type === 'image') {
      if (isVisionModel('gemini', model)) return true;
      return `${model} does not support images. Switch to Gemini 1.5 or 2.0.`;
    }
    return `Unsupported attachment type: ${att.type}.`;
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

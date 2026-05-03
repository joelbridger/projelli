// Ollama Provider (Q7, v1.5 — Flag 4 "offline AI that already caught up")
// Implements the Provider interface for a locally-running Ollama daemon
// reachable at http://127.0.0.1:11434.
//
// Everything is free because inference happens on the user's own machine:
// cost fields are always 0. We hit the daemon directly from the frontend
// because the Tauri CSP already allows `connect-src http://127.0.0.1:11434`
// (set in Phase 2) so there's no need to round-trip through Rust.
//
// Key differences from the Claude / OpenAI / Gemini providers:
//   - No API key. `isConfigured` only checks that the daemon is reachable.
//   - Model list is auto-discovered via `/api/tags`; no hardcoded list.
//   - Streaming is NDJSON (one JSON object per line), not SSE.
//   - JSON mode is requested with `format: 'json'` on the request payload.
//
// Ollama's chat API docs:
//   https://github.com/ollama/ollama/blob/main/docs/api.md

import type {
  Provider,
  ProviderResponse,
  SendOptions,
  StreamOptions,
  StructuredOutputOptions,
  ProviderMetadata,
  ProviderContentBlock,
  OllamaImagesPayload,
  TextExtractBlock,
  AttachmentBytes,
} from './Provider';
import type { ChatAttachment } from '@/types/ai';
import { isVisionModel } from './vision-capability';
import { bytesToBase64 } from './providerUtils';
import { extractPdfText } from '@/lib/pdf-extract';
import { getMaxContextTokens } from './context-limits';

/** Default Ollama base URL. Overridable via constructor or env. */
export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

/** Default model we'll fall back to if the caller didn't specify one. */
export const OLLAMA_DEFAULT_MODEL = 'llama3.2:3b';

export interface OllamaProviderConfig {
  model?: string;
  baseUrl?: string;
  maxRetries?: number;
  aiRules?: string;
}

interface OllamaTag {
  name: string;
  model?: string;
  modified_at?: string;
  size?: number;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

interface OllamaTagsResponse {
  models?: OllamaTag[];
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /**
   * Stream A1 — base64-encoded image strings for vision models.
   * Ollama places images at the message level, not inside the content string.
   * Only present on user messages when attachments are included.
   */
  images?: string[];
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream?: boolean;
  format?: 'json';
  options?: {
    temperature?: number;
    num_predict?: number;
    stop?: string[];
  };
}

interface OllamaChatResponse {
  model: string;
  message?: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  done_reason?: string;
}

/**
 * Ping Ollama's `/api/tags` endpoint and return the list of installed
 * model names. Returns `null` when the daemon isn't reachable so the
 * frontend can render an "Install Ollama" hint instead of throwing.
 *
 * Exported at module scope so auto-detect in Settings can call it without
 * constructing a provider instance.
 */
export async function detectOllama(
  baseUrl: string = OLLAMA_DEFAULT_BASE_URL,
  fetchFn: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): Promise<{ reachable: boolean; models: string[] }> {
  try {
    const resp = await fetchFn(`${baseUrl}/api/tags`, { method: 'GET' });
    if (!resp.ok) return { reachable: false, models: [] };
    const data = (await resp.json()) as OllamaTagsResponse;
    const tags = Array.isArray(data.models) ? data.models : [];
    const names = tags
      .map((t) => (typeof t.name === 'string' ? t.name : null))
      .filter((n): n is string => !!n);
    return { reachable: true, models: names };
  } catch {
    return { reachable: false, models: [] };
  }
}

/** Derive a friendly display name from an Ollama tag like `llama3.2:3b`. */
export function formatOllamaDisplayName(name: string): string {
  // e.g. `llama3.2:3b` → `Llama 3.2 (3B)`
  //      `mistral` → `Mistral`
  //      `qwen2.5:7b` → `Qwen 2.5 (7B)`
  const [base, tag] = name.split(':');
  const baseSafe = base ?? name;
  const pretty = baseSafe
    // Insert a space between a letter and a digit (but don't touch `3.2`,
    // which is already a version number — the letter-to-digit boundary is
    // the only place we want a break).
    .replace(/([a-z])(\d)/gi, '$1 $2')
    .replace(/^([a-z])/i, (c) => c.toUpperCase());
  if (!tag || tag === 'latest') return pretty;
  return `${pretty} (${tag.toUpperCase()})`;
}

/**
 * Parse one NDJSON chunk buffer and yield complete lines. Returns the
 * remaining buffer (the tail that didn't contain a newline yet) along
 * with the parsed events. Designed for streaming loops that accumulate
 * TextDecoder output.
 */
export function parseNdjsonChunk(
  buffer: string,
): { events: OllamaChatResponse[]; remainder: string } {
  const events: OllamaChatResponse[] = [];
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as OllamaChatResponse;
      events.push(parsed);
    } catch {
      // Skip unparseable lines — Ollama may emit blank lines or partial
      // frames on connection abort.
    }
  }
  return { events, remainder };
}

/**
 * OllamaProvider implements the Provider interface against a local Ollama
 * daemon. All calls are $0 — inference runs on the user's own machine.
 */
export class OllamaProvider implements Provider {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly aiRules: string | undefined;

  constructor(config: OllamaProviderConfig = {}) {
    this.model = config.model ?? OLLAMA_DEFAULT_MODEL;
    this.baseUrl = (config.baseUrl ?? OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.aiRules = config.aiRules;
  }

  /**
   * Ollama has no API key. `isConfigured` returns true when the daemon is
   * reachable. The Settings panel uses `detectOllama` for a richer check
   * before instantiating the provider.
   */
  isConfigured(): boolean {
    return true;
  }

  private async buildMessages(
    prompt: string,
    systemPrompt?: string,
    attachmentBytes?: AttachmentBytes[],
  ): Promise<OllamaChatMessage[]> {
    const messages: OllamaChatMessage[] = [];
    let fullSystem = systemPrompt ?? '';
    if (this.aiRules) {
      fullSystem = this.aiRules + (fullSystem ? `\n\n---\n\n${fullSystem}` : '');
    }
    if (fullSystem) {
      messages.push({ role: 'system', content: fullSystem });
    }

    // Stream A2 — Ollama images are passed at message level via `images: string[]`.
    // PDF text-extract blocks inject extracted text directly into the user content.
    const userMsg: OllamaChatMessage = { role: 'user', content: prompt };
    if (attachmentBytes && attachmentBytes.length > 0) {
      const imageStrings: string[] = [];
      const textParts: string[] = [];
      for (const { att, bytes } of attachmentBytes) {
        const block = await this.formatAttachmentForRequest(att, bytes);
        if ('_text_extract' in block) {
          const { text, fileName } = block._text_extract;
          textParts.push(`[File: ${fileName}]\n${text}`);
        } else {
          const payload = block as OllamaImagesPayload;
          imageStrings.push(...payload._ollama_images);
        }
      }
      if (textParts.length > 0) {
        userMsg.content = textParts.join('\n\n') + '\n\n' + prompt;
      }
      if (imageStrings.length > 0) {
        userMsg.images = imageStrings;
      }
    }

    messages.push(userMsg);
    return messages;
  }

  private async buildRequest(prompt: string, opts: SendOptions | undefined, stream: boolean): Promise<OllamaChatRequest> {
    const request: OllamaChatRequest = {
      model: this.model,
      messages: await this.buildMessages(prompt, opts?.systemPrompt, opts?.attachmentBytes),
      stream,
    };
    const options: OllamaChatRequest['options'] = {};
    if (opts?.temperature !== undefined) options.temperature = opts.temperature;
    if (opts?.maxTokens !== undefined) options.num_predict = opts.maxTokens;
    if (opts?.stopSequences && opts.stopSequences.length > 0) options.stop = opts.stopSequences;
    if (Object.keys(options).length > 0) request.options = options;
    return request;
  }

  /** Non-streaming chat. Returns the full response once generation completes. */
  async sendMessage(prompt: string, options?: SendOptions): Promise<ProviderResponse> {
    const request = await this.buildRequest(prompt, options, false);
    const started = Date.now();
    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    if (!resp.ok) {
      throw new Error(`Ollama error: HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as OllamaChatResponse;
    const content = data.message?.content ?? '';
    const inputTokens = data.prompt_eval_count ?? 0;
    const outputTokens = data.eval_count ?? 0;
    return {
      content,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      cost: 0,
      latency: Date.now() - started,
      model: data.model ?? this.model,
      stopReason: data.done_reason ?? (data.done ? 'stop' : 'unknown'),
    };
  }

  /** Streaming chat via NDJSON. `onChunk` is called per token as it arrives. */
  async sendMessageStreaming(prompt: string, options: StreamOptions): Promise<ProviderResponse> {
    const { onChunk, signal, ...sendOpts } = options;
    const request = await this.buildRequest(prompt, sendOpts, true);
    const started = Date.now();
    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
    if (!resp.ok) {
      throw new Error(`Ollama error: HTTP ${resp.status}`);
    }
    const reader = resp.body?.getReader();
    if (!reader) throw new Error('Ollama stream returned no body');

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let modelName = this.model;
    let stopReason = 'stop';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, remainder } = parseNdjsonChunk(buffer);
        buffer = remainder;
        for (const ev of events) {
          if (ev.model) modelName = ev.model;
          if (ev.message?.content) {
            fullContent += ev.message.content;
            onChunk(ev.message.content);
          }
          if (ev.done) {
            inputTokens = ev.prompt_eval_count ?? inputTokens;
            outputTokens = ev.eval_count ?? outputTokens;
            stopReason = ev.done_reason ?? 'stop';
          }
        }
      }
      // Flush any tail buffered content as one more parse attempt.
      const tail = parseNdjsonChunk(buffer + '\n');
      for (const ev of tail.events) {
        if (ev.message?.content) {
          fullContent += ev.message.content;
          onChunk(ev.message.content);
        }
        if (ev.done) {
          inputTokens = ev.prompt_eval_count ?? inputTokens;
          outputTokens = ev.eval_count ?? outputTokens;
          stopReason = ev.done_reason ?? 'stop';
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      content: fullContent,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      cost: 0,
      latency: Date.now() - started,
      model: modelName,
      stopReason,
    };
  }

  /**
   * Ollama's `format: 'json'` flag forces valid JSON output. We still
   * guard with a defensive parse so a model that emits pre/post text
   * doesn't crash the caller.
   */
  async structuredOutput<T>(prompt: string, options: StructuredOutputOptions): Promise<T> {
    const structuredPrompt = `${prompt}

Respond with valid JSON matching this schema:
${JSON.stringify(options.schema, null, 2)}

IMPORTANT: Respond ONLY with the JSON object.`;
    const request: OllamaChatRequest = {
      model: this.model,
      messages: await this.buildMessages(
        structuredPrompt,
        options.systemPrompt ?? 'You are a helpful assistant that responds only with valid JSON.',
      ),
      stream: false,
      format: 'json',
    };
    const runOpts: OllamaChatRequest['options'] = {};
    if (options.temperature !== undefined) runOpts.temperature = options.temperature;
    if (options.maxTokens !== undefined) runOpts.num_predict = options.maxTokens;
    if (Object.keys(runOpts).length > 0) request.options = runOpts;

    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!resp.ok) {
      throw new Error(`Ollama error: HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as OllamaChatResponse;
    const raw = (data.message?.content ?? '').trim();
    // Strip common markdown code fences (some models ignore `format: json`
    // if they were fine-tuned with fence-wrapping examples).
    let cleaned = raw;
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      throw new Error(
        `Failed to parse Ollama response as JSON: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  getMetadata(): ProviderMetadata {
    return {
      name: 'Ollama (local)',
      providerId: 'ollama',
      model: this.model,
      costPerInputToken: 0,
      costPerOutputToken: 0,
      costEstimate: 0,
      estimatedLatencyMs: 3000, // varies wildly by hardware; this is a placeholder
      capabilities: {
        streaming: true,
        functionCalling: false,
        vision: false,
        // Context length depends on the model. Most Ollama defaults cap
        // around 8k; individual models (llama3.1, qwen2.5) go much higher.
        maxContextTokens: getMaxContextTokens('ollama', this.model),
      },
    };
  }

  /**
   * Stream A1 — Format an image attachment for Ollama's chat API.
   *
   * Ollama images are passed at the message level (not inside a content block)
   * as an `images: string[]` array of base64-encoded strings. We return an
   * `OllamaImagesPayload` sentinel; the message-construction code in sendMessage
   * checks for `_ollama_images` and appends the base64 strings to the outgoing
   * message object.
   *
   * Stream A2: PDF uses text-extract path (TextExtractBlock).
   */
  async formatAttachmentForRequest(
    att: ChatAttachment,
    bytes: Uint8Array
  ): Promise<ProviderContentBlock> {
    if (att.type === 'image') {
      const payload: OllamaImagesPayload = {
        _ollama_images: [bytesToBase64(bytes)],
      };
      return payload;
    }

    if (att.type === 'pdf') {
      const result = await extractPdfText(bytes);
      return {
        _text_extract: {
          text: result.pages.join('\n\n'),
          pageCount: result.pageCount,
          fileName: att.fileName,
        },
      } satisfies TextExtractBlock;
    }

    throw new Error(`Unsupported attachment type: ${att.type}`);
  }

  /**
   * Stream A2 — Check attachment support.
   */
  supportsAttachment(att: ChatAttachment, model: string): true | string {
    if (att.type === 'image') {
      if (isVisionModel('ollama', model)) return true;
      return (
        `${model} does not appear to support images. ` +
        `Pull a vision-capable model like 'llava' and select it.`
      );
    }
    if (att.type === 'pdf') {
      return true;
    }
    return `Unsupported attachment type: ${att.type}.`;
  }

  /**
   * Stream A2 — Ollama never supports native PDF blocks.
   */
  supportsNativePdf(_model: string): boolean {
    return false;
  }
}

/** Create an OllamaProvider instance. */
export function createOllamaProvider(config: OllamaProviderConfig = {}): OllamaProvider {
  return new OllamaProvider(config);
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';
import { GeminiProvider } from '@/platform/providers/GeminiProvider';
import { OpenAIProvider } from '@/platform/providers/OpenAIProvider';
import { useDirectModeForTests } from '../../helpers/cloudModeForTests';

// These tests send via real cloud providers — opt into a non-private mode so the
// fail-closed cloud-send guard lets the send through.
useDirectModeForTests();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function streamResponse(payload: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

function pendingFetchThatRejectsOnAbort(): ReturnType<typeof vi.fn> {
  return vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal?.addEventListener('abort', () => {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  });
}

async function settledAfterTimers<T>(promise: Promise<T>, ms: number): Promise<unknown> {
  let settled = false;
  let value: unknown;
  promise.then(
    (result) => {
      settled = true;
      value = result;
    },
    (error) => {
      settled = true;
      value = error;
    },
  );
  await vi.advanceTimersByTimeAsync(ms);
  return settled ? value : 'pending';
}

describe('provider regressions — BUG-071 tool-call loop cap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Claude stops repeated tool calls instead of looping forever', async () => {
    const fetchMock = vi.fn(() => {
      if (fetchMock.mock.calls.length > 20) {
        return Promise.resolve(jsonResponse({
          id: 'msg_done',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }));
      }
      return Promise.resolve(jsonResponse({
        id: 'msg_tool',
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-1',
          name: 'repeat',
          input: {},
        }],
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'tool_use',
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new ClaudeProvider({
      apiKey: 'test-key',
      model: 'claude-3-5-sonnet-20241022',
    });
    provider.setTools(
      [{ name: 'repeat', description: 'repeat', input_schema: { type: 'object', properties: {} } }],
      async () => ({ ok: true }),
    );

    await expect(provider.sendMessage('loop')).rejects.toThrow(/tool.*iteration/i);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(17);
  });

  it('OpenAI stops repeated tool calls instead of looping forever', async () => {
    const fetchMock = vi.fn(() => {
      if (fetchMock.mock.calls.length > 20) {
        return Promise.resolve(jsonResponse({
          id: 'chatcmpl-done',
          object: 'chat.completion',
          created: 1700000000,
          model: 'gpt-4o',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'done' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      }
      return Promise.resolve(jsonResponse({
        id: 'chatcmpl-tool',
        object: 'chat.completion',
        created: 1700000000,
        model: 'gpt-4o',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call-1',
              type: 'function',
              function: { name: 'repeat', arguments: '{}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' });
    provider.setTools(
      [{ name: 'repeat', description: 'repeat', input_schema: { type: 'object', properties: {} } }],
      async () => ({ ok: true }),
    );

    await expect(provider.sendMessage('loop')).rejects.toThrow(/tool.*iteration/i);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(17);
  });

  it('E1: Gemini throws instead of returning a blank answer when the tool-call cap is hit', async () => {
    // The model keeps wanting to call functions on every turn. Before E1, the
    // loop exited at the cap and joined only functionCall parts → a blank
    // answer that looked like the model had nothing to say. It must surface an
    // honest provider error like Claude/OpenAI instead.
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({
        candidates: [{
          content: { parts: [{ functionCall: { name: 'repeat', args: {} } }] },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-1.5-pro' });
    provider.setTools(
      [{ name: 'repeat', description: 'repeat', input_schema: { type: 'object', properties: {} } }],
      async () => ({ ok: true }),
    );

    await expect(provider.sendMessage('loop')).rejects.toThrow(/tool.*iteration/i);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(17);
  });
});

describe('provider regressions — BUG-073 final SSE line without newline', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Claude parses a final data line even when the stream has no trailing newline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"tail"}}',
    )));
    const chunks: string[] = [];
    const provider = new ClaudeProvider({ apiKey: 'test-key', model: 'claude-3-5-sonnet-20241022' });

    const response = await provider.sendMessageStreaming('prompt', {
      onChunk: (chunk) => chunks.push(chunk),
    });

    expect(chunks).toEqual(['tail']);
    expect(response.content).toBe('tail');
  });

  it('OpenAI parses a final data line even when the stream has no trailing newline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(
      'data: {"choices":[{"delta":{"content":"tail"},"finish_reason":null}]}',
    )));
    const chunks: string[] = [];
    const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' });

    const response = await provider.sendMessageStreaming('prompt', {
      onChunk: (chunk) => chunks.push(chunk),
    });

    expect(chunks).toEqual(['tail']);
    expect(response.content).toBe('tail');
  });

  it('Gemini parses a final data line even when the stream has no trailing newline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(
      'data: {"candidates":[{"content":{"parts":[{"text":"tail"}]}}]}',
    )));
    const chunks: string[] = [];
    const provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-1.5-pro' });

    const response = await provider.sendMessageStreaming('prompt', {
      onChunk: (chunk) => chunks.push(chunk),
    });

    expect(chunks).toEqual(['tail']);
    expect(response.content).toBe('tail');
  });
});

describe('provider regressions — BUG-074 aborts are not retried', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['Claude', () => new ClaudeProvider({ apiKey: 'test-key', model: 'claude-3-5-sonnet-20241022' })],
    ['OpenAI', () => new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' })],
    ['Gemini', () => new GeminiProvider({ apiKey: 'test-key', model: 'gemini-1.5-pro' })],
  ])('%s rejects aborts immediately and fetches only once', async (_name, makeProvider) => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(makeProvider().sendMessage('cancel me')).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('provider regressions — BUG-075 generation request timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ['Claude', () => new ClaudeProvider({ apiKey: 'test-key', model: 'claude-3-5-sonnet-20241022', timeout: 25 })],
    ['OpenAI', () => new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o', timeout: 25 })],
    ['Gemini', () => new GeminiProvider({ apiKey: 'test-key', model: 'gemini-1.5-pro', timeout: 25 })],
  ])('%s rejects a hung request after its timeout', async (_name, makeProvider) => {
    vi.stubGlobal('fetch', pendingFetchThatRejectsOnAbort());

    const promise = makeProvider().sendMessage('hang');
    const result = await settledAfterTimers(promise, 30);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/timed out|abort/i);
  });
});

describe('provider regressions — BUG-076 Gemini structured output options', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes schema fields and requested generation limits in the Gemini request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      candidates: [{
        content: { parts: [{ text: '{"caseName":"Smith v Jones"}' }], role: 'model' },
        finishReason: 'STOP',
        index: 0,
      }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 4, totalTokenCount: 9 },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-1.5-pro' });

    await provider.structuredOutput('extract the case', {
      schema: {
        type: 'object',
        properties: {
          caseName: { type: 'string' },
        },
        required: ['caseName'],
      },
      maxTokens: 123,
      temperature: 0.2,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const prompt = body.contents[0].parts[0].text;
    expect(prompt).toContain('caseName');
    expect(prompt).toContain('valid JSON');
    expect(body.generationConfig.maxOutputTokens).toBe(123);
    expect(body.generationConfig.temperature).toBe(0.2);
  });
});

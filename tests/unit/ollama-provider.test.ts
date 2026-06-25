/**
 * Q7 (v1.5) — OllamaProvider.
 *
 * Covers:
 *   - Provider interface compliance (metadata + cost == 0)
 *   - `detectOllama` reachable / unreachable branches
 *   - NDJSON stream parsing (single chunk, multi-chunk, incomplete tail)
 *   - sendMessage / sendMessageStreaming return shapes
 *   - structuredOutput JSON cleanup (code-fence strip, parse errors)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OllamaProvider,
  detectOllama,
  parseNdjsonChunk,
  formatOllamaDisplayName,
  OLLAMA_DEFAULT_MODEL,
  OLLAMA_WORKING_CONTEXT_WINDOW,
} from '@/platform/providers/OllamaProvider';

describe('OllamaProvider (Q7)', () => {
  describe('getMetadata', () => {
    it('reports cost 0 and providerId=ollama', () => {
      const p = new OllamaProvider({ model: 'llama3.2:3b' });
      const meta = p.getMetadata();
      expect(meta.providerId).toBe('ollama');
      expect(meta.costPerInputToken).toBe(0);
      expect(meta.costPerOutputToken).toBe(0);
      expect(meta.model).toBe('llama3.2:3b');
    });

    it('falls back to default model when none specified', () => {
      const p = new OllamaProvider();
      expect(p.getMetadata().model).toBe(OLLAMA_DEFAULT_MODEL);
    });

    it('reports streaming capability', () => {
      const p = new OllamaProvider();
      expect(p.getMetadata().capabilities?.streaming).toBe(true);
    });
  });

  describe('isConfigured', () => {
    it('returns true (no API key required)', () => {
      const p = new OllamaProvider();
      expect(p.isConfigured()).toBe(true);
    });
  });

  describe('parseNdjsonChunk', () => {
    it('parses a single complete line', () => {
      const { events, remainder } = parseNdjsonChunk('{"done":true}\n');
      expect(events).toHaveLength(1);
      expect(events[0]?.done).toBe(true);
      expect(remainder).toBe('');
    });

    it('parses multiple lines', () => {
      const input = '{"message":{"role":"assistant","content":"Hello"},"done":false}\n{"done":true,"eval_count":5}\n';
      const { events, remainder } = parseNdjsonChunk(input);
      expect(events).toHaveLength(2);
      expect(events[0]?.message?.content).toBe('Hello');
      expect(events[1]?.eval_count).toBe(5);
      expect(remainder).toBe('');
    });

    it('keeps an incomplete tail as remainder', () => {
      const input = '{"done":false}\n{"partial"';
      const { events, remainder } = parseNdjsonChunk(input);
      expect(events).toHaveLength(1);
      expect(remainder).toBe('{"partial"');
    });

    it('skips unparseable lines instead of throwing', () => {
      const input = 'not json\n{"done":true}\n';
      const { events } = parseNdjsonChunk(input);
      expect(events).toHaveLength(1);
    });
  });

  describe('formatOllamaDisplayName', () => {
    it('formats tagged models', () => {
      expect(formatOllamaDisplayName('llama3.2:3b')).toBe('Llama 3.2 (3B)');
    });

    it('ignores the latest tag', () => {
      expect(formatOllamaDisplayName('mistral:latest')).toBe('Mistral');
    });

    it('returns base name for untagged models', () => {
      expect(formatOllamaDisplayName('qwen')).toBe('Qwen');
    });
  });

  describe('detectOllama', () => {
    it('reports reachable=true with model names when /api/tags returns 200', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            { name: 'llama3.2:3b' },
            { name: 'mistral:latest' },
          ],
        }),
      });
      const result = await detectOllama('http://127.0.0.1:11434', fetchFn as unknown as typeof fetch);
      expect(result.reachable).toBe(true);
      expect(result.models).toEqual(['llama3.2:3b', 'mistral:latest']);
    });

    it('reports reachable=false when fetch throws', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('connection refused'));
      const result = await detectOllama('http://127.0.0.1:11434', fetchFn as unknown as typeof fetch);
      expect(result.reachable).toBe(false);
      expect(result.models).toEqual([]);
    });

    it('reports reachable=false on non-ok response', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      const result = await detectOllama('http://127.0.0.1:11434', fetchFn as unknown as typeof fetch);
      expect(result.reachable).toBe(false);
    });
  });

  describe('sendMessage', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('posts to /api/chat with stream=false and returns content + cost=0', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({
            model: 'llama3.2:3b',
            message: { role: 'assistant', content: 'hi there' },
            done: true,
            prompt_eval_count: 10,
            eval_count: 3,
            done_reason: 'stop',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      const p = new OllamaProvider({ model: 'llama3.2:3b' });
      const resp = await p.sendMessage('hello');
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toContain('/api/chat');
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.stream).toBe(false);
      expect(body.model).toBe('llama3.2:3b');
      expect(resp.content).toBe('hi there');
      expect(resp.cost).toBe(0);
      expect(resp.usage.inputTokens).toBe(10);
      expect(resp.usage.outputTokens).toBe(3);
    });

    it('throws on non-ok response', async () => {
      fetchSpy.mockResolvedValue(new Response('nope', { status: 500 }));
      const p = new OllamaProvider();
      await expect(p.sendMessage('x')).rejects.toThrow(/HTTP 500/);
    });

    it('sets num_ctx to the working window for a large-context model (no silent truncation)', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({ model: 'llama3.2:3b', message: { role: 'assistant', content: 'ok' }, done: true }),
          { status: 200 },
        ),
      );
      const p = new OllamaProvider({ model: 'llama3.2:3b' });
      await p.sendMessage('hello');
      const [, init] = fetchSpy.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      // llama3.2 supports 128K, so we request our full working window.
      expect(body.options.num_ctx).toBe(OLLAMA_WORKING_CONTEXT_WINDOW);
    });

    it('clamps num_ctx down to the model maximum for a small-context / unknown model', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({ model: 'custom-local-model', message: { role: 'assistant', content: 'ok' }, done: true }),
          { status: 200 },
        ),
      );
      const p = new OllamaProvider({ model: 'custom-local-model' });
      await p.sendMessage('hello');
      const [, init] = fetchSpy.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      // Unknown Ollama model falls back to 8192; we must not over-ask beyond it.
      expect(body.options.num_ctx).toBe(8192);
    });
  });

  describe('sendMessageStreaming', () => {
    it('emits per-token chunks via onChunk and returns cost=0', async () => {
      const ndjson =
        '{"message":{"role":"assistant","content":"hel"},"done":false}\n' +
        '{"message":{"role":"assistant","content":"lo"},"done":false}\n' +
        '{"done":true,"prompt_eval_count":4,"eval_count":2,"done_reason":"stop"}\n';
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(ndjson));
          controller.close();
        },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }),
      );
      const chunks: string[] = [];
      const p = new OllamaProvider({ model: 'llama3.2:3b' });
      const resp = await p.sendMessageStreaming('prompt', {
        onChunk: (chunk) => chunks.push(chunk),
      });
      expect(chunks).toEqual(['hel', 'lo']);
      expect(resp.content).toBe('hello');
      expect(resp.cost).toBe(0);
      expect(resp.usage.outputTokens).toBe(2);
    });

    it('sets num_ctx on the streaming request too', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"done":true,"eval_count":0}\n'));
          controller.close();
        },
      });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }),
      );
      const p = new OllamaProvider({ model: 'llama3.2:3b' });
      await p.sendMessageStreaming('prompt', { onChunk: () => {} });
      const [, init] = fetchSpy.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.options.num_ctx).toBe(OLLAMA_WORKING_CONTEXT_WINDOW);
      vi.restoreAllMocks();
    });
  });

  describe('structuredOutput', () => {
    afterEach(() => vi.restoreAllMocks());

    it('parses valid JSON', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            model: 'llama3.2:3b',
            message: { role: 'assistant', content: '{"name":"X","count":2}' },
            done: true,
          }),
          { status: 200 },
        ),
      );
      const p = new OllamaProvider();
      const result = await p.structuredOutput<{ name: string; count: number }>('give me X', {
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            count: { type: 'number' },
          },
        },
      });
      expect(result).toEqual({ name: 'X', count: 2 });
    });

    it('sets num_ctx on the structuredOutput request', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            model: 'llama3.2:3b',
            message: { role: 'assistant', content: '{"ok":true}' },
            done: true,
          }),
          { status: 200 },
        ),
      );
      const p = new OllamaProvider({ model: 'llama3.2:3b' });
      await p.structuredOutput<{ ok: boolean }>('x', {
        schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      });
      const [, init] = fetchSpy.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.options.num_ctx).toBe(OLLAMA_WORKING_CONTEXT_WINDOW);
    });

    it('strips markdown code fences before parsing', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            model: 'llama3.2:3b',
            message: { role: 'assistant', content: '```json\n{"ok":true}\n```' },
            done: true,
          }),
          { status: 200 },
        ),
      );
      const p = new OllamaProvider();
      const result = await p.structuredOutput<{ ok: boolean }>('x', {
        schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      });
      expect(result.ok).toBe(true);
    });

    it('throws with a useful error on malformed JSON', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            model: 'llama3.2:3b',
            message: { role: 'assistant', content: 'not JSON at all' },
            done: true,
          }),
          { status: 200 },
        ),
      );
      const p = new OllamaProvider();
      await expect(
        p.structuredOutput('x', { schema: { type: 'object' } }),
      ).rejects.toThrow(/parse Ollama response/);
    });
  });
});

/**
 * Local-model initiative — KeepanceLocalProvider (embedded llama.cpp engine).
 *
 * Covers the chat path that talks to the llama-server sidecar's OpenAI-compatible
 * endpoint: metadata, SSE stream parsing, sendMessage / streaming / structured
 * output shapes, endpoint caching (sidecar started once), and attachment rules.
 * The sidecar lifecycle (Rust) is faked via the `startSidecar` seam; HTTP is
 * mocked, so no real model or binary is needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  KeepanceLocalProvider,
  parseSseChunk,
  KEEPANCE_LOCAL_DEFAULT_MODEL,
  KEEPANCE_LOCAL_CONTEXT_WINDOW,
} from '@/platform/providers/KeepanceLocalProvider';

const ENDPOINT = 'http://127.0.0.1:18089';
const fakeStart = () => Promise.resolve(ENDPOINT);

function provider(start = fakeStart) {
  return new KeepanceLocalProvider({ model: KEEPANCE_LOCAL_DEFAULT_MODEL, startSidecar: start });
}

describe('KeepanceLocalProvider', () => {
  describe('getMetadata', () => {
    it('reports providerId, $0 cost, streaming, no vision, the real ctx window', () => {
      const meta = provider().getMetadata();
      expect(meta.providerId).toBe('keepance-local');
      expect(meta.name).toBe('Keepance Local AI');
      expect(meta.costPerInputToken).toBe(0);
      expect(meta.costPerOutputToken).toBe(0);
      expect(meta.capabilities?.streaming).toBe(true);
      expect(meta.capabilities?.vision).toBe(false);
      expect(meta.capabilities?.maxContextTokens).toBe(KEEPANCE_LOCAL_CONTEXT_WINDOW);
      expect(meta.model).toBe(KEEPANCE_LOCAL_DEFAULT_MODEL);
    });
  });

  describe('isConfigured', () => {
    it('returns true (local, keyless)', () => {
      expect(provider().isConfigured()).toBe(true);
    });
  });

  describe('parseSseChunk', () => {
    it('parses a single data event', () => {
      const { events, done, remainder } = parseSseChunk(
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.choices?.[0]?.delta?.content).toBe('hi');
      expect(done).toBe(false);
      expect(remainder).toBe('');
    });

    it('flags [DONE] and ignores non-data / blank lines', () => {
      const { events, done } = parseSseChunk(': keep-alive\n\ndata: [DONE]\n');
      expect(events).toHaveLength(0);
      expect(done).toBe(true);
    });

    it('keeps an incomplete trailing line as remainder', () => {
      const { events, remainder } = parseSseChunk('data: {"a":1}\ndata: {"b"');
      expect(events).toHaveLength(1);
      expect(remainder).toBe('data: {"b"');
    });
  });

  describe('sendMessage', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    });
    afterEach(() => fetchSpy.mockRestore());

    it('POSTs to the sidecar /v1/chat/completions and returns content + cost 0', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({
            model: KEEPANCE_LOCAL_DEFAULT_MODEL,
            choices: [{ message: { content: 'grounded answer' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 42, completion_tokens: 7 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      const resp = await provider().sendMessage('q');
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toBe(`${ENDPOINT}/v1/chat/completions`);
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.stream).toBe(false);
      expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'q' });
      expect(resp.content).toBe('grounded answer');
      expect(resp.cost).toBe(0);
      expect(resp.usage.inputTokens).toBe(42);
      expect(resp.usage.outputTokens).toBe(7);
    });

    it('starts the sidecar only once across multiple sends (endpoint cached)', async () => {
      // Fresh Response per call — a Response body can only be read once.
      fetchSpy.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), { status: 200 }),
        ),
      );
      const start = vi.fn(fakeStart);
      const p = provider(start);
      await p.sendMessage('one');
      await p.sendMessage('two');
      expect(start).toHaveBeenCalledTimes(1);
    });

    it('throws a clear error on a non-ok response', async () => {
      fetchSpy.mockResolvedValue(new Response('nope', { status: 503 }));
      await expect(provider().sendMessage('q')).rejects.toThrow(/HTTP 503/);
    });

    it('prepends the system prompt as a system message', async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), { status: 200 }),
      );
      await provider().sendMessage('q', { systemPrompt: 'be careful' });
      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.messages[0]).toEqual({ role: 'system', content: 'be careful' });
    });
  });

  describe('sendMessageStreaming', () => {
    afterEach(() => vi.restoreAllMocks());

    it('emits per-token chunks from the SSE stream and stops at [DONE]', async () => {
      const sse =
        'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"lo"}}],"model":"qwen3-4b-instruct-2507"}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
        'data: [DONE]\n\n';
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(sse));
          c.close();
        },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      );
      const chunks: string[] = [];
      const resp = await provider().sendMessageStreaming('q', { onChunk: (c) => chunks.push(c) });
      expect(chunks).toEqual(['hel', 'lo']);
      expect(resp.content).toBe('hello');
      expect(resp.cost).toBe(0);
      expect(resp.stopReason).toBe('stop');
    });
  });

  describe('structuredOutput', () => {
    afterEach(() => vi.restoreAllMocks());

    it('parses JSON and requests json_object response_format', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{"ok":true,"n":2}' } }] }),
          { status: 200 },
        ),
      );
      const out = await provider().structuredOutput<{ ok: boolean; n: number }>('give json', {
        schema: { type: 'object', properties: { ok: { type: 'boolean' }, n: { type: 'number' } } },
      });
      expect(out).toEqual({ ok: true, n: 2 });
      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('strips code fences before parsing', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '```json\n{"ok":true}\n```' } }] }),
          { status: 200 },
        ),
      );
      const out = await provider().structuredOutput<{ ok: boolean }>('x', {
        schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      });
      expect(out.ok).toBe(true);
    });
  });

  describe('attachments', () => {
    it('supports PDF (text-extract), rejects images, no native PDF', () => {
      const p = provider();
      expect(p.supportsAttachment({ type: 'pdf', fileName: 'a.pdf' } as never, 'm')).toBe(true);
      expect(p.supportsAttachment({ type: 'image', fileName: 'a.png' } as never, 'm')).toMatch(
        /text-only|cannot read images/i,
      );
      expect(p.supportsNativePdf('m')).toBe(false);
    });
  });
});

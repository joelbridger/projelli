// Fix 3 (demo readiness) — OpenAI streaming had no pre-stream retry: a 429 or
// a 5xx from OpenAI's edge before any token arrived threw immediately, even
// though the non-streaming path already tolerates a transient 429. This adds
// a small, bounded retry/backoff for 429/500/502/503/504 statuses seen BEFORE
// the response body is read — honoring `retry-after` — and verifies a status
// seen AFTER a real token has streamed is never retried (a live demo answer
// that starts, then drops, must surface as a real error, not silently restart
// and duplicate partial output).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider';

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function sseResponse(deltas: string[]): Response {
  const events = deltas.map(
    (d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`,
  );
  events.push('data: [DONE]\n\n');
  return new Response(sseStream(events), { status: 200 });
}

function errorResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { message: `boom ${String(status)}`, type: 'x' } }), {
    status,
    headers,
  });
}

function makeProvider(): OpenAIProvider {
  return new OpenAIProvider({ apiKey: 'sk-test' });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('OpenAIProvider streaming pre-stream retry', () => {
  it('retries a 429 (honoring retry-after) before any token, then streams normally', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(sseResponse(['Hello', ' world']));
    vi.stubGlobal('fetch', fetchMock);

    const provider = makeProvider();
    const chunks: string[] = [];
    const promise = provider.sendMessageStreaming('hi', { onChunk: (c) => chunks.push(c) });

    await vi.advanceTimersByTimeAsync(1000);
    const resp = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chunks).toEqual(['Hello', ' world']);
    expect(resp.content).toBe('Hello world');
  });

  it('retries 500/502/503/504 with exponential backoff when no retry-after is present', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(errorResponse(502))
      .mockResolvedValueOnce(sseResponse(['ok']));
    vi.stubGlobal('fetch', fetchMock);

    const provider = makeProvider();
    const chunks: string[] = [];
    const promise = provider.sendMessageStreaming('hi', { onChunk: (c) => chunks.push(c) });

    await vi.advanceTimersByTimeAsync(1000); // backoff after attempt 0
    await vi.advanceTimersByTimeAsync(2000); // backoff after attempt 1
    const resp = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(resp.content).toBe('ok');
  });

  it('does not retry a non-retryable status (400) — fails fast', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(400));
    vi.stubGlobal('fetch', fetchMock);

    const provider = makeProvider();
    await expect(
      provider.sendMessageStreaming('hi', { onChunk: () => undefined }),
    ).rejects.toThrow('boom 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting bounded retries and throws the last error', async () => {
    vi.useFakeTimers();
    // mockImplementation (not mockResolvedValue) so every call gets a FRESH
    // Response — a real fetch() never returns the same, already-drained body.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(errorResponse(503)));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAIProvider({ apiKey: 'sk-test', maxRetries: 2 });
    const assertion = expect(
      provider.sendMessageStreaming('hi', { onChunk: () => undefined }),
    ).rejects.toThrow('boom 503');

    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    // maxRetries=2 => attempts 0,1,2 (initial + 2 retries)
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never retries once a chunk has already arrived (a mid-stream failure is a real error, not restarted)', async () => {
    // A real ReadableStream discards queued-but-unread chunks the instant it
    // errors, so a stream built with enqueue()-then-error() can't reliably
    // deliver the first chunk before rejecting (spec timing, not something
    // this fix controls). Mock the reader directly instead: first read()
    // resolves with a real token, second read() rejects — the same shape a
    // connection dropping mid-answer produces.
    let call = 0;
    const encoder = new TextEncoder();
    const fakeResponse = {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: vi.fn().mockImplementation(() => {
            call += 1;
            if (call === 1) {
              return Promise.resolve({
                done: false,
                value: encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`,
                ),
              });
            }
            return Promise.reject(new Error('connection dropped'));
          }),
          releaseLock: vi.fn(),
        }),
      },
    } as unknown as Response;
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse);
    vi.stubGlobal('fetch', fetchMock);

    const provider = makeProvider();
    const chunks: string[] = [];
    await expect(
      provider.sendMessageStreaming('hi', { onChunk: (c) => chunks.push(c) }),
    ).rejects.toThrow();

    expect(chunks).toEqual(['partial']);
    // The connect phase succeeded (200 OK) on the very first attempt; a
    // failure while READING the body must never trigger a second fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates a user abort immediately without retrying', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = makeProvider();
    await expect(
      provider.sendMessageStreaming('hi', { onChunk: () => undefined, signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

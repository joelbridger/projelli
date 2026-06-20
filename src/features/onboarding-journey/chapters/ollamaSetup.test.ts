/**
 * ollamaSetup.test.ts — unit tests for the guided local-AI setup helpers.
 *
 * Mocking strategy:
 *  - detectOllama is mocked so waitForOllama tests control detect results.
 *  - fetch is mocked via vi.stubGlobal so pullOllamaModel tests control
 *    the streaming response without network access.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForOllama, pullOllamaModel } from './ollamaSetup';

// ---------------------------------------------------------------------------
// Mock detectOllama
// ---------------------------------------------------------------------------

const mockDetectOllama = vi.fn();
vi.mock('@/platform/providers/OllamaProvider', () => ({
  detectOllama: (...args: unknown[]) => mockDetectOllama(...args),
  OLLAMA_DEFAULT_BASE_URL: 'http://127.0.0.1:11434',
  OLLAMA_DEFAULT_MODEL: 'llama3.2:3b',
}));

// ---------------------------------------------------------------------------
// Helper: build a fake ReadableStream from NDJSON lines
// ---------------------------------------------------------------------------

function ndjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const body = lines.map((l) => l + '\n').join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

function makeFetchResponse(lines: string[], ok = true, status = 200): Response {
  return {
    ok,
    status,
    body: ndjsonStream(lines),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// waitForOllama tests
// ---------------------------------------------------------------------------

describe('waitForOllama', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockDetectOllama.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves "ready" immediately when Ollama is up with a model on the first call', async () => {
    mockDetectOllama.mockResolvedValue({ reachable: true, models: ['llama3.2:3b'] });

    const promise = waitForOllama({ intervalMs: 100, timeoutMs: 5000 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('ready');
    expect(mockDetectOllama).toHaveBeenCalledOnce();
  });

  it('resolves "no-model" immediately when Ollama is reachable but has no models', async () => {
    mockDetectOllama.mockResolvedValue({ reachable: true, models: [] });

    const promise = waitForOllama({ intervalMs: 100, timeoutMs: 5000 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('no-model');
    expect(mockDetectOllama).toHaveBeenCalledOnce();
  });

  it('polls until Ollama becomes reachable', async () => {
    mockDetectOllama
      .mockResolvedValueOnce({ reachable: false, models: [] })
      .mockResolvedValueOnce({ reachable: false, models: [] })
      .mockResolvedValueOnce({ reachable: true, models: ['llama3.2:3b'] });

    const promise = waitForOllama({ intervalMs: 100, timeoutMs: 5000 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('ready');
    expect(mockDetectOllama).toHaveBeenCalledTimes(3);
  });

  it('resolves "unreachable" when timeout expires', async () => {
    mockDetectOllama.mockResolvedValue({ reachable: false, models: [] });

    const promise = waitForOllama({ intervalMs: 100, timeoutMs: 200 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('unreachable');
  });

  it('resolves "unreachable" when signal is aborted', async () => {
    const ctrl = new AbortController();
    mockDetectOllama.mockResolvedValue({ reachable: false, models: [] });

    const promise = waitForOllama({ signal: ctrl.signal, intervalMs: 5000, timeoutMs: 30000 });
    ctrl.abort();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('unreachable');
  });
});

// ---------------------------------------------------------------------------
// pullOllamaModel tests
// ---------------------------------------------------------------------------

describe('pullOllamaModel', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses streamed NDJSON progress events and calls onProgress with increasing percent', async () => {
    const lines = [
      JSON.stringify({ status: 'pulling manifest', completed: 0, total: 1000 }),
      JSON.stringify({ status: 'downloading', completed: 250, total: 1000 }),
      JSON.stringify({ status: 'downloading', completed: 500, total: 1000 }),
      JSON.stringify({ status: 'downloading', completed: 750, total: 1000 }),
      JSON.stringify({ status: 'success', completed: 1000, total: 1000 }),
    ];
    fetchSpy.mockResolvedValue(makeFetchResponse(lines));

    const calls: Array<{ percent: number; status: string }> = [];
    await pullOllamaModel('llama3.2:3b', {
      onProgress: (p) => { calls.push(p); },
      baseUrl: 'http://127.0.0.1:11434',
    });

    // Should have reported progress for each line
    expect(calls.length).toBeGreaterThanOrEqual(2);

    // Find the percent values in order — should be non-decreasing
    const percents = calls.map((c) => c.percent);
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]!);
    }

    // Should have seen 25%, 50%, 75% (rounding) at some point
    expect(percents).toContain(25);
    expect(percents).toContain(50);
    expect(percents).toContain(75);
  });

  it('resolves when a line has status "success"', async () => {
    const lines = [
      JSON.stringify({ status: 'pulling manifest' }),
      JSON.stringify({ status: 'success' }),
    ];
    fetchSpy.mockResolvedValue(makeFetchResponse(lines));

    await expect(pullOllamaModel('llama3.2:3b', {
      onProgress: vi.fn(),
      baseUrl: 'http://127.0.0.1:11434',
    })).resolves.toBeUndefined();
  });

  it('rejects when an error line is received', async () => {
    const lines = [
      JSON.stringify({ status: 'pulling manifest' }),
      JSON.stringify({ error: 'model not found' }),
    ];
    fetchSpy.mockResolvedValue(makeFetchResponse(lines));

    await expect(pullOllamaModel('llama3.2:3b', {
      onProgress: vi.fn(),
      baseUrl: 'http://127.0.0.1:11434',
    })).rejects.toThrow('model not found');
  });

  it('rejects when Ollama returns a non-OK HTTP status', async () => {
    fetchSpy.mockResolvedValue(makeFetchResponse([], false, 404));

    await expect(pullOllamaModel('llama3.2:3b', {
      onProgress: vi.fn(),
      baseUrl: 'http://127.0.0.1:11434',
    })).rejects.toThrow('404');
  });

  it('rejects gracefully when fetch itself throws (network/CORS failure)', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(pullOllamaModel('llama3.2:3b', {
      onProgress: vi.fn(),
      baseUrl: 'http://127.0.0.1:11434',
    })).rejects.toThrow('Failed to fetch');
  });

  it('sends the request to the correct endpoint with the model name', async () => {
    const lines = [JSON.stringify({ status: 'success' })];
    fetchSpy.mockResolvedValue(makeFetchResponse(lines));

    await pullOllamaModel('mymodel:latest', {
      onProgress: vi.fn(),
      baseUrl: 'http://127.0.0.1:11434',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/pull',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"mymodel:latest"'),
      }),
    );
  });

  it('passes AbortSignal through to fetch', async () => {
    const ctrl = new AbortController();
    fetchSpy.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    await expect(pullOllamaModel('llama3.2:3b', {
      onProgress: vi.fn(),
      signal: ctrl.signal,
      baseUrl: 'http://127.0.0.1:11434',
    })).rejects.toThrow();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: ctrl.signal }),
    );
  });

  it('computes percent correctly (rounds to integer, capped at 100)', async () => {
    const lines = [
      JSON.stringify({ status: 'downloading', completed: 1, total: 3 }),
      JSON.stringify({ status: 'success', completed: 3, total: 3 }),
    ];
    fetchSpy.mockResolvedValue(makeFetchResponse(lines));

    const calls: Array<{ percent: number }> = [];
    await pullOllamaModel('llama3.2:3b', {
      onProgress: (p) => { calls.push(p); },
      baseUrl: 'http://127.0.0.1:11434',
    });

    // 1/3 = 33.33... → rounded to 33
    expect(calls[0]?.percent).toBe(33);
    // 3/3 = 100 but the 'success' line at 100 is also called
    expect(calls.some((c) => c.percent === 100)).toBe(true);
  });
});

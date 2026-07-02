/**
 * Security fix (2026-07-01 eval, F2.6c): Gemini requests must never carry the
 * API key in the URL (`?key=...`) — a URL leaks via browser history, proxy
 * access logs, and referrer headers in a way a header does not. The key now
 * travels in the `x-goog-api-key` header on every Gemini REST call:
 * generateContent, streamGenerateContent (SSE), and ModelListService's
 * models.list. `redactUrl()` is the defensive backstop that guarantees a key
 * can never reach a console/error/diagnostic string from these files even if
 * one leaks in some future change.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '@/platform/providers/GeminiProvider';
import { redactUrl } from '@/platform/providers/fetchUtils';
import { getModels, clearModelCache } from '@/platform/providers/ModelListService';
import { useDirectModeForTests } from '../../helpers/cloudModeForTests';

useDirectModeForTests();

const SECRET_KEY = 'AIzaSy-super-secret-test-key';

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

describe('redactUrl', () => {
  it('redacts a key= query param, preserving the rest of the URL', () => {
    expect(redactUrl('https://x.test/v1?key=AIzaSecret&alt=sse')).toBe(
      'https://x.test/v1?key=REDACTED&alt=sse',
    );
  });

  it('redacts key= as the first (non-leading-&) param too', () => {
    expect(redactUrl('https://x.test/v1?key=AIzaSecret')).toBe('https://x.test/v1?key=REDACTED');
  });

  it('is a no-op on a URL with no key= param', () => {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent';
    expect(redactUrl(url)).toBe(url);
  });

  it('redacts a key= fragment embedded in arbitrary diagnostic text', () => {
    const message = 'fetch failed for https://x.test/v1?key=AIzaSecret : network error';
    expect(redactUrl(message)).not.toContain('AIzaSecret');
    expect(redactUrl(message)).toContain('key=REDACTED');
  });
});

describe('GeminiProvider — key transport (sendMessage / generateContent)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the key via the x-goog-api-key header, never in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      candidates: [{ content: { parts: [{ text: 'hi' }], role: 'model' }, finishReason: 'STOP', index: 0 }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new GeminiProvider({ apiKey: SECRET_KEY, model: 'gemini-1.5-pro' });

    await provider.sendMessage('hello');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(SECRET_KEY);
    expect(url).not.toContain('key=');
    expect(url).toContain(':generateContent');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe(SECRET_KEY);
  });
});

describe('GeminiProvider — key transport (sendMessageStreaming)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the key via the x-goog-api-key header on the SSE endpoint, never in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(''));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new GeminiProvider({ apiKey: SECRET_KEY, model: 'gemini-1.5-pro' });

    await provider.sendMessageStreaming('hello', { onChunk: () => {} });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(SECRET_KEY);
    expect(url).not.toContain('key=');
    expect(url).toContain(':streamGenerateContent');
    expect(url).toContain('alt=sse');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe(SECRET_KEY);
  });

  it('a network-level fetch failure never surfaces the key (defense-in-depth via redactUrl)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new Error(`fetch failed: https://generativelanguage.googleapis.com/x?key=${SECRET_KEY}`),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new GeminiProvider({ apiKey: SECRET_KEY, model: 'gemini-1.5-pro' });

    let caught: unknown;
    try {
      await provider.sendMessageStreaming('hello', { onChunk: () => {} });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String((caught as Error).message)).not.toContain(SECRET_KEY);
  });
});

describe('ModelListService.getModels(\'google\', ...) — key transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearModelCache('google');
  });

  it('fetches models.list with the key in the x-goog-api-key header, never in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      models: [{ name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', supportedGenerationMethods: ['generateContent'] }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    await getModels('google', SECRET_KEY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(SECRET_KEY);
    expect(url).not.toContain('key=');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe(SECRET_KEY);
  });
});

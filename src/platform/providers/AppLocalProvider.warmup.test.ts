// Bug 3 (transient first-call failure): the very first Ask right after
// switching to Local-only can race the sidecar's model load and come back
// 503 "loading model", surfacing as "the local AI couldn't answer". The
// provider now retries the initial contact through a bounded warm-up window,
// so that transient miss becomes a short wait, not a failure.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppLocalProvider } from './AppLocalProvider';

function jsonResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      model: 'qwen3-4b',
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const startSidecar = (): Promise<string> => Promise.resolve('http://127.0.0.1:18089');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AppLocalProvider warm-up retry', () => {
  it('retries a 503 "loading model" first contact, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('loading model', { status: 503 }))
      .mockResolvedValueOnce(new Response('loading model', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse('The beneficiary is Jessica Reyes.'));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AppLocalProvider({ startSidecar });
    const resp = await provider.sendMessage('who is the beneficiary?');

    expect(resp.content).toBe('The beneficiary is Jessica Reyes.');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-warmup error status (fails fast)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AppLocalProvider({ startSidecar });
    await expect(provider.sendMessage('hello')).rejects.toThrow('HTTP 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the first contact already succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse('ready'));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AppLocalProvider({ startSidecar });
    const resp = await provider.sendMessage('hello');

    expect(resp.content).toBe('ready');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates a user abort immediately without retrying', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AppLocalProvider({ startSidecar });
    await expect(
      provider.sendMessage('hello', { signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

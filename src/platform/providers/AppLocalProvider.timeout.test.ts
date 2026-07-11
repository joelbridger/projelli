// lp/localai-patience (round 2) — the local providers wrap their fetch in
// composeRequestSignal with a 120s whole-request timeout. A big on-device Ask
// legitimately takes longer than 120s before its first token (measured: a
// 4,574-token prompt = ~70.5s of CPU prompt-eval, and Ask's first-token budget
// scales up to ~159s / 4 min for such prompts). Without threading a matching
// per-request timeout, the request layer aborts FIRST and the intended patience
// is never honoured. These specs pin that the per-request override is respected:
// with a budget > 120s, the request signal does NOT abort before the budget.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/privacy/networkClient', () => ({
  egressFetch: (
    operationId: string,
    input: string | URL,
    init?: RequestInit
  ) => {
    void operationId;
    return fetch(input, init);
  },
}));

import { AppLocalProvider } from './AppLocalProvider';
import { OllamaProvider } from './OllamaProvider';
import { DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS } from './requestControl';

const startSidecar = (): Promise<string> =>
  Promise.resolve('http://127.0.0.1:18089');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A fetch that never resolves but captures the AbortSignal it was handed, so
 *  we can observe exactly when (if ever) the request layer aborts it. */
function neverResolvingFetch(): {
  fetchMock: ReturnType<typeof vi.fn>;
  getSignal: () => AbortSignal | undefined;
} {
  let captured: AbortSignal | undefined;
  const fetchMock = vi
    .fn()
    .mockImplementation((_url: string, init?: RequestInit) => {
      captured = init?.signal ?? undefined;
      return new Promise<Response>(() => {
        /* never resolves — we only care about the abort timer */
      });
    });
  return { fetchMock, getSignal: () => captured };
}

describe('AppLocalProvider — per-request timeout override (lp/localai-patience round 2)', () => {
  it('does not abort a local send before the scaled budget, even past the 120s default', async () => {
    vi.useFakeTimers();
    const { fetchMock, getSignal } = neverResolvingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const budgetMs = 159_000; // a big-prompt local budget, > the 120s default
    const provider = new AppLocalProvider({ startSidecar });
    // Fire and forget — the fetch mock never resolves, so this promise never
    // settles (no rejection to catch); we assert only on the captured signal.
    // eslint-disable-next-line lantern-async/no-silent-failure -- intentionally-hanging test promise; the mock never settles
    void provider.sendMessage('a big question over many documents', {
      requestTimeoutMs: budgetMs,
    });

    // Let ensureEndpoint (startSidecar) + buildMessages + the fetch kick off.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Past the OLD 120s default ceiling, but inside the scaled budget: the
    // request must NOT have been aborted — this is the exact bug.
    await vi.advanceTimersByTimeAsync(DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS + 1);
    expect(getSignal()?.aborted).toBe(false);

    // At the budget, the request layer's timeout finally fires, honestly.
    await vi.advanceTimersByTimeAsync(
      budgetMs - (DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS + 1)
    );
    expect(getSignal()?.aborted).toBe(true);
  });

  it('still aborts at the 120s default when no override is given (cloud/unscaled behaviour unchanged)', async () => {
    vi.useFakeTimers();
    const { fetchMock, getSignal } = neverResolvingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AppLocalProvider({ startSidecar });
    // eslint-disable-next-line lantern-async/no-silent-failure -- intentionally-hanging test promise; the mock never settles
    void provider.sendMessage('a normal question');

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS - 1);
    expect(getSignal()?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(getSignal()?.aborted).toBe(true);
  });
});

describe('OllamaProvider — per-request timeout override (lp/localai-patience round 2)', () => {
  it('does not abort a local send before the scaled budget, even past the 120s default', async () => {
    vi.useFakeTimers();
    const { fetchMock, getSignal } = neverResolvingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const budgetMs = 200_000; // > the 120s default
    const provider = new OllamaProvider({ model: 'llama3.1:8b' });
    // eslint-disable-next-line lantern-async/no-silent-failure -- intentionally-hanging test promise; the mock never settles
    void provider.sendMessage('a big question over many documents', {
      requestTimeoutMs: budgetMs,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS + 1);
    expect(getSignal()?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(
      budgetMs - (DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS + 1)
    );
    expect(getSignal()?.aborted).toBe(true);
  });
});

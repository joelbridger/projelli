// F-120 — the in-flight cloud-egress signal (VG-5a).
//
// The store counts provider HTTP requests in flight so the status bar can
// show a positive "sending" state while egress is actually happening.
// `instrumentEgressFetch` wraps a fetch so every call signals begin/end
// whether it resolves or rejects, and `getCorsSafeFetch` returns an
// instrumented fetch by default — with an opt-out for callers whose traffic
// is NOT "your AI provider" (the firm relay and the bug-report endpoint).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useEgressActivityStore,
  instrumentEgressFetch,
} from '@/platform/privacy/egressActivity';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';

/** A promise whose settlement the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const activeCount = () => useEgressActivityStore.getState().activeCount;

beforeEach(() => {
  useEgressActivityStore.setState({ activeCount: 0, lastActivityAt: 0 });
});

describe('useEgressActivityStore', () => {
  it('begin increments and stamps lastActivityAt; end decrements', () => {
    const { begin, end } = useEgressActivityStore.getState();
    begin();
    expect(activeCount()).toBe(1);
    expect(useEgressActivityStore.getState().lastActivityAt).toBeGreaterThan(0);
    end();
    expect(activeCount()).toBe(0);
  });

  it('never drops the count below zero', () => {
    const { end } = useEgressActivityStore.getState();
    end();
    end();
    expect(activeCount()).toBe(0);
  });
});

describe('instrumentEgressFetch', () => {
  it('counts an in-flight request and decrements when it resolves', async () => {
    const d = deferred<Response>();
    const fake = vi.fn(() => d.promise) as unknown as typeof globalThis.fetch;
    const wrapped = instrumentEgressFetch(fake);

    const pending = wrapped('https://api.example.test/v1/messages');
    expect(activeCount()).toBe(1);

    d.resolve(new Response('{}'));
    await pending;
    expect(activeCount()).toBe(0);
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it('decrements on rejection too (a failed send is no longer in flight)', async () => {
    const d = deferred<Response>();
    const fake = (() => d.promise) as typeof globalThis.fetch;
    const wrapped = instrumentEgressFetch(fake);

    const pending = wrapped('https://api.example.test/v1/messages');
    expect(activeCount()).toBe(1);

    d.reject(new Error('network down'));
    await expect(pending).rejects.toThrow('network down');
    expect(activeCount()).toBe(0);
  });

  it('overlapping requests stack and unwind independently', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const queue = [first.promise, second.promise];
    const fake = (() => queue.shift()!) as typeof globalThis.fetch;
    const wrapped = instrumentEgressFetch(fake);

    const p1 = wrapped('https://api.example.test/one');
    const p2 = wrapped('https://api.example.test/two');
    expect(activeCount()).toBe(2);

    first.resolve(new Response('{}'));
    await p1;
    expect(activeCount()).toBe(1);

    second.resolve(new Response('{}'));
    await p2;
    expect(activeCount()).toBe(0);
  });
});

describe('getCorsSafeFetch egress instrumentation', () => {
  // The vitest environment is not Tauri, so getCorsSafeFetch takes the
  // native-fetch path; spying on globalThis.fetch observes the wrapping.
  it('returns an instrumented fetch by default', async () => {
    const d = deferred<Response>();
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => d.promise);
    try {
      const fetchFn = await getCorsSafeFetch();
      const pending = fetchFn('https://api.anthropic.com/v1/models');
      expect(activeCount()).toBe(1);
      d.resolve(new Response('{}'));
      await pending;
      expect(activeCount()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('signalEgress: false opts out (relay and bug-report traffic is not provider egress)', async () => {
    const d = deferred<Response>();
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => d.promise);
    try {
      const fetchFn = await getCorsSafeFetch({ signalEgress: false });
      const pending = fetchFn('https://api.lanternplatform.app/v1/org/roster');
      expect(activeCount()).toBe(0);
      d.resolve(new Response('{}'));
      await pending;
      expect(activeCount()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

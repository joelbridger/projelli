// src/platform/browserGuard/flushHandoff.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestFlushAck, wireFlushResponder, type FlushAckChannel, type FlushAckMessage } from './flushHandoff';

/** In-memory pub/sub standing in for BroadcastChannel — same shape, so it's
 *  a faithful test double without needing a real cross-tab channel. */
class FakeChannel implements FlushAckChannel {
  private listeners = new Set<(event: MessageEvent<unknown>) => void>();
  sent: FlushAckMessage[] = [];

  postMessage(message: FlushAckMessage): void {
    this.sent.push(message);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }

  /** Test helper: deliver a message to every current listener. */
  deliver(data: unknown): void {
    this.listeners.forEach((listener) => {
      listener({ data } as MessageEvent<unknown>);
    });
  }
}

describe('requestFlushAck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts a flush-request (with a requestId) and resolves true when the matching ack arrives before the timeout', async () => {
    const channel = new FakeChannel();
    const pending = requestFlushAck({ channel, timeoutMs: 2500, requestId: 'req-1' });

    expect(channel.sent).toEqual([{ type: 'flush-request', requestId: 'req-1' }]);

    channel.deliver({ type: 'flush-ack', requestId: 'req-1' });
    await expect(pending).resolves.toBe(true);
  });

  it('resolves false once the timeout elapses with no ack (a dead owner cannot wedge takeover forever)', async () => {
    const channel = new FakeChannel();
    const pending = requestFlushAck({ channel, timeoutMs: 2500, requestId: 'req-1' });

    await vi.advanceTimersByTimeAsync(2500);
    await expect(pending).resolves.toBe(false);
  });

  it('ignores unrelated messages and still resolves true on the real ack', async () => {
    const channel = new FakeChannel();
    const pending = requestFlushAck({ channel, timeoutMs: 2500, requestId: 'req-1' });

    channel.deliver({ type: 'flush-request', requestId: 'someone-elses-request' }); // some other tab's own request, not an ack
    channel.deliver('garbage');
    channel.deliver({ type: 'flush-ack' }); // malformed: missing requestId
    channel.deliver({ type: 'flush-ack', requestId: 'req-1' });

    await expect(pending).resolves.toBe(true);
  });

  it('does not resolve twice if an ack arrives right at/after the timeout boundary', async () => {
    const channel = new FakeChannel();
    const pending = requestFlushAck({ channel, timeoutMs: 100, requestId: 'req-1' });

    await vi.advanceTimersByTimeAsync(100);
    channel.deliver({ type: 'flush-ack', requestId: 'req-1' }); // arrives too late — already timed out

    await expect(pending).resolves.toBe(false);
  });

  it('regression (coordinator finding, round 7): a stale ack from a PRIOR (already timed-out) request does not resolve a NEW request; the matching ack does', async () => {
    const channel = new FakeChannel();

    // First request times out — its requester moves on believing "no ack".
    const first = requestFlushAck({ channel, timeoutMs: 100, requestId: 'req-1' });
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toBe(false);

    // A second, independent request starts (e.g. a different tab's takeover
    // attempt, or a retry) while the first owner is still slowly flushing.
    const second = requestFlushAck({ channel, timeoutMs: 2500, requestId: 'req-2' });

    // The first request's ack finally arrives, late. Without requestId
    // correlation this would incorrectly resolve `second` — it must not.
    channel.deliver({ type: 'flush-ack', requestId: 'req-1' });

    // `second` is still pending — nothing has acked ITS request yet.
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    // The real ack for `second`'s own request arrives — only now does it resolve.
    channel.deliver({ type: 'flush-ack', requestId: 'req-2' });
    await expect(second).resolves.toBe(true);
  });
});

describe('wireFlushResponder', () => {
  it('flushes and acks (echoing the request\'s own requestId) when a flush-request arrives while this tab is the owner', async () => {
    const channel = new FakeChannel();
    let flushed = false;
    const flush = vi.fn(() => {
      flushed = true;
      return Promise.resolve();
    });

    wireFlushResponder(channel, () => true, flush);
    channel.deliver({ type: 'flush-request', requestId: 'req-1' });
    await Promise.resolve(); // let the flush promise's .then() run
    await Promise.resolve();

    expect(flushed).toBe(true);
    expect(channel.sent).toEqual([{ type: 'flush-ack', requestId: 'req-1' }]);
  });

  it('does not flush or ack a flush-request while this tab is NOT the owner', async () => {
    const channel = new FakeChannel();
    const flush = vi.fn(() => Promise.resolve());

    wireFlushResponder(channel, () => false, flush);
    channel.deliver({ type: 'flush-request', requestId: 'req-1' });
    await Promise.resolve();

    expect(flush).not.toHaveBeenCalled();
    expect(channel.sent).toEqual([]);
  });

  it('unsubscribe stops responding to further requests', async () => {
    const channel = new FakeChannel();
    const flush = vi.fn(() => Promise.resolve());

    const unsubscribe = wireFlushResponder(channel, () => true, flush);
    unsubscribe();
    channel.deliver({ type: 'flush-request', requestId: 'req-1' });
    await Promise.resolve();

    expect(flush).not.toHaveBeenCalled();
  });
});

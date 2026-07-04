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

  it('posts a flush-request and resolves true when an ack arrives before the timeout', async () => {
    const channel = new FakeChannel();
    const pending = requestFlushAck({ channel, timeoutMs: 2500 });

    expect(channel.sent).toEqual([{ type: 'flush-request' }]);

    channel.deliver({ type: 'flush-ack' });
    await expect(pending).resolves.toBe(true);
  });

  it('resolves false once the timeout elapses with no ack (a dead owner cannot wedge takeover forever)', async () => {
    const channel = new FakeChannel();
    const pending = requestFlushAck({ channel, timeoutMs: 2500 });

    await vi.advanceTimersByTimeAsync(2500);
    await expect(pending).resolves.toBe(false);
  });

  it('ignores unrelated messages and still resolves true on the real ack', async () => {
    const channel = new FakeChannel();
    const pending = requestFlushAck({ channel, timeoutMs: 2500 });

    channel.deliver({ type: 'flush-request' }); // some other tab's own request, not an ack
    channel.deliver('garbage');
    channel.deliver({ type: 'flush-ack' });

    await expect(pending).resolves.toBe(true);
  });

  it('does not resolve twice if an ack arrives right at/after the timeout boundary', async () => {
    const channel = new FakeChannel();
    const pending = requestFlushAck({ channel, timeoutMs: 100 });

    await vi.advanceTimersByTimeAsync(100);
    channel.deliver({ type: 'flush-ack' }); // arrives too late — already timed out

    await expect(pending).resolves.toBe(false);
  });
});

describe('wireFlushResponder', () => {
  it('flushes and acks when a flush-request arrives while this tab is the owner', async () => {
    const channel = new FakeChannel();
    let flushed = false;
    const flush = vi.fn(() => {
      flushed = true;
      return Promise.resolve();
    });

    wireFlushResponder(channel, () => true, flush);
    channel.deliver({ type: 'flush-request' });
    await Promise.resolve(); // let the flush promise's .then() run
    await Promise.resolve();

    expect(flushed).toBe(true);
    expect(channel.sent).toEqual([{ type: 'flush-ack' }]);
  });

  it('does not flush or ack a flush-request while this tab is NOT the owner', async () => {
    const channel = new FakeChannel();
    const flush = vi.fn(() => Promise.resolve());

    wireFlushResponder(channel, () => false, flush);
    channel.deliver({ type: 'flush-request' });
    await Promise.resolve();

    expect(flush).not.toHaveBeenCalled();
    expect(channel.sent).toEqual([]);
  });

  it('unsubscribe stops responding to further requests', async () => {
    const channel = new FakeChannel();
    const flush = vi.fn(() => Promise.resolve());

    const unsubscribe = wireFlushResponder(channel, () => true, flush);
    unsubscribe();
    channel.deliver({ type: 'flush-request' });
    await Promise.resolve();

    expect(flush).not.toHaveBeenCalled();
  });
});

// src/platform/browserGuard/flushHandoff.ts
//
// QA-15 round 5 (codex-review P1): requestTakeover() used to claim the lock
// and reload immediately, firing `flushAllDirtyTabs()` on the OLD owner as a
// fire-and-forget side effect of losing the lock. The new owner's reload
// could land and read a file BEFORE that flush finished, then save over the
// old owner's still-in-flight edit. This module is the request/ack handshake
// that closes that gap: the tab wanting to take over asks the current owner
// to flush FIRST and waits (briefly) for confirmation before actually
// claiming the lock.
//
// Small and DOM/BroadcastChannel-agnostic (takes a plain pub/sub interface)
// so the timeout/race logic is unit-testable with a fake channel + fake
// timers, the same way TabWriteGuard's protocol is testable with a fake
// Storage. A real `BroadcastChannel` instance satisfies `FlushAckChannel`
// as-is (it already has postMessage/addEventListener/removeEventListener).

export interface FlushAckMessage {
  type: 'flush-request' | 'flush-ack';
}

export interface FlushAckChannel {
  postMessage(message: FlushAckMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

function isFlushAckMessage(data: unknown, type: FlushAckMessage['type']): boolean {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === type;
}

export interface RequestFlushAckOptions {
  channel: FlushAckChannel;
  timeoutMs?: number;
  // `unknown` handle type (not ReturnType<typeof setTimeout>) so this
  // doesn't get tangled in the ambient dom/node setTimeout overload split —
  // callers never need to inspect the handle themselves.
  setTimeoutFn?: (callback: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

/** Ask whoever is listening (the current owner) to flush, and wait for its
 *  ack — but only up to `timeoutMs`. Resolves `true` if acked in time,
 *  `false` on timeout (a dead/unresponsive owner can't wedge a takeover
 *  forever — the caller proceeds anyway on `false`, just without the extra
 *  confirmation). */
function defaultSetTimeout(callback: () => void, ms: number): unknown {
  return setTimeout(callback, ms);
}

function defaultClearTimeout(handle: unknown): void {
  clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
}

export function requestFlushAck(options: RequestFlushAckOptions): Promise<boolean> {
  const { channel, timeoutMs = 2500 } = options;
  const setTimeoutFn = options.setTimeoutFn ?? defaultSetTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? defaultClearTimeout;

  return new Promise((resolve) => {
    let settled = false;
    const onMessage = (event: MessageEvent<unknown>) => {
      if (settled || !isFlushAckMessage(event.data, 'flush-ack')) return;
      settled = true;
      clearTimeoutFn(timer);
      channel.removeEventListener('message', onMessage);
      resolve(true);
    };
    channel.addEventListener('message', onMessage);

    const timer = setTimeoutFn(() => {
      if (settled) return;
      settled = true;
      channel.removeEventListener('message', onMessage);
      resolve(false);
    }, timeoutMs);

    channel.postMessage({ type: 'flush-request' });
  });
}

/** Wire the OWNER side of the handshake: whenever a flush-request arrives
 *  and this tab is (still) the owner at that moment, flush and ack. Returns
 *  an unsubscribe function. `isOwner` is a thunk (not a snapshot) because
 *  ownership can change between when this is wired and when a request
 *  arrives. */
export function wireFlushResponder(
  channel: FlushAckChannel,
  isOwner: () => boolean,
  flush: () => Promise<void>,
): () => void {
  const onMessage = (event: MessageEvent<unknown>) => {
    if (!isFlushAckMessage(event.data, 'flush-request') || !isOwner()) return;
    void flush().then(() => {
      channel.postMessage({ type: 'flush-ack' });
    });
  };
  channel.addEventListener('message', onMessage);
  return () => {
    channel.removeEventListener('message', onMessage);
  };
}

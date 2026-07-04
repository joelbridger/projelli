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
  // Per-request nonce (round 7 codex-review/coordinator finding): without
  // this, acks are uncorrelated — a previous request's LATE ack (arriving
  // after ITS requester already timed out and moved on) is indistinguishable
  // from a fresh one, so a DIFFERENT, later requestFlushAck() call could
  // resolve on that stale ack and take the lock before the CURRENT owner
  // ever flushed for THIS request — reopening the overwrite race this whole
  // handshake exists to close. The responder echoes back the exact
  // requestId it received, and a waiter only resolves on a match.
  requestId: string;
}

export interface FlushAckChannel {
  postMessage(message: FlushAckMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

function parseFlushAckMessage(data: unknown, type: FlushAckMessage['type']): FlushAckMessage | null {
  if (
    typeof data !== 'object' ||
    data === null ||
    (data as { type?: unknown }).type !== type ||
    typeof (data as { requestId?: unknown }).requestId !== 'string'
  ) {
    return null;
  }
  return data as FlushAckMessage;
}

function defaultGenerateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `flush_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

function defaultSetTimeout(callback: () => void, ms: number): unknown {
  return setTimeout(callback, ms);
}

function defaultClearTimeout(handle: unknown): void {
  clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
}

export interface RequestFlushAckOptions {
  channel: FlushAckChannel;
  timeoutMs?: number;
  /** Injectable for deterministic tests; defaults to a fresh random id per call. */
  requestId?: string;
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
 *  confirmation). Only an ack whose requestId matches THIS call's own
 *  request can resolve it — a stale ack for a different (e.g. previously
 *  timed-out) request is ignored. */
export function requestFlushAck(options: RequestFlushAckOptions): Promise<boolean> {
  const { channel, timeoutMs = 2500 } = options;
  const requestId = options.requestId ?? defaultGenerateRequestId();
  const setTimeoutFn = options.setTimeoutFn ?? defaultSetTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? defaultClearTimeout;

  return new Promise((resolve) => {
    let settled = false;
    const onMessage = (event: MessageEvent<unknown>) => {
      const ack = parseFlushAckMessage(event.data, 'flush-ack');
      if (settled || !ack || ack.requestId !== requestId) return;
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

    channel.postMessage({ type: 'flush-request', requestId });
  });
}

/** Wire the OWNER side of the handshake: whenever a flush-request arrives
 *  and this tab is (still) the owner at that moment, flush and ack —
 *  echoing back the SAME requestId it received, never minting its own, so
 *  the waiter can correlate the ack to its own request. Returns an
 *  unsubscribe function. `isOwner` is a thunk (not a snapshot) because
 *  ownership can change between when this is wired and when a request
 *  arrives. */
export function wireFlushResponder(
  channel: FlushAckChannel,
  isOwner: () => boolean,
  flush: () => Promise<void>,
): () => void {
  const onMessage = (event: MessageEvent<unknown>) => {
    const request = parseFlushAckMessage(event.data, 'flush-request');
    if (!request || !isOwner()) return;
    void flush().then(() => {
      channel.postMessage({ type: 'flush-ack', requestId: request.requestId });
    });
  };
  channel.addEventListener('message', onMessage);
  return () => {
    channel.removeEventListener('message', onMessage);
  };
}

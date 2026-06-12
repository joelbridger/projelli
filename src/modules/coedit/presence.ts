/**
 * presence.ts — Task 11: best-effort ephemeral presence for live co-editing.
 *
 * Decision: `y-protocols` (Awareness) is NOT in the project's dependencies
 * (only `yjs` is present). Live carets via the Awareness sub-protocol would
 * require wiring a separate sub-protocol over the existing WebSocket transport
 * in MatterDocSyncClient/MatterSyncClient, which is non-trivial and risky.
 * Per the design spec §10 scope call: ship the simpler v1 ("N people editing"
 * indicator from the participant list) and mark live carets as a fast-follow.
 *
 * Architecture:
 *   PresenceBus — an in-memory singleton per `docId` that holds the ephemeral
 *     participant map and fan-outs change notifications. It is NEVER persisted
 *     and has NO reference to any Y.Doc or the relay.
 *
 *   PresenceChannel — the per-client handle. Each collaborator creates one,
 *     calls join() to announce themselves, updateCaret() to push optional
 *     caret position, and others() to read the remote participant list.
 *     dispose() removes the local participant from the bus and clears timers.
 *
 * Ephemerality guarantee: PresenceBus lives only in process memory. It is
 * never written to IndexedDB, SQLite, the relay, or the Y.Doc CRDT. When all
 * channels for a docId dispose(), the bus is garbage-collected.
 *
 * Cross-machine presence: in a Tauri desktop setting each machine runs its own
 * PresenceBus (in-process only). Cross-machine presence is the fast-follow
 * (wire a lightweight `presence` doc_id stream over the relay). The current
 * in-process bus already works correctly for multi-tab / multi-window single-
 * machine scenarios and for tests.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CaretPosition {
  /** Index into the Y.Doc body array. */
  blockIndex: number;
  /** Index into the paragraph's inlines array. */
  runIndex: number;
  /** Character offset within the run. */
  offset: number;
}

export interface PresenceEntry {
  /** Stable unique id for the local client (UUID or seat token prefix). */
  clientId: string;
  /** Display name stamped on tracked changes (mirrors `authorName`). */
  author: string;
  /** Best-effort caret; absent when the client hasn't reported one yet. */
  caret?: CaretPosition;
}

// ---------------------------------------------------------------------------
// PresenceBus — ephemeral in-memory fan-out hub (never persisted)
// ---------------------------------------------------------------------------

type ChangeListener = () => void;

/**
 * One bus per `docId`. Holds the participant map and notifies subscribers.
 *
 * Use PresenceBus.forDoc(docId) / PresenceBus.release(docId) for lifecycle.
 */
export class PresenceBus {
  /** In-process registry: one bus per docId. */
  private static registry = new Map<string, PresenceBus>();

  /** Live participants, keyed by clientId. */
  private participants = new Map<string, PresenceEntry>();
  /** Change listeners (typically one per PresenceChannel). */
  private listeners = new Set<ChangeListener>();
  /** Ref-count for release logic. */
  private refCount = 0;

  private constructor(public readonly docId: string) {}

  /** Get-or-create the shared bus for a docId. Increments refcount. */
  static forDoc(docId: string): PresenceBus {
    let bus = PresenceBus.registry.get(docId);
    if (!bus) {
      bus = new PresenceBus(docId);
      PresenceBus.registry.set(docId, bus);
    }
    bus.refCount += 1;
    return bus;
  }

  /**
   * Decrement refcount. If it hits zero, remove from registry so the bus can
   * be garbage-collected.
   */
  static release(docId: string): void {
    const bus = PresenceBus.registry.get(docId);
    if (!bus) return;
    bus.refCount -= 1;
    if (bus.refCount <= 0) {
      PresenceBus.registry.delete(docId);
    }
  }

  // ── Internal mutation helpers ─────────────────────────────────────────────

  /** Called by PresenceChannel.join() / updateCaret(). */
  _announce(entry: PresenceEntry): void {
    this.participants.set(entry.clientId, { ...entry });
    this._notify();
  }

  /** Called by PresenceChannel.dispose(). */
  _depart(clientId: string): void {
    this.participants.delete(clientId);
    this._notify();
  }

  /** Snapshot of all participants EXCEPT the given clientId. */
  _othersFor(localClientId: string): PresenceEntry[] {
    const out: PresenceEntry[] = [];
    for (const [id, entry] of this.participants) {
      if (id !== localClientId) out.push({ ...entry });
    }
    return out;
  }

  /** Subscribe to any change. Returns unsubscribe. */
  _subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private _notify(): void {
    for (const l of this.listeners) l();
  }
}

// ---------------------------------------------------------------------------
// PresenceChannel options
// ---------------------------------------------------------------------------

export interface PresenceChannelOptions {
  /** Stable unique id for this client (UUID preferred). */
  clientId: string;
  /** Display name (mirrors `authorName` in DocxEditor). */
  author: string;
  /** The bus to attach to. Obtain via PresenceBus.forDoc(docId). */
  bus: PresenceBus;
  /**
   * Heartbeat interval in ms. Presence is refreshed on this cadence so
   * ephemeral departure (process crash / network drop) eventually times out.
   * Defaults to 8 000 ms. Tests may pass 0 to skip the timer.
   */
  heartbeatIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// PresenceChannel — per-client handle
// ---------------------------------------------------------------------------

/**
 * Ephemeral presence handle for a single client on a co-editing session.
 *
 * Lifecycle:
 *   1. Create via `new PresenceChannel(opts)`.
 *   2. Call `join()` to announce this client to peers.
 *   3. Call `updateCaret(pos)` as the user moves their cursor.
 *   4. Call `others()` to read the current remote participant list.
 *   5. Call `onChange(cb)` to subscribe to presence updates.
 *   6. Call `dispose()` to announce departure and clean up timers.
 *
 * Ephemerality: holds NO reference to any Y.Doc, relay, or persisted store.
 */
export class PresenceChannel {
  private readonly clientId: string;
  private readonly author: string;
  private readonly bus: PresenceBus;
  private readonly heartbeatIntervalMs: number;

  private caret?: CaretPosition;
  private timer: ReturnType<typeof setInterval> | undefined = undefined;
  private disposed = false;

  constructor(opts: PresenceChannelOptions) {
    this.clientId = opts.clientId;
    this.author = opts.author;
    this.bus = opts.bus;
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 8_000;
  }

  /**
   * Announce this client to all peers on the bus. Starts the heartbeat timer
   * so presence refreshes periodically.
   */
  join(): void {
    if (this.disposed) return;
    this._publish();
    if (this.heartbeatIntervalMs > 0) {
      this.timer = setInterval(() => {
        if (!this.disposed) this._publish();
      }, this.heartbeatIntervalMs);
    }
  }

  /**
   * Update the local caret position and re-announce to peers immediately.
   * Does NOT add self to the local `others()` list.
   */
  updateCaret(pos: CaretPosition): void {
    if (this.disposed) return;
    this.caret = pos;
    this._publish();
  }

  /**
   * Returns the list of OTHER participants (never includes the local client).
   * Safe to call at any time; returns a snapshot array (not a live reference).
   */
  others(): PresenceEntry[] {
    return this.bus._othersFor(this.clientId);
  }

  /**
   * Subscribe to presence changes (peers join / depart / update caret).
   * Returns an unsubscribe function.
   */
  onChange(cb: () => void): () => void {
    return this.bus._subscribe(cb);
  }

  /**
   * Announce departure and clear the heartbeat timer. Idempotent.
   * After dispose(), join() and updateCaret() are no-ops.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.bus._depart(this.clientId);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private _publish(): void {
    const entry: PresenceEntry = {
      clientId: this.clientId,
      author: this.author,
    };
    if (this.caret !== undefined) entry.caret = { ...this.caret };
    this.bus._announce(entry);
  }
}

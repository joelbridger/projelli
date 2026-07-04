// src/platform/browserGuard/tabWriteGuard.ts
//
// QA-15: two browser tabs open on the same origin share ONE flat localStorage
// keyspace (there is no per-workspace-folder namespacing in the browser
// build — see src/platform/matter/matterStore.ts and friends). zustand's
// `persist` middleware is last-write-wins with no cross-tab awareness, so a
// second tab silently clobbers the first tab's saved state with no error, no
// warning, no merge.
//
// TabWriteGuard is a single-writer lock over one localStorage key. Exactly
// one tab at a time is the "owner"; every other tab on the same origin is
// "blocked" until the owner releases (tab closed) or another tab forces a
// takeover. The app wires this at the App-shell mount point (see
// useTabWriteGuard.ts): a blocked tab never mounts the interactive shell, so
// none of its stores ever run a write — the data-loss class this guards
// against becomes structurally impossible, not just less likely.
//
// Protocol (heartbeat + compare-and-set), framework- and DOM-independent so
// it's directly unit-testable with two instances sharing one Storage object
// (exactly how two real same-origin tabs share one localStorage):
//   - Owner re-writes {tabId, heartbeatAt: now()} every heartbeatIntervalMs.
//   - A blocked tab claims the lock the moment the stored record is missing,
//     stale (older than staleAfterMs), or already stamped with its own id.
//   - An owner that sees a FRESH record stamped with a foreign tabId steps
//     down immediately (this is how requestTakeover() from another tab bumps
//     the current owner) — this is the compare-and-set that keeps the
//     invariant "at most one owner" true even across the narrow race window
//     where two tabs start at nearly the same instant.
//   - checkNow() re-evaluates outside the timer tick; callers wire it to the
//     `storage` event (fires in OTHER tabs, not the one that wrote) for fast
//     handoff, and tests call it directly for deterministic control.

export type TabGuardStatus = 'owner' | 'blocked';

interface TabLockRecord {
  tabId: string;
  heartbeatAt: number;
}

function isTabLockRecord(value: unknown): value is TabLockRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['tabId'] === 'string' && typeof candidate['heartbeatAt'] === 'number';
}

export interface TabWriteGuardOptions {
  storage?: Storage;
  now?: () => number;
  tabId?: string;
  heartbeatIntervalMs?: number;
  /** A record older than this is treated as abandoned (crashed/closed tab
   *  that never released cleanly). Must exceed heartbeatIntervalMs by a
   *  comfortable margin so a live owner's own jitter never self-evicts. */
  staleAfterMs?: number;
}

function randomTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tab_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

export class TabWriteGuard {
  private readonly key: string;
  private readonly storage: Storage;
  private readonly now: () => number;
  private readonly heartbeatIntervalMs: number;
  private readonly staleAfterMs: number;
  private readonly _tabId: string;
  private _status: TabGuardStatus = 'blocked';
  private listeners = new Set<(status: TabGuardStatus) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(key: string, options: TabWriteGuardOptions = {}) {
    this.key = key;
    this.storage = options.storage ?? window.localStorage;
    this.now = options.now ?? (() => Date.now());
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 1500;
    this.staleAfterMs = options.staleAfterMs ?? 5000;
    this._tabId = options.tabId ?? randomTabId();
  }

  get tabId(): string {
    return this._tabId;
  }

  get status(): TabGuardStatus {
    return this._status;
  }

  /** Begin holding/contending for the lock. Safe to call once; starts the
   *  heartbeat/re-evaluation timer and performs an immediate synchronous
   *  check so the common (single-tab) case never shows a loading flash. */
  start(): void {
    this.checkNow();
    if (this.timer === null) {
      this.timer = setInterval(() => {
        this.checkNow();
      }, this.heartbeatIntervalMs);
    }
  }

  /** Stop contending and, if this tab currently owns the lock, release it
   *  immediately so a blocked tab doesn't have to wait out staleAfterMs. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this._status === 'owner') {
      this.clearIfMine();
    }
  }

  /** Force-claim the lock right now, regardless of who currently holds it.
   *  The current owner (if any, in another tab) discovers this on its own
   *  next checkNow() — via its heartbeat timer or a `storage` event — and
   *  steps down; see the module doc for why this can't produce two owners
   *  outside a sub-tick race that self-heals on the next check. */
  requestTakeover(): void {
    this.write();
    this.setStatus('owner');
  }

  /** Re-subscribe to status changes. Returns an unsubscribe function. */
  subscribe(listener: (status: TabGuardStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-evaluate lock ownership immediately (outside the timer cadence).
   *  Wire this to the `storage` event for fast cross-tab handoff. */
  checkNow(): void {
    const record = this.read();
    const now = this.now();

    if (this._status === 'owner') {
      if (record !== null && record.tabId !== this._tabId && now - record.heartbeatAt < this.staleAfterMs) {
        // Someone else force-claimed the lock (requestTakeover) — step down.
        this.setStatus('blocked');
        return;
      }
      // Still ours (or the record was cleared/expired) — reassert the heartbeat.
      this.write();
      return;
    }

    // Currently blocked: claim if the lock is free, stale, or already ours.
    const isClaimable =
      record === null || now - record.heartbeatAt >= this.staleAfterMs || record.tabId === this._tabId;
    if (isClaimable) {
      this.write();
      // Re-read after writing (codex-review P2, round 4): two tabs can both
      // observe the same free/stale record and both reach this branch before
      // either writes (e.g. two tabs starting at nearly the same instant, or
      // two blocked tabs both noticing the same stale lock on the same
      // heartbeat tick). Without this check, both would optimistically
      // report 'owner' even though only one write can be the one actually
      // sitting in localStorage — reopening a two-writer window. Confirming
      // OUR write is still the one there closes that window down to the
      // (much narrower, and self-healing on the next check either way) gap
      // between this read and whatever a competing tab does next.
      if (this.read()?.tabId !== this._tabId) return;
      this.setStatus('owner');
    }
  }

  private setStatus(next: TabGuardStatus): void {
    if (this._status === next) return;
    this._status = next;
    this.listeners.forEach((listener) => {
      listener(next);
    });
  }

  private read(): TabLockRecord | null {
    const raw = this.storage.getItem(this.key);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isTabLockRecord(parsed) ? parsed : null;
    } catch {
      // Corrupt value — treat as no lock, next write repairs it.
      return null;
    }
  }

  private write(): void {
    const record: TabLockRecord = { tabId: this._tabId, heartbeatAt: this.now() };
    this.storage.setItem(this.key, JSON.stringify(record));
  }

  private clearIfMine(): void {
    const record = this.read();
    if (record && record.tabId === this._tabId) {
      this.storage.removeItem(this.key);
    }
  }
}

// src/platform/browserGuard/tabLockGuard.ts
//
// Shared shape both single-writer substrates present to useTabWriteGuard.ts,
// plus the factory that picks between them. See tabWriteGuard.ts's and
// webLocksTabGuard.ts's module headers for what each substrate is and why
// Web Locks (navigator.locks) is preferred wherever it's available; this
// file only wires the selection so the hook never has to know which one it
// got — same pattern as this codebase's FSBackend abstraction (WebFSBackend
// vs TauriFSBackend behind one interface).
//
// KNOWN ROLLOUT-TRANSITION CAVEAT (codex-review, round 4 — flagged for
// coordinator triage, not fixed here): the two substrates don't speak to
// each other. If a tab already has the OLD (pre-migration, heartbeat-only)
// bundle loaded and stays open through a deploy, then a SECOND tab opens
// the NEW bundle, the new tab's Web Locks probe has no way to see the old
// tab's SK_TAB_LOCK localStorage record — it only checks navigator.locks,
// which the old tab never touches. Both tabs can end up believing they're
// the sole writer for as long as the old tab stays open post-deploy. This
// is a deploy-timing risk, not a defect in either substrate's own logic,
// and bridging it properly means either (a) making Web Locks also speak
// the heartbeat protocol during a transition window — reintroducing the
// exact polling/staleness complexity this migration exists to eliminate —
// or (b) a "new version available, please reload" mechanism for the
// browser build, which is a separate, larger feature area (this app's
// existing UpdateBanner/updaterStore only cover the Tauri desktop
// auto-updater, not browser-tab reloads) and out of this migration's scope.

import type { TabGuardStatus } from './tabWriteGuard';
import { TabWriteGuard } from './tabWriteGuard';
import { WebLocksTabGuard, type LockManagerLike } from './webLocksTabGuard';

export type { TabGuardStatus };

export interface TabLockGuard {
  readonly tabId: string;
  readonly status: TabGuardStatus;
  start(): void;
  stop(): void;
  requestTakeover(): void;
  /** Voluntarily release the lock if this guard currently holds it, in
   *  response to another tab's takeover request (see flushHandoff.ts). A
   *  no-op for the heartbeat substrate, whose requestTakeover() forces the
   *  takeover unilaterally instead — see webLocksTabGuard.ts's module doc
   *  for why the Web Locks substrate needs this and the heartbeat one
   *  doesn't. */
  yieldIfOwner(): void;
  /** Called by useTabWriteGuard.ts exactly when it observes a blocked→owner
   *  transition, to decide whether this specific acquisition warrants the
   *  rehydrate-before-write reload (stale zustand-store protection). Always
   *  true for the heartbeat substrate. The Web Locks substrate reports false
   *  exactly once — its very first, probe-confirmed-uncontended acquisition,
   *  which would otherwise look identical to a genuine recovery (see
   *  webLocksTabGuard.ts's attemptAcquire() doc for why that distinction
   *  can't be made from the bare status sequence alone). */
  shouldRehydrateOnThisAcquisition(): boolean;
  subscribe(listener: (status: TabGuardStatus) => void): () => void;
  /** Re-evaluate lock ownership immediately, outside of whatever cadence the
   *  substrate normally uses. A no-op for Web Locks (state is always current,
   *  driven directly by the browser); wired to the heartbeat substrate's
   *  polling correction and to bfcache pageshow restores in
   *  useTabWriteGuard.ts either way, since it's harmless for both. */
  checkNow(): void;
  /** Whether useTabWriteGuard.ts should call stop() when this tab is frozen
   *  into the back/forward cache (bfcache pagehide with event.persisted),
   *  and start() again on restore. False for the heartbeat substrate: it
   *  keeps holding a stale-looking record while frozen on purpose, because
   *  requestTakeover() can force a takeover regardless (see
   *  tabWriteGuard.ts's pagehide-handling doc in useTabWriteGuard.ts).
   *  True for the Web Locks substrate: it has NO forced-takeover primitive
   *  (see webLocksTabGuard.ts's module doc), so a frozen owner's JS being
   *  fully suspended means it can never receive a takeover request's
   *  flush-request broadcast or call its own yieldIfOwner() — without
   *  releasing on freeze, "Take over" would simply hang against a tab that
   *  merely navigated away (a common case), not just a truly dead one. */
  releaseOnFreeze(): boolean;
}

export interface CreateTabGuardOptions {
  tabId?: string;
  /** Test seam / explicit override. Production code omits this and lets
   *  navigator.locks (or its absence) decide. */
  locks?: LockManagerLike;
}

function resolveLockManager(injected: LockManagerLike | undefined): LockManagerLike | undefined {
  if (injected) return injected;
  // lib.dom's Navigator.locks is typed as always-present, but it's genuinely
  // absent at runtime in environments without the Web Locks API (this
  // project's jsdom unit-test environment among them) — cast through
  // `unknown` so the runtime check isn't reported as an always-true
  // tautology by the type checker.
  const maybeLocks = (typeof navigator === 'undefined' ? undefined : navigator) as
    | { locks?: LockManagerLike }
    | undefined;
  return maybeLocks?.locks ?? undefined;
}

/** Picks the Web Locks substrate wherever navigator.locks is available (or a
 *  LockManagerLike is injected for tests), falling back to the heartbeat
 *  substrate everywhere else. */
export function createTabGuard(key: string, options: CreateTabGuardOptions = {}): TabLockGuard {
  const locks = resolveLockManager(options.locks);
  if (locks) {
    return new WebLocksTabGuard(key, options.tabId ? { locks, tabId: options.tabId } : { locks });
  }
  return new TabWriteGuard(key, options.tabId ? { tabId: options.tabId } : {});
}

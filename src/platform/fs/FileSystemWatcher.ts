/**
 * File System Watcher
 *
 * Monitors the workspace for external file/folder changes and refreshes the
 * file tree when they happen.
 *
 * On Tauri (desktop) the Rust backend already runs a native `notify`-crate
 * watcher (`watch_workspace`) that emits a `workspace-file-changed` event per
 * change, debounced 200ms per-path on the Rust side. This class subscribes to
 * that event instead of polling — there is no periodic full workspace walk
 * while the app is idle. A short trailing debounce here coalesces a BURST of
 * distinct-path events (e.g. a hundred files landing from a sync) into a
 * single file-tree refresh.
 *
 * In the browser (WebFSBackend, no OS-level file-change notifications
 * available) this falls back to polling, but at a much longer interval than
 * the old always-on 3s poll — the browser path is a fallback, not the common
 * case, since real users run the desktop app.
 *
 * QA-75: the native `notify`-backed watcher can silently stop delivering
 * events partway through a live session — an inotify queue overflow, a
 * Windows `ReadDirectoryChangesW` handle going stale, or a panicked notify
 * callback thread (see `src-tauri/src/commands/watcher.rs`'s debounce mutex)
 * — without the Rust process crashing or throwing anything JS-visible.
 * Event mode used to install the watcher exactly once per workspace mount
 * and trust it for the rest of the session; if the native side ever went
 * deaf, only a full app restart (a fresh process, fresh watcher) recovered.
 * A low-frequency keepalive now re-arms the native watcher (an idempotent,
 * cheap IPC call — the Rust side just replaces its singleton watcher for the
 * same path) and runs a backstop snapshot diff, so any external change missed
 * while the native side was silently dead surfaces within one keepalive
 * interval instead of requiring a restart.
 */

import { isTauriEnvironment } from './BackendFactory';
import { isInternalWorkspacePath } from '@/platform/hooks/useMemoryWiring';
import { watchWorkspace } from '@/platform/utils/tauri-commands';

/** Browser-fallback poll interval. No OS file-change events are available via
 *  the File System Access API, so we still poll — just rarely. */
const DEFAULT_BROWSER_POLL_INTERVAL_MS = 30_000;

/** How long to wait for a quiet period after the last `workspace-file-changed`
 *  event before refreshing the tree (coalesces bursts into one refresh). */
const DEFAULT_EVENT_DEBOUNCE_MS = 500;

/** Upper bound on how long a sustained stream of events can defer a refresh.
 *  Without this, continuous churn (e.g. a long-running sync) could keep
 *  resetting the trailing debounce forever and the tree would never update. */
const DEFAULT_EVENT_MAX_WAIT_MS = 5_000;

/** QA-75: how often event mode re-arms the native watcher and runs a backstop
 *  snapshot diff. Low-frequency by design — this is a safety net for a native
 *  watcher that has gone silently deaf, not the primary change-detection path
 *  (that's still the real-time `workspace-file-changed` event). */
const DEFAULT_KEEPALIVE_INTERVAL_MS = 60_000;

export interface FileSystemWatcherOptions {
  /** Browser-fallback poll interval in ms (default: 30s). Ignored on Tauri. */
  pollInterval?: number;
  onFileTreeChange?: () => void | Promise<void>;
  /** Trailing debounce window for coalescing Tauri change-event bursts. */
  debounceMs?: number;
  /** Max time a sustained burst can defer a refresh. */
  maxWaitMs?: number;
  /** QA-75: how often event mode re-arms the native watcher + backstop-checks
   *  for a missed change (default: 60s). Ignored in browser poll mode. */
  keepAliveIntervalMs?: number;
}

type WatchMode = 'events' | 'poll' | null;

export class FileSystemWatcher {
  private pollInterval: number;
  private debounceMs: number;
  private maxWaitMs: number;
  private keepAliveIntervalMs: number;
  private onFileTreeChange: (() => void | Promise<void>) | undefined;

  private mode: WatchMode = null;
  private started = false;
  private stopped = false;

  // Poll-mode state (browser fallback).
  private intervalId: number | null = null;
  private isPolling = false;
  private lastFileTreeSnapshot: string | null = null;

  // Event-mode state (Tauri).
  private unlisten: (() => void) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private isRefreshing = false;
  private refreshAgain = false;

  // QA-75: keepalive state (Tauri event mode only).
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private keepAliveSnapshot: string | null = null;

  constructor(options: FileSystemWatcherOptions = {}) {
    this.pollInterval = options.pollInterval ?? DEFAULT_BROWSER_POLL_INTERVAL_MS;
    this.debounceMs = options.debounceMs ?? DEFAULT_EVENT_DEBOUNCE_MS;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_EVENT_MAX_WAIT_MS;
    this.keepAliveIntervalMs = options.keepAliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS;
    this.onFileTreeChange = options.onFileTreeChange ?? undefined;
  }

  // Read through a function, not the bare `stopped` field, at every check
  // inside `startEventDriven`'s async body. `stop()` is a separate call the
  // caller can make at any point — including during an `await` this method is
  // suspended on — so `stopped` genuinely can change between one check and
  // the next even though nothing in this method's own textual body assigns
  // it. TypeScript's control-flow narrowing can't see that (it only tracks
  // mutations reachable from this function's own code) and flags a repeated
  // check as always-false; reading through a function call is opaque to that
  // narrowing while still observing the live value.
  private isStopped(): boolean {
    return this.stopped;
  }

  /**
   * Start watching for file system changes. On Tauri, starts (or confirms)
   * the native Rust watcher for `rootPath` and subscribes to its
   * `workspace-file-changed` event (no polling). In the browser, falls back
   * to a slow poll+diff against `getFileTreeSnapshot`.
   */
  async start(rootPath: string, getFileTreeSnapshot: () => Promise<string>): Promise<void> {
    if (this.started) {
      console.warn('FileSystemWatcher already started');
      return;
    }
    this.started = true;
    this.stopped = false;

    if (isTauriEnvironment()) {
      await this.startEventDriven(rootPath, getFileTreeSnapshot);
    } else {
      this.startPolling(getFileTreeSnapshot);
    }
  }

  private async startEventDriven(
    rootPath: string,
    getFileTreeSnapshot: () => Promise<string>,
  ): Promise<void> {
    try {
      // Subscribe BEFORE starting the native watcher. Tauri's event bus does
      // not buffer or replay events for late subscribers — if `watchWorkspace`
      // ran first, any file change landing in the gap between it resolving
      // (the Rust watcher is now live and emitting) and `listen()` finishing
      // its own IPC round trip would be emitted to no one and silently lost,
      // with no poll fallback in event mode to eventually catch it back up.
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<{ path: string }>('workspace-file-changed', (event) => {
        // stop() may have already run (e.g. workspace switched) by the time a
        // queued event reaches us — never schedule a refresh once stopped.
        if (this.isStopped()) return;
        const path = event.payload.path;
        // Never let internal app-data churn (e.g. the MCP session-scope
        // heartbeat) trigger a full tree refresh — that would reintroduce
        // the exact poll-storm this class exists to prevent, just retriggered
        // by internal writes instead of a timer.
        if (path && isInternalWorkspacePath(path)) return;
        this.scheduleDebouncedRefresh();
      });
      if (this.isStopped()) {
        // stop() was called while listen() was still resolving — tear the
        // subscription down immediately instead of leaking it.
        unlisten();
        return;
      }

      // Now start (or confirm) the native watcher ourselves — never rely on
      // some OTHER part of the app (e.g. the RAG wiring) having already
      // called `watchWorkspace` for this path. If that other caller's setup
      // sequence throws before reaching its own `watchWorkspace` call, this
      // watcher would otherwise be marked "started" while no Rust watcher is
      // actually running, so no `workspace-file-changed` event could ever
      // arrive and external changes would silently stop appearing.
      try {
        await watchWorkspace(rootPath);
      } catch (watchError) {
        unlisten(); // no native watcher will ever feed this subscription
        throw watchError;
      }
      if (this.isStopped()) {
        unlisten();
        return;
      }

      this.unlisten = unlisten;
      this.mode = 'events';
      console.log('FileSystemWatcher: subscribed to workspace-file-changed events');

      // Catch-up refresh: a change could have landed on disk in the gap
      // between the last tree load and the native watcher actually becoming
      // active (e.g. during workspace open, or between an old workspace's
      // watcher being torn down and this one taking over) — the Rust watcher
      // wasn't watching yet, so no event was ever emitted for it. Event mode
      // has no periodic rescan to eventually self-correct that (unlike the
      // old poll+diff path), so schedule one same as a real event would: it
      // goes through the normal debounce/coalescing/overlap-guard path, so it
      // merges for free with any real event arriving in the same window
      // instead of firing a redundant extra scan.
      this.scheduleDebouncedRefresh();

      // QA-75: start the self-heal keepalive (see the class doc comment).
      this.startKeepAlive(rootPath, getFileTreeSnapshot);
    } catch (error) {
      console.error(
        'FileSystemWatcher: failed to start the native watcher, falling back to polling:',
        error,
      );
      // Never leave the watcher inert: if the native watcher couldn't be
      // (re)started, the slow poll fallback still keeps the tree eventually
      // consistent instead of silently stopping updates altogether.
      if (!this.stopped) {
        this.startPolling(getFileTreeSnapshot);
      }
    }
  }

  /**
   * QA-75: start the low-frequency self-heal loop for event mode. Every
   * `keepAliveIntervalMs`, re-arms the native watcher and runs a backstop
   * snapshot diff so a native watcher that went silently deaf gets caught
   * (and the tree brought current) without waiting for a restart.
   */
  private startKeepAlive(rootPath: string, getFileTreeSnapshot: () => Promise<string>): void {
    if (this.keepAliveTimer) return;
    // Seed the baseline immediately, same as the poll fallback's initial
    // snapshot (see startPolling) — without this, the first keepalive tick
    // has nothing to diff against and can never detect a change.
    void getFileTreeSnapshot()
      .then((snapshot) => {
        if (this.isStopped()) return;
        this.keepAliveSnapshot = snapshot;
      })
      .catch(() => {
        // Best-effort: leave it null; the first tick's own fetch seeds it.
      });
    this.keepAliveTimer = setInterval(() => {
      void this.runKeepAliveCheck(rootPath, getFileTreeSnapshot);
    }, this.keepAliveIntervalMs);
  }

  private async runKeepAliveCheck(
    rootPath: string,
    getFileTreeSnapshot: () => Promise<string>,
  ): Promise<void> {
    if (this.isStopped() || this.mode !== 'events') return;

    // Re-arm is a cheap, idempotent IPC call — the Rust side just replaces
    // its singleton watcher for the same path (src-tauri/src/commands/
    // watcher.rs). Doing this periodically recovers from ANY silent native
    // failure (queue overflow, a stale OS handle, a panicked callback
    // thread) without needing to diagnose which one actually happened.
    try {
      await watchWorkspace(rootPath);
    } catch (err) {
      console.error('FileSystemWatcher: keepalive re-arm failed:', err);
    }
    if (this.isStopped()) return;

    // Backstop: diff a fresh scan against the last keepalive snapshot so a
    // change missed while the native watcher was silently dead still
    // surfaces, closing the gap within one keepalive interval instead of
    // leaving the tree stale for the rest of the session.
    try {
      const snapshot = await getFileTreeSnapshot();
      if (this.isStopped()) return;
      const changed = this.keepAliveSnapshot !== null && snapshot !== this.keepAliveSnapshot;
      this.keepAliveSnapshot = snapshot;
      if (changed) {
        // Refresh immediately — this is a backstop for a change already
        // missed, not a burst of live events to coalesce, so there is
        // nothing to gain by routing it through the debounce delay.
        void this.runRefresh();
      }
    } catch (err) {
      console.error('FileSystemWatcher: keepalive snapshot check failed:', err);
    }
  }

  private scheduleDebouncedRefresh(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.flushDebouncedRefresh();
    }, this.debounceMs);

    // Start the max-wait ceiling on the FIRST event of a burst; it is not
    // reset by subsequent events, so a sustained burst still refreshes
    // periodically instead of deferring forever.
    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => {
        this.flushDebouncedRefresh();
      }, this.maxWaitMs);
    }
  }

  private flushDebouncedRefresh(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
    void this.runRefresh();
  }

  /**
   * Serialized entry point for an event-driven refresh. A full workspace
   * scan (`getFileTree({ fresh: true })`) can take longer than the debounce
   * window on a large tree; without this guard, a fresh burst of events
   * arriving mid-scan would fire a SECOND overlapping scan, recreating the
   * exact concurrent-full-walk storm this class exists to prevent. Any event
   * that arrives while a refresh is in flight is remembered (`refreshAgain`)
   * and turned into exactly one more refresh once the current one finishes.
   */
  private async runRefresh(): Promise<void> {
    if (this.isRefreshing) {
      this.refreshAgain = true;
      return;
    }
    this.isRefreshing = true;
    try {
      if (this.onFileTreeChange) {
        await this.onFileTreeChange();
      }
    } finally {
      this.isRefreshing = false;
      if (this.refreshAgain) {
        this.refreshAgain = false;
        void this.runRefresh();
      }
    }
  }

  private startPolling(getFileTreeSnapshot: () => Promise<string>): void {
    this.mode = 'poll';
    console.log(`FileSystemWatcher: no OS file-change events available, polling every ${String(this.pollInterval)}ms`);

    // Initial snapshot.
    void getFileTreeSnapshot().then((snapshot) => {
      this.lastFileTreeSnapshot = snapshot;
    });

    this.intervalId = window.setInterval(() => {
      void (async () => {
        if (this.isPolling) return; // skip if previous poll is still running
        this.isPolling = true;
        try {
          const currentSnapshot = await getFileTreeSnapshot();
          if (this.lastFileTreeSnapshot !== null && currentSnapshot !== this.lastFileTreeSnapshot) {
            console.log('FileSystemWatcher: File tree change detected');
            this.lastFileTreeSnapshot = currentSnapshot;
            if (this.onFileTreeChange) {
              await this.onFileTreeChange();
            }
          } else if (this.lastFileTreeSnapshot === null) {
            this.lastFileTreeSnapshot = currentSnapshot;
          }
        } catch (error) {
          console.error('FileSystemWatcher: Error during poll:', error);
        } finally {
          this.isPolling = false;
        }
      })();
    }, this.pollInterval);
  }

  /**
   * Stop watching for file system changes.
   */
  stop(): void {
    this.stopped = true;
    this.started = false;

    if (this.unlisten) {
      this.unlisten();
      this.unlisten = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    this.keepAliveSnapshot = null;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.mode !== null) {
      console.log('FileSystemWatcher stopped');
    }
    this.mode = null;
    this.lastFileTreeSnapshot = null;
    // A refresh already in flight is left to finish on its own (its `finally`
    // just becomes a no-op re-check); this only prevents a QUEUED one from
    // firing after teardown.
    this.refreshAgain = false;
  }

  /**
   * Update the change callback.
   */
  setOnFileTreeChange(callback: () => void | Promise<void>): void {
    this.onFileTreeChange = callback;
  }

  /**
   * Check if the watcher is currently active (either subscribed to native
   * events or polling).
   */
  isActive(): boolean {
    return this.mode !== null;
  }

  /**
   * Record the current file tree as the baseline snapshot so a subsequent
   * poll doesn't treat an in-app write as an external change. Only meaningful
   * in browser poll mode — event-driven (Tauri) mode has no snapshot to
   * update, so this is a no-op there.
   */
  async updateSnapshot(getFileTreeSnapshot: () => Promise<string>): Promise<void> {
    if (this.mode !== 'poll') return;
    try {
      this.lastFileTreeSnapshot = await getFileTreeSnapshot();
    } catch (error) {
      console.error('FileSystemWatcher: Error updating snapshot:', error);
    }
  }
}

/**
 * Create a file tree snapshot for comparison
 * This generates a string representation of the file tree structure
 */
export function createFileTreeSnapshot(fileTree: any[]): string {
  const sortedTree = JSON.stringify(fileTree, (_key, value) => {
    // Sort arrays to ensure consistent ordering
    if (Array.isArray(value)) {
      return value.slice().sort((a, b) => {
        if (typeof a === 'object' && typeof b === 'object' && a.path && b.path) {
          return a.path.localeCompare(b.path);
        }
        return 0;
      });
    }
    return value;
  });

  return sortedTree;
}

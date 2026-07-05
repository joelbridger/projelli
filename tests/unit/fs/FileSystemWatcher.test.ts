/**
 * fix/watcher-event-driven — the idle-poll bug: with the app fully idle, the
 * old FileSystemWatcher did a full recursive workspace walk every 3s forever
 * (bench: 26,257 `list()` calls in 5 minutes on a 2,500-file workspace). On
 * Tauri, the Rust backend already runs a native `notify`-crate watcher and
 * emits a `workspace-file-changed` event per real change — this watcher must
 * subscribe to that instead of polling. Only the browser fallback (no OS
 * file-change events available there) still polls, at a much longer interval.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WORKSPACE_DATA_DIR } from '@/config/identity';

const listenMock = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

const watchWorkspaceMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/platform/utils/tauri-commands', () => ({
  watchWorkspace: (...args: unknown[]) => watchWorkspaceMock(...args),
}));

async function importWatcher() {
  const mod = await import('@/platform/fs/FileSystemWatcher');
  return mod;
}

function setTauri(enabled: boolean) {
  const w = window as unknown as { __TAURI__?: unknown };
  if (enabled) {
    w.__TAURI__ = {};
  } else {
    delete w.__TAURI__;
  }
}

describe('FileSystemWatcher — Tauri (event-driven)', () => {
  let unlisten: ReturnType<typeof vi.fn>;
  let emit: (payload: { path: string; kind: string }) => void;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    setTauri(true);
    unlisten = vi.fn();
    listenMock.mockReset();
    listenMock.mockImplementation((_event: string, handler: (e: { payload: unknown }) => void) => {
      emit = (payload) => handler({ payload });
      return Promise.resolve(unlisten);
    });
    watchWorkspaceMock.mockReset();
    watchWorkspaceMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    setTauri(false);
  });

  it('subscribes to workspace-file-changed instead of hot-polling (only the QA-75 low-frequency keepalive uses setInterval)', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const { FileSystemWatcher } = await importWatcher();
    const watcher = new FileSystemWatcher({ onFileTreeChange: vi.fn() });

    await watcher.start('/ws', async () => '');
    await vi.runOnlyPendingTimersAsync();

    expect(listenMock).toHaveBeenCalledWith('workspace-file-changed', expect.any(Function));
    // Exactly one interval: the QA-75 self-heal keepalive, at a low
    // frequency — NOT the old always-on hot poll this class was built to
    // replace (see the class doc comment).
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const interval = setIntervalSpy.mock.calls[0]?.[1];
    expect(interval as number).toBeGreaterThanOrEqual(30_000);
    expect(watcher.isActive()).toBe(true);
  });

  it('starts the native Rust watcher itself — never assumes some other caller already did', async () => {
    const { FileSystemWatcher } = await importWatcher();
    const watcher = new FileSystemWatcher({ onFileTreeChange: vi.fn() });

    await watcher.start('/ws/Acme', async () => '');

    expect(watchWorkspaceMock).toHaveBeenCalledWith('/ws/Acme');
  });

  it('subscribes BEFORE starting the native watcher, so no change lands in an unsubscribed gap', async () => {
    const { FileSystemWatcher } = await importWatcher();
    const watcher = new FileSystemWatcher({ onFileTreeChange: vi.fn() });

    await watcher.start('/ws/Acme', async () => '');

    // Tauri's event bus does not replay events to late subscribers, so
    // `listen()` must resolve before `watchWorkspace` makes the native
    // watcher start emitting — otherwise a change in that gap is lost.
    const listenOrder = listenMock.mock.invocationCallOrder[0];
    const watchOrder = watchWorkspaceMock.mock.invocationCallOrder[0];
    expect(listenOrder).toBeDefined();
    expect(watchOrder).toBeDefined();
    expect(listenOrder as number).toBeLessThan(watchOrder as number);
  });

  it('falls back to polling if the native watcher fails to start (never left inert)', async () => {
    watchWorkspaceMock.mockRejectedValueOnce(new Error('watch target does not exist'));
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const { FileSystemWatcher } = await importWatcher();
    const onFileTreeChange = vi.fn();
    const watcher = new FileSystemWatcher({ onFileTreeChange, pollInterval: 1000 });

    let snapshot = 'v1';
    await watcher.start('/ws/Acme', async () => snapshot);

    // The subscription is registered before the native watcher is asked to
    // start (see the ordering test above) — since starting it failed, that
    // now-useless subscription must be torn down, not leaked.
    expect(unlisten).toHaveBeenCalledTimes(1);
    // Never silently inert: falls back to the poll path instead of just
    // sitting on a subscription that can now never receive an event.
    expect(setIntervalSpy).toHaveBeenCalled();
    expect(watcher.isActive()).toBe(true);

    snapshot = 'v2';
    await vi.advanceTimersByTimeAsync(1000);
    expect(onFileTreeChange).toHaveBeenCalledTimes(1);

    watcher.stop();
  });

  it('never overlaps two event-driven refreshes; a mid-refresh burst runs exactly once more after', async () => {
    let resolveRefresh: () => void = () => {};
    const onFileTreeChange = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const { FileSystemWatcher } = await importWatcher();
    const watcher = new FileSystemWatcher({ onFileTreeChange, debounceMs: 100 });
    await watcher.start('/ws', async () => '');

    emit({ path: '/ws/Clients/a.docx', kind: 'modify' });
    await vi.advanceTimersByTimeAsync(100);
    expect(onFileTreeChange).toHaveBeenCalledTimes(1); // refresh #1 now in flight, never resolves yet

    // A fresh burst arrives WHILE the scan above is still running.
    emit({ path: '/ws/Clients/b.docx', kind: 'modify' });
    await vi.advanceTimersByTimeAsync(100);
    // Must NOT have started a second, overlapping scan.
    expect(onFileTreeChange).toHaveBeenCalledTimes(1);

    // Refresh #1 finishes -> the queued burst runs as exactly one more refresh.
    resolveRefresh();
    // Flush microtasks (the `finally` -> `runRefresh()` re-entry chain) without
    // relying on any timer — fake timers don't advance plain Promise chains.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(onFileTreeChange).toHaveBeenCalledTimes(2);
  });

  it('coalesces a burst of distinct-path events into a single refresh', async () => {
    const onFileTreeChange = vi.fn();
    const { FileSystemWatcher } = await importWatcher();
    const watcher = new FileSystemWatcher({ onFileTreeChange, debounceMs: 500, maxWaitMs: 5000 });

    await watcher.start('/ws', async () => '');

    // A 100-file sync: many distinct paths, arriving in a tight burst.
    for (let i = 0; i < 100; i += 1) {
      emit({ path: `/ws/Clients/file-${i}.docx`, kind: 'create' });
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(onFileTreeChange).not.toHaveBeenCalled();

    // Quiet period elapses -> exactly one refresh.
    await vi.advanceTimersByTimeAsync(500);
    expect(onFileTreeChange).toHaveBeenCalledTimes(1);
  });

  it('does a catch-up refresh right after activation, so a change in the gap before the watcher started is not missed', async () => {
    const onFileTreeChange = vi.fn();
    const { FileSystemWatcher } = await importWatcher();
    const watcher = new FileSystemWatcher({ onFileTreeChange, debounceMs: 200 });

    // No `emit()` at all — this simulates a file changing on disk in the
    // window between the last tree load and the native watcher actually
    // becoming active (e.g. during workspace open). The Rust watcher wasn't
    // watching yet, so that change never generated a `workspace-file-changed`
    // event, and event mode has no periodic poll to eventually self-correct
    // it — activation itself must trigger one refresh so the change isn't
    // stale forever.
    await watcher.start('/ws', async () => '');
    await vi.advanceTimersByTimeAsync(200);

    expect(onFileTreeChange).toHaveBeenCalledTimes(1);
  });

  it('the catch-up refresh also fires after a workspace switch (a new watcher instance re-subscribing)', async () => {
    const { FileSystemWatcher } = await importWatcher();

    const onFileTreeChangeA = vi.fn();
    const watcherA = new FileSystemWatcher({ onFileTreeChange: onFileTreeChangeA, debounceMs: 200 });
    await watcherA.start('/ws/A', async () => '');
    await vi.advanceTimersByTimeAsync(200);
    expect(onFileTreeChangeA).toHaveBeenCalledTimes(1);
    watcherA.stop();

    // Simulates switching to a different workspace: a fresh watcher instance
    // re-subscribes and re-activates the native watcher for the new root.
    const onFileTreeChangeB = vi.fn();
    const watcherB = new FileSystemWatcher({ onFileTreeChange: onFileTreeChangeB, debounceMs: 200 });
    await watcherB.start('/ws/B', async () => '');
    await vi.advanceTimersByTimeAsync(200);
    expect(onFileTreeChangeB).toHaveBeenCalledTimes(1);
  });

  it('never fires for internal workspace-data-dir churn (e.g. the MCP heartbeat file)', async () => {
    const onFileTreeChange = vi.fn();
    const { FileSystemWatcher } = await importWatcher();
    const watcher = new FileSystemWatcher({ onFileTreeChange, debounceMs: 200 });
    await watcher.start('/ws', async () => '');

    // Let the post-activation catch-up refresh settle first so it isn't
    // mistaken for a refresh triggered by the internal-path event below.
    await vi.advanceTimersByTimeAsync(200);
    onFileTreeChange.mockClear();

    emit({ path: `/ws/${WORKSPACE_DATA_DIR}/mcp-session-scope.json`, kind: 'modify' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(onFileTreeChange).not.toHaveBeenCalled();
  });

  it('a real external change still refreshes the tree', async () => {
    const onFileTreeChange = vi.fn();
    const { FileSystemWatcher } = await importWatcher();
    const watcher = new FileSystemWatcher({ onFileTreeChange, debounceMs: 200 });
    await watcher.start('/ws', async () => '');

    emit({ path: '/ws/Clients/Webb/statement.pdf', kind: 'create' });
    await vi.advanceTimersByTimeAsync(200);

    expect(onFileTreeChange).toHaveBeenCalledTimes(1);
  });

  it('bounds a sustained event stream to periodic refreshes via maxWaitMs', async () => {
    const onFileTreeChange = vi.fn();
    const { FileSystemWatcher } = await importWatcher();
    const watcher = new FileSystemWatcher({ onFileTreeChange, debounceMs: 500, maxWaitMs: 2000 });
    await watcher.start('/ws', async () => '');

    // Continuous churn every 300ms — always inside the 500ms trailing
    // debounce window, so it would defer forever without the max-wait cap.
    for (let i = 0; i < 10; i += 1) {
      emit({ path: `/ws/Clients/churn-${i % 3}.docx`, kind: 'modify' });
      await vi.advanceTimersByTimeAsync(300);
    }

    expect(onFileTreeChange.mock.calls.length).toBeGreaterThan(0);
  });

  it('stop() unsubscribes the native listener', async () => {
    const onFileTreeChange = vi.fn();
    const { FileSystemWatcher } = await importWatcher();
    const watcher = new FileSystemWatcher({ onFileTreeChange, debounceMs: 100 });
    await watcher.start('/ws', async () => '');

    watcher.stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(watcher.isActive()).toBe(false);

    // Emitting after stop must not schedule/queue a refresh.
    emit({ path: '/ws/Clients/after-stop.docx', kind: 'create' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onFileTreeChange).not.toHaveBeenCalled();
  });

  it('stop() called before listen() resolves does not leak the subscription', async () => {
    vi.useRealTimers();
    let resolveListen: (fn: () => void) => void = () => {};
    listenMock.mockReset();
    listenMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveListen = resolve as (fn: () => void) => void;
        }),
    );

    const { FileSystemWatcher } = await importWatcher();
    const watcher = new FileSystemWatcher({ onFileTreeChange: vi.fn() });
    const startPromise = watcher.start('/ws', async () => '');

    // Wait until `listen()` has actually been CALLED (so its returned promise
    // exists and `resolveListen` is wired up) but has not yet resolved — the
    // exact window `stop()` needs to race against.
    while (listenMock.mock.calls.length === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }

    watcher.stop();
    resolveListen(unlisten as unknown as () => void);
    await startPromise;

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(watcher.isActive()).toBe(false);
  });

  it('updateSnapshot() is a no-op in event-driven mode (nothing to poll-diff)', async () => {
    const { FileSystemWatcher } = await importWatcher();
    const watcher = new FileSystemWatcher({ onFileTreeChange: vi.fn() });
    await watcher.start('/ws', async () => '');

    const snapshotFn = vi.fn().mockResolvedValue('some-snapshot');
    await watcher.updateSnapshot(snapshotFn);
    expect(snapshotFn).not.toHaveBeenCalled();
  });

  // QA-75: the native watcher can silently stop delivering events partway
  // through a live session (an inotify queue overflow, a Windows
  // ReadDirectoryChangesW handle going stale, a panicked notify callback
  // thread — see src-tauri/src/commands/watcher.rs) without the Rust process
  // crashing or throwing anything JS-visible. Before this fix, event mode
  // installed the watcher exactly once per workspace mount and then trusted
  // it forever — only a full app restart (a fresh process, fresh watcher)
  // ever recovered. These tests prove a low-frequency keepalive re-arms the
  // native watcher and self-heals via a backstop snapshot diff, so an
  // external change that lands while the native watcher is silently dead
  // still surfaces within one keepalive interval.
  describe('keepalive self-heal (QA-75)', () => {
    it('periodically re-arms the native watcher for the life of the session', async () => {
      const { FileSystemWatcher } = await importWatcher();
      const watcher = new FileSystemWatcher({ onFileTreeChange: vi.fn(), keepAliveIntervalMs: 5000 });

      await watcher.start('/ws/Acme', async () => 'v1');
      expect(watchWorkspaceMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5000);
      expect(watchWorkspaceMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(watchWorkspaceMock).toHaveBeenLastCalledWith('/ws/Acme');

      await vi.advanceTimersByTimeAsync(5000);
      expect(watchWorkspaceMock.mock.calls.length).toBeGreaterThanOrEqual(3);

      watcher.stop();
    });

    it('self-heals a missed external file add when the native watcher went silently deaf (no event ever fires)', async () => {
      const onFileTreeChange = vi.fn();
      const { FileSystemWatcher } = await importWatcher();
      const watcher = new FileSystemWatcher({ onFileTreeChange, keepAliveIntervalMs: 5000, debounceMs: 50 });

      let snapshot = 'v1';
      await watcher.start('/ws/Acme', async () => snapshot);
      // Let the post-activation catch-up refresh fully settle so it isn't
      // confused with the keepalive-triggered refresh under test.
      await vi.advanceTimersByTimeAsync(50);
      onFileTreeChange.mockClear();

      // A file is dropped in Explorer/Finder, but the native watcher is
      // silently dead — NO `emit()` call happens, simulating the exact
      // QA-75 repro (external drops that generate zero workspace-file-changed
      // events). The only way this can be caught is the keepalive backstop.
      snapshot = 'v2';

      await vi.advanceTimersByTimeAsync(5000);

      expect(onFileTreeChange).toHaveBeenCalledTimes(1);
    });

    it('keeps checking on the next tick even if a keepalive re-arm call fails', async () => {
      const onFileTreeChange = vi.fn();
      const { FileSystemWatcher } = await importWatcher();
      const watcher = new FileSystemWatcher({ onFileTreeChange, keepAliveIntervalMs: 5000, debounceMs: 50 });

      let snapshot = 'v1';
      await watcher.start('/ws/Acme', async () => snapshot);
      await vi.advanceTimersByTimeAsync(50);
      onFileTreeChange.mockClear();

      watchWorkspaceMock.mockRejectedValueOnce(new Error('transient IPC failure'));
      snapshot = 'v2';
      await vi.advanceTimersByTimeAsync(5000);

      // The re-arm call itself failed, but the backstop diff must still run
      // and catch the missed external change.
      expect(onFileTreeChange).toHaveBeenCalledTimes(1);
    });

    it('stop() clears the keepalive interval — no further re-arm or refresh calls', async () => {
      const onFileTreeChange = vi.fn();
      const { FileSystemWatcher } = await importWatcher();
      const watcher = new FileSystemWatcher({ onFileTreeChange, keepAliveIntervalMs: 5000, debounceMs: 50 });

      let snapshot = 'v1';
      await watcher.start('/ws/Acme', async () => snapshot);
      await vi.advanceTimersByTimeAsync(50);

      watcher.stop();
      const callsAtStop = watchWorkspaceMock.mock.calls.length;
      onFileTreeChange.mockClear();

      snapshot = 'v2';
      await vi.advanceTimersByTimeAsync(20000);

      expect(watchWorkspaceMock.mock.calls.length).toBe(callsAtStop);
      expect(onFileTreeChange).not.toHaveBeenCalled();
    });
  });
});

describe('FileSystemWatcher — browser fallback (poll)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    setTauri(false);
    listenMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back to polling (no native event subscription) when not on Tauri', async () => {
    const { FileSystemWatcher } = await importWatcher();
    const onFileTreeChange = vi.fn();
    const watcher = new FileSystemWatcher({ onFileTreeChange, pollInterval: 1000 });

    let snapshot = 'tree-v1';
    await watcher.start('/ws', async () => snapshot);
    expect(listenMock).not.toHaveBeenCalled();

    // No change yet.
    await vi.advanceTimersByTimeAsync(1000);
    expect(onFileTreeChange).not.toHaveBeenCalled();

    // External change shows up on the next poll.
    snapshot = 'tree-v2';
    await vi.advanceTimersByTimeAsync(1000);
    expect(onFileTreeChange).toHaveBeenCalledTimes(1);

    watcher.stop();
  });

  it('defaults to a long poll interval, not the old 3s hot loop', async () => {
    const { FileSystemWatcher } = await importWatcher();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const watcher = new FileSystemWatcher({ onFileTreeChange: vi.fn() });

    await watcher.start('/ws', async () => '');

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));
    const call = setIntervalSpy.mock.calls[0];
    expect(call).toBeDefined();
    const interval = call?.[1];
    expect(interval as number).toBeGreaterThanOrEqual(10_000);

    watcher.stop();
  });

  it('updateSnapshot() updates the poll baseline so an in-app write is not treated as external', async () => {
    const { FileSystemWatcher, createFileTreeSnapshot } = await importWatcher();
    const onFileTreeChange = vi.fn();
    const watcher = new FileSystemWatcher({ onFileTreeChange, pollInterval: 1000 });

    let snapshot = createFileTreeSnapshot([{ path: 'a.txt', name: 'a.txt', type: 'file' }]);
    await watcher.start('/ws', async () => snapshot);

    const newSnapshot = createFileTreeSnapshot([
      { path: 'a.txt', name: 'a.txt', type: 'file' },
      { path: 'b.txt', name: 'b.txt', type: 'file' },
    ]);
    // Simulate an in-app write: update the baseline directly, as
    // useFileOperations does after a WorkspaceService write/refresh.
    await watcher.updateSnapshot(async () => newSnapshot);
    snapshot = newSnapshot;

    await vi.advanceTimersByTimeAsync(1000);
    expect(onFileTreeChange).not.toHaveBeenCalled();

    watcher.stop();
  });

  it('stop() clears the poll interval', async () => {
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const { FileSystemWatcher } = await importWatcher();
    const watcher = new FileSystemWatcher({ onFileTreeChange: vi.fn(), pollInterval: 1000 });
    await watcher.start('/ws', async () => '');

    watcher.stop();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(watcher.isActive()).toBe(false);
  });
});

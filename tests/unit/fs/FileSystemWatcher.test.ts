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

  it('subscribes to workspace-file-changed instead of polling — no setInterval', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const { FileSystemWatcher } = await importWatcher();
    const watcher = new FileSystemWatcher({ onFileTreeChange: vi.fn() });

    await watcher.start('/ws', async () => '');
    await vi.runOnlyPendingTimersAsync();

    expect(listenMock).toHaveBeenCalledWith('workspace-file-changed', expect.any(Function));
    expect(setIntervalSpy).not.toHaveBeenCalled();
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

  it('never fires for internal workspace-data-dir churn (e.g. the MCP heartbeat file)', async () => {
    const onFileTreeChange = vi.fn();
    const { FileSystemWatcher } = await importWatcher();
    const watcher = new FileSystemWatcher({ onFileTreeChange, debounceMs: 200 });
    await watcher.start('/ws', async () => '');

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

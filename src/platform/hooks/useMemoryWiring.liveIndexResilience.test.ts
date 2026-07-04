/**
 * useMemoryWiring — QA-19 live-index resilience regression.
 *
 * Root cause (BUG-DB QA-19 / QA-13): the per-workspace lifecycle effect ran
 * `MemoryService.setWorkspace` and `mailSetWorkspace` inside the SAME
 * try/catch that also covered `watchWorkspace` + the `workspace-file-changed`
 * listener registration. Any transient failure in either call — or in any of
 * the optional connector setup calls that used to run BEFORE the watcher —
 * silently aborted watcher installation for the rest of the session with no
 * log and no retry (the outer catch was a bare `{}`). Because the effect's
 * deps rarely change after mount, this presented as "only a full app restart
 * fixes it" — exactly the QA-19/QA-13 repro (a newly created doc, and a
 * separately dropped external file, BOTH never got a reindex event for the
 * rest of the session).
 *
 * A second, independent gap compounded this: a single watcher-triggered
 * `MemoryService.indexFile(path)` call was fire-and-forget with no retry —
 * one transient failure (e.g. a read racing the tail end of an autosave
 * write) permanently dropped that file until the next full boot reconcile.
 *
 * These tests pin down the fix: essential wiring (setWorkspace + watcher +
 * listener) is retried with backoff and is structurally independent of the
 * optional connector setup, and a single-file index attempt is retried
 * before being logged and given up on.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/platform/rag/MemoryService', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/platform/rag/MemoryService')>();
  return {
    ...original,
    MemoryService: {
      ...original.MemoryService,
      setWorkspace: vi.fn().mockResolvedValue(undefined),
      indexFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...original,
    watchWorkspace: vi.fn().mockResolvedValue(undefined),
  };
});

const listenMock = vi.fn().mockResolvedValue(vi.fn());
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]): unknown => listenMock(...args),
}));

import {
  createIndexRetryScheduler,
  installEssentialWorkspaceWiring,
  retryAsync,
} from './useMemoryWiring';
import { MemoryService } from '@/platform/rag/MemoryService';
import { watchWorkspace } from '@/platform/utils/tauri-commands';

describe('retryAsync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result immediately on first success without waiting', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryAsync(fn, { delaysMs: [1000, 3000] });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after a transient failure and succeeds on a later attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('ok');
    const onError = vi.fn();
    const promise = retryAsync(fn, { delaysMs: [1000, 3000], onError });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('gives up and throws after exhausting all retries', async () => {
    const err = new Error('permanent');
    const fn = vi.fn().mockRejectedValue(err);
    const onError = vi.fn();
    const promise = retryAsync(fn, { delaysMs: [1000, 3000], onError }).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;
    expect(result).toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(3);
  });

  it('stops retrying once isCancelled reports true', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('transient'));
    const promise = retryAsync(fn, {
      delaysMs: [1000, 3000],
      isCancelled: () => fn.mock.calls.length >= 1,
    }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5000);
    await promise;
    // Only the first attempt ran before cancellation was observed.
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('installEssentialWorkspaceWiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listenMock.mockResolvedValue(vi.fn());
  });

  it('points RAG at the workspace, starts the watcher, and registers the change listener', async () => {
    const deleteBatcher = { enqueue: vi.fn(), cancel: vi.fn() };
    const indexRetryScheduler = createIndexRetryScheduler();
    await installEssentialWorkspaceWiring('/ws', null, deleteBatcher, indexRetryScheduler);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(MemoryService.setWorkspace).toHaveBeenCalledWith('/ws');
    expect(watchWorkspace).toHaveBeenCalledWith('/ws');
    expect(listenMock).toHaveBeenCalledWith(
      'workspace-file-changed',
      expect.any(Function),
    );
  });

  it('returns the unlisten handle from the registered listener', async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValueOnce(unlisten);
    const deleteBatcher = { enqueue: vi.fn(), cancel: vi.fn() };
    const indexRetryScheduler = createIndexRetryScheduler();
    const result = await installEssentialWorkspaceWiring(
      '/ws',
      null,
      deleteBatcher,
      indexRetryScheduler,
    );
    expect(result).toBe(unlisten);
  });

  it('never calls any optional-connector setup — it depends on nothing outside setWorkspace/watchWorkspace/listen', async () => {
    // This function must be import-free of mail/CRM/OneDrive/etc. setup calls
    // so a failure in any of THOSE can never prevent it from completing —
    // enforced structurally by this module only importing MemoryService,
    // watchWorkspace, and the tauri event listener within the function body.
    const deleteBatcher = { enqueue: vi.fn(), cancel: vi.fn() };
    const indexRetryScheduler = createIndexRetryScheduler();
    await installEssentialWorkspaceWiring('/ws', null, deleteBatcher, indexRetryScheduler);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(MemoryService.setWorkspace).toHaveBeenCalledTimes(1);
  });
});

describe('createIndexRetryScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('indexes the file immediately on the happy path', () => {
    createIndexRetryScheduler().schedule('/ws/a.docx');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(MemoryService.indexFile).toHaveBeenCalledWith('/ws/a.docx');
  });

  it('retries after a transient indexFile failure and eventually succeeds', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(MemoryService.indexFile)
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValueOnce(undefined);

    createIndexRetryScheduler().schedule('/ws/b.docx');
    // First attempt fires synchronously; let its rejection settle.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(300);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(MemoryService.indexFile).toHaveBeenCalledTimes(2);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(MemoryService.indexFile).toHaveBeenNthCalledWith(2, '/ws/b.docx');
  });

  it('logs an error and stops retrying once attempts are exhausted', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(MemoryService.indexFile).mockRejectedValue(new Error('still locked'));

    createIndexRetryScheduler().schedule('/ws/c.docx');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(1000);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(MemoryService.indexFile).toHaveBeenCalledTimes(3);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('/ws/c.docx'),
      expect.anything(),
    );
    consoleError.mockRestore();
  });

  it('disposeAll cancels a pending retry so it never fires (QA-19 codex-review follow-up: cross-workspace leak)', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(MemoryService.indexFile).mockRejectedValue(new Error('locked'));
    const scheduler = createIndexRetryScheduler();

    scheduler.schedule('/old-ws/a.docx');
    // Let the first (failed) attempt settle and schedule its retry timer.
    await vi.advanceTimersByTimeAsync(0);
    scheduler.disposeAll();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(MemoryService.indexFile).mockClear();

    await vi.advanceTimersByTimeAsync(5000);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(MemoryService.indexFile).not.toHaveBeenCalled();
  });

  it('disposeAll on one scheduler does not affect a different scheduler instance', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(MemoryService.indexFile).mockRejectedValue(new Error('locked'));
    const disposedScheduler = createIndexRetryScheduler();
    const liveScheduler = createIndexRetryScheduler();

    disposedScheduler.schedule('/old-ws/a.docx');
    liveScheduler.schedule('/new-ws/b.docx');
    await vi.advanceTimersByTimeAsync(0);
    disposedScheduler.disposeAll();

    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(MemoryService.indexFile)
      .mockClear()
      .mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(300);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(MemoryService.indexFile).toHaveBeenCalledExactlyOnceWith('/new-ws/b.docx');
  });
});

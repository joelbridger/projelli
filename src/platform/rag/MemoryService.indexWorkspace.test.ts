import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcileWorkspace, setWorkspaceNative } = vi.hoisted(() => ({
  reconcileWorkspace: vi.fn<() => Promise<void>>(),
  setWorkspaceNative: vi.fn<(path: string) => Promise<number>>().mockResolvedValue(1),
}));

vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...original,
    ragReconcileWorkspace: reconcileWorkspace,
    ragSetWorkspace: setWorkspaceNative,
  };
});

import { MemoryService } from '@/platform/rag/MemoryService';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('MemoryService.indexWorkspace startup coalescing', () => {
  beforeEach(() => {
    reconcileWorkspace.mockReset();
    setWorkspaceNative.mockClear();
  });

  it('makes every overlapping caller wait for the same durable reconcile', async () => {
    await MemoryService.setWorkspace('/workspace/same');
    const run = deferred();
    reconcileWorkspace.mockReturnValue(run.promise);
    let secondFinished = false;

    const first = MemoryService.indexWorkspace();
    const second = MemoryService.indexWorkspace().then(() => {
      secondFinished = true;
    });
    await Promise.resolve();

    expect(reconcileWorkspace).toHaveBeenCalledTimes(1);
    expect(secondFinished).toBe(false);

    run.resolve();
    await Promise.all([first, second]);
    expect(secondFinished).toBe(true);
  });

  it('queues a fresh reconcile when a different workspace opens mid-run', async () => {
    const firstRun = deferred();
    const secondRun = deferred();
    reconcileWorkspace
      .mockReturnValueOnce(firstRun.promise)
      .mockReturnValueOnce(secondRun.promise);

    await MemoryService.setWorkspace('/workspace/A');
    const first = MemoryService.indexWorkspace();
    await MemoryService.setWorkspace('/workspace/B');
    let secondFinished = false;
    const second = MemoryService.indexWorkspace().then(() => {
      secondFinished = true;
    });
    await Promise.resolve();

    expect(reconcileWorkspace).toHaveBeenCalledTimes(1);
    firstRun.resolve();
    await first;
    await vi.waitFor(() => {
      expect(reconcileWorkspace).toHaveBeenCalledTimes(2);
    });
    expect(secondFinished).toBe(false);

    secondRun.resolve();
    await second;
    expect(secondFinished).toBe(true);
  });

  it('runs a fresh reconcile after switching away and back during an old run', async () => {
    const oldRun = deferred();
    const freshRun = deferred();
    reconcileWorkspace
      .mockReturnValueOnce(oldRun.promise)
      .mockReturnValueOnce(freshRun.promise);

    await MemoryService.setWorkspace('/workspace/A');
    const oldA = MemoryService.indexWorkspace();
    await MemoryService.setWorkspace('/workspace/B');
    await MemoryService.setWorkspace('/workspace/A');
    let freshFinished = false;
    const freshA = MemoryService.indexWorkspace().then(() => {
      freshFinished = true;
    });
    await Promise.resolve();

    expect(reconcileWorkspace).toHaveBeenCalledTimes(1);
    oldRun.resolve();
    await oldA;
    await vi.waitFor(() => {
      expect(reconcileWorkspace).toHaveBeenCalledTimes(2);
    });
    expect(freshFinished).toBe(false);

    freshRun.resolve();
    await freshA;
    expect(freshFinished).toBe(true);
  });
});

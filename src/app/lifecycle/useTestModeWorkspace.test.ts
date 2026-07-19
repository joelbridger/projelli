import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import {
  createTestModeWorkspaceMock,
  TEST_MODE_WORKSPACE_SERVICE_METHOD_NAMES,
  type TestModeWorkspaceService,
  useTestModeWorkspace,
} from './useTestModeWorkspace';

const originalUrl = window.location.href;

afterEach(() => {
  window.history.replaceState({}, '', originalUrl);
});

describe('test-mode workspace mock', () => {
  it('implements every public WorkspaceService member', async () => {
    // This is intentionally a type-level assertion. The factory itself uses
    // `satisfies TestModeWorkspaceService`; because that type is derived from
    // `keyof WorkspaceService`, removing or adding any public service method
    // makes this unit test fail to type-check before browser tests can run.
    expectTypeOf<TestModeWorkspaceService>().toEqualTypeOf<
      Pick<WorkspaceService, keyof WorkspaceService>
    >();

    const { service } = createTestModeWorkspaceMock();
    expectTypeOf(service).toExtend<TestModeWorkspaceService>();
    for (const methodName of TEST_MODE_WORKSPACE_SERVICE_METHOD_NAMES) {
      expect(
        typeof service[methodName],
        `${methodName} is callable at runtime`
      ).toBe('function');
    }
    expect(service.getRootPath()).toBe('/test-workspace');
    expect(service.isInitialized()).toBe(true);

    await service.writeFile('/test-workspace/docs/check.txt', 'ready');
    expect(await service.readFile('/test-workspace/docs/check.txt')).toBe(
      'ready'
    );
    await service.copy(
      '/test-workspace/docs/check.txt',
      '/test-workspace/docs/copy.txt'
    );
    expect(await service.exists('/test-workspace/docs/copy.txt')).toBe(true);
  });
});

describe('useTestModeWorkspace recording setup', () => {
  it('updates the workspace stores after recording writes finish while mounted', async () => {
    window.history.replaceState({}, '', '?recordMatter=1');
    const writes: Array<Promise<void>> = [];
    const resolveWrites: Array<() => void> = [];
    const writeFile = vi.fn(() => {
      const write = new Promise<void>((resolve) => resolveWrites.push(resolve));
      writes.push(write);
      return write;
    });
    const setFileTree = vi.fn();
    const expandAllFolders = vi.fn();
    const openFile = vi.fn();

    const { unmount } = renderHook(() => {
      useTestModeWorkspace({
        isTestMode: true,
        rootPath: null,
        setRootPath: vi.fn(),
        openFile,
        setFileTree,
        expandAllFolders,
        workspaceServiceRef: {
          current: { writeFile } as unknown as WorkspaceService,
        },
      });
    });

    await act(async () => {
      resolveWrites.forEach((resolve) => {
        resolve();
      });
      await Promise.all(writes);
    });

    expect(setFileTree).toHaveBeenCalledTimes(1);
    expect(expandAllFolders).toHaveBeenCalledTimes(1);
    expect(openFile).toHaveBeenCalledWith(
      '/test-workspace/Webb Household/Review Notes.md',
      'Review Notes.md',
      expect.any(String)
    );
    unmount();
  });

  it('does not update the workspace stores when recording writes finish after unmount', async () => {
    window.history.replaceState({}, '', '?recordMatter=1');
    const writes: Array<Promise<void>> = [];
    const resolveWrites: Array<() => void> = [];
    const writeFile = vi.fn(() => {
      const write = new Promise<void>((resolve) => resolveWrites.push(resolve));
      writes.push(write);
      return write;
    });
    const setFileTree = vi.fn();
    const expandAllFolders = vi.fn();
    const openFile = vi.fn();

    const { unmount } = renderHook(() => {
      useTestModeWorkspace({
        isTestMode: true,
        rootPath: null,
        setRootPath: vi.fn(),
        openFile,
        setFileTree,
        expandAllFolders,
        workspaceServiceRef: {
          current: { writeFile } as unknown as WorkspaceService,
        },
      });
    });

    expect(writeFile).toHaveBeenCalledTimes(5);
    unmount();

    await act(async () => {
      resolveWrites.forEach((resolve) => {
        resolve();
      });
      await Promise.all(writes);
    });

    expect(setFileTree).not.toHaveBeenCalled();
    expect(expandAllFolders).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
  });
});

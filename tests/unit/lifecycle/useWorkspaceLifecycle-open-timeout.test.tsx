/**
 * Review finding (P1) on the boot-auto-resume fix: `handleOpenRecentProject`
 * had NO timeout at all on the native setup (createFSBackend + initialize).
 * That was always a latent gap for the manual "recent projects" menu click,
 * but auto-resume (useAutoResumeWorkspace) made it much worse — it suppresses
 * the ENTIRE workspace picker while `openWorkspace` is in flight, with no
 * cancel/escape UI, so a hung native call (e.g. an unreachable network share)
 * left the user staring at a blank loading screen forever.
 *
 * Fix: `handleOpenRecentProject` now wraps the native setup in the SAME
 * `withTimeout` pattern WorkspaceSelector's manual open path already uses
 * (`tests/unit/workspace/WorkspaceSelector.timeout.test.tsx` pins that one).
 * This test proves the fix at the shared function both callers use.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';

// Mirrors WorkspaceSelector.timeout.test.tsx's mock: a SHORT (100ms) window so
// the test doesn't need to wait out the real 30s budget to prove the shape.
vi.mock('@/lib/withTimeout', () => ({
  TimeoutError: class TimeoutError extends Error {},
  withTimeout: (p: Promise<unknown>, ms: number, label: string) =>
    Promise.race([
      p,
      new Promise((_res, rej) =>
        setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), 100),
      ),
    ]),
}));

const createFSBackend = vi.fn();
vi.mock('@/platform/fs/BackendFactory', () => ({
  createFSBackend: (...args: unknown[]) => createFSBackend(...args),
}));

const initialize = vi.fn();
// Minimal service double: initialize is the spy under test; the rest are
// no-ops satisfying whatever handleWorkspaceSelected touches on success
// (mirrors the fakeService() helper in useWorkspaceLifecycle-recents.test.tsx).
vi.mock('@/platform/fs/WorkspaceService', () => ({
  createWorkspaceService: () => ({
    initialize,
    getRootPath: () => '/Users/me/Practice',
    getBackend: () => null,
    exists: vi.fn(async () => true),
    mkdir: vi.fn(async () => {}),
    getFileTree: vi.fn(async () => []),
    readFile: vi.fn(async () => ''),
    readFileBinary: vi.fn(async () => new Uint8Array()),
  }),
}));

import { useWorkspaceLifecycle } from '@/app/lifecycle/useWorkspaceLifecycle';
import { AuditService } from '@/platform/audit/AuditService';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';

function renderLifecycle() {
  return renderHook(() => {
    const workspaceServiceRef = useRef<WorkspaceService | null>(null);
    const auditServiceRef = useRef<AuditService>(new AuditService());
    const templatesMarketplaceServiceRef = useRef(null);
    const templatesMetadataReaderRef = useRef(null);
    return useWorkspaceLifecycle({
      workspaceServiceRef,
      auditServiceRef,
      templatesMarketplaceServiceRef,
      templatesMetadataReaderRef,
      setShowWorkspaceSelector: vi.fn(),
      setAuditEntries: vi.fn(),
      setAuditIntegrity: vi.fn(),
      setRootPath: vi.fn(),
      loadTrashMetadata: vi.fn(async () => []),
      setTrashItems: vi.fn(),
      setTrashStats: vi.fn(),
      loadSourceCards: vi.fn(async () => []),
      setSourceCards: vi.fn(),
      loadChatFiles: vi.fn(async () => []),
      setChatFiles: vi.fn(),
      confirm: vi.fn(async () => true),
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useWorkspaceLifecycle — handleOpenRecentProject native-setup timeout (P1 fix)', () => {
  it('settles instead of hanging forever when createFSBackend never resolves', async () => {
    // Simulates an unreachable network/OneDrive folder: the native call just
    // never settles.
    createFSBackend.mockImplementation(() => new Promise(() => {}));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderLifecycle();

    let settled = false;
    await act(async () => {
      await result.current.handleOpenRecentProject('/Volumes/UnreachableShare/Practice');
      settled = true;
    });

    // The whole point: this awaited without needing to wait out a real hang —
    // handleOpenRecentProject's own promise resolved via the (mocked, short)
    // timeout instead of hanging forever.
    expect(settled).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      '[App] Failed to open recent project:',
      expect.objectContaining({ message: expect.stringMatching(/^Opening the workspace timed out after 30s/) }),
    );
    // initialize was never reached — the hang was in createFSBackend itself.
    expect(initialize).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('settles instead of hanging forever when service.initialize never resolves', async () => {
    createFSBackend.mockResolvedValue({});
    initialize.mockImplementation(() => new Promise(() => {}));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderLifecycle();

    let settled = false;
    await act(async () => {
      await result.current.handleOpenRecentProject('/Volumes/SlowShare/Practice');
      settled = true;
    });

    expect(settled).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      '[App] Failed to open recent project:',
      expect.objectContaining({ message: expect.stringMatching(/^Opening the workspace timed out after 30s/) }),
    );

    errorSpy.mockRestore();
  });

  it('still opens normally when native setup succeeds quickly', async () => {
    const fakeBackend = {};
    createFSBackend.mockResolvedValue(fakeBackend);
    initialize.mockResolvedValue(undefined);

    const { result } = renderLifecycle();

    await act(async () => {
      await result.current.handleOpenRecentProject('/Users/me/Practice');
    });

    expect(createFSBackend).toHaveBeenCalledWith('/Users/me/Practice');
    expect(initialize).toHaveBeenCalledWith(fakeBackend, '/Users/me/Practice');
  });
});

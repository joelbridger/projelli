// Unit tests for the "Open on Desktop" path-resolution logic in FileTree.
//
// Scope: these tests exercise the exported `resolveExplorerPath` function from
// the production FileTree module.  They cover the path-joining rules (Unix,
// Windows, UNC) that the function itself implements.
//
// What is NOT covered here: the FileTree click handler that calls
// `resolveExplorerPath`, the Tauri `invoke('open_in_explorer', ...)` side
// effect in the real app, or the file-selection state wiring inside FileTree.
// Those code paths require a running Tauri context and live in integration /
// e2e coverage.
//
// The historic bug this guards against: joining with "/" unconditionally on
// Windows produced "C:\Users\ws/docs" -- a mixed-separator path that
// explorer.exe silently ignores, falling back to the user's Documents folder.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tauri-apps/api/core so we can assert the exact invoke call.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';

// Import the REAL resolveExplorerPath from the production FileTree component.
// This ensures the test guards the actual logic, not an inline copy.
// NOTE: FileTree is a React component module; we import only the named export.
import { resolveExplorerPath } from '../../src/features/documents/workspace/FileTree';

// Simulate what handleOpenInExplorer does: resolve, then invoke.
async function handleOpenInExplorer(
  rootPath: string | null,
  selectedPath: string | null,
): Promise<void> {
  if (!rootPath) return;
  const pathToOpen = resolveExplorerPath(rootPath, selectedPath);
  await invoke('open_in_explorer', { path: pathToOpen });
}

// ---------------------------------------------------------------------------

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockResolvedValue(undefined);
});

describe('open-in-explorer path resolution (Unix)', () => {
  const ROOT = '/ws';

  it('opens rootPath when nothing is selected', async () => {
    await handleOpenInExplorer(ROOT, null);
    expect(invokeMock).toHaveBeenCalledWith('open_in_explorer', { path: '/ws' });
  });

  it('resolves a relative folder selection to an absolute path', async () => {
    await handleOpenInExplorer(ROOT, 'docs');
    expect(invokeMock).toHaveBeenCalledWith('open_in_explorer', { path: '/ws/docs' });
  });

  it('resolves a nested relative file selection to an absolute path', async () => {
    await handleOpenInExplorer(ROOT, 'docs/brief.docx');
    expect(invokeMock).toHaveBeenCalledWith('open_in_explorer', {
      path: '/ws/docs/brief.docx',
    });
  });

  it('passes through a path that is already absolute without modification', async () => {
    await handleOpenInExplorer(ROOT, '/ws/docs');
    expect(invokeMock).toHaveBeenCalledWith('open_in_explorer', { path: '/ws/docs' });
  });

  it('does not produce double slashes when rootPath has a trailing slash', async () => {
    await handleOpenInExplorer('/ws/', 'docs');
    const arg = invokeMock.mock.calls[0]![1] as { path: string };
    expect(arg.path).toBe('/ws/docs');
    expect(arg.path).not.toContain('//');
  });
});

describe('open-in-explorer path resolution (Windows)', () => {
  const ROOT = 'C:\\Users\\alice\\ws';

  it('opens rootPath when nothing is selected', async () => {
    await handleOpenInExplorer(ROOT, null);
    expect(invokeMock).toHaveBeenCalledWith('open_in_explorer', {
      path: 'C:\\Users\\alice\\ws',
    });
  });

  it('resolves a relative folder selection using backslash separator', async () => {
    await handleOpenInExplorer(ROOT, 'docs');
    expect(invokeMock).toHaveBeenCalledWith('open_in_explorer', {
      path: 'C:\\Users\\alice\\ws\\docs',
    });
  });

  it('resolves a nested relative file selection using backslash separator (normalized)', async () => {
    await handleOpenInExplorer(ROOT, 'docs/brief.docx');
    expect(invokeMock).toHaveBeenCalledWith('open_in_explorer', {
      path: 'C:\\Users\\alice\\ws\\docs\\brief.docx',
    });
  });

  it('does NOT produce mixed separators (the historic bug)', async () => {
    await handleOpenInExplorer(ROOT, 'docs/brief.docx');
    const arg = invokeMock.mock.calls[0]![1] as { path: string };
    // The root join must use backslash, not forward slash
    expect(arg.path).toMatch(/^C:\\Users\\alice\\ws\\/);
    // Must NOT contain any forward slashes after the drive root
    expect(arg.path).not.toContain('/');
  });

  it('passes through a Windows-absolute path without modification', async () => {
    await handleOpenInExplorer(ROOT, 'C:\\Users\\alice\\ws\\docs');
    expect(invokeMock).toHaveBeenCalledWith('open_in_explorer', {
      path: 'C:\\Users\\alice\\ws\\docs',
    });
  });
});

describe('open-in-explorer: no invoke when rootPath is null', () => {
  it('returns early and never calls invoke', async () => {
    await handleOpenInExplorer(null, 'docs');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('open-in-explorer: UNC paths pass through unchanged', () => {
  const UNC_ROOT = '\\\\server\\share\\workspace';

  it('passes a UNC path through unchanged when selectedPath is null', async () => {
    await handleOpenInExplorer(UNC_ROOT, null);
    expect(invokeMock).toHaveBeenCalledWith('open_in_explorer', {
      path: '\\\\server\\share\\workspace',
    });
  });

  it('passes a UNC selectedPath through unchanged (already absolute)', async () => {
    await handleOpenInExplorer(UNC_ROOT, '\\\\server\\share\\workspace\\docs');
    expect(invokeMock).toHaveBeenCalledWith('open_in_explorer', {
      path: '\\\\server\\share\\workspace\\docs',
    });
  });

  it('resolves a relative selection against a UNC root with backslash separator', async () => {
    await handleOpenInExplorer(UNC_ROOT, 'docs');
    expect(invokeMock).toHaveBeenCalledWith('open_in_explorer', {
      path: '\\\\server\\share\\workspace\\docs',
    });
  });
});

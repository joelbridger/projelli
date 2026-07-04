/**
 * useFileImport — QA-32 regression coverage for handleImportFiles' "Add
 * files" dialog-watchdog fallback.
 *
 * Before this fix, a native file picker that silently never responds (see
 * dialogWatchdog.ts) left "Add files" stuck forever with no escape. These
 * tests pin down that a watchdog timeout falls back to a manual path prompt,
 * and that a normal (fast) dialog response is completely unaffected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { openDialogMock, importPickedFilesMock } = vi.hoisted(() => ({
  openDialogMock: vi.fn(),
  importPickedFilesMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openDialogMock,
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
}));

vi.mock('@/platform/utils/fileDrop', () => ({
  importPickedFiles: importPickedFilesMock,
  writeDroppedFiles: vi.fn(),
}));

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { getInstance: () => ({ indexFile: vi.fn().mockResolvedValue(undefined) }) },
}));

import { useFileImport, type UseFileImportOptions } from './useFileImport';

function makeOptions(
  promptForPath?: UseFileImportOptions['promptForPath'],
): UseFileImportOptions {
  return {
    rootPath: '/workspace',
    workspaceServiceRef: { current: { readFileBinary: vi.fn(), getFileTree: vi.fn().mockResolvedValue([]) } } as never,
    setFileTree: vi.fn(),
    handleFileOpen: vi.fn().mockResolvedValue(undefined),
    undoToast: { show: vi.fn(), state: null, dismiss: vi.fn(), invokeUndo: vi.fn() } as never,
    ...(promptForPath !== undefined ? { promptForPath } : {}),
  };
}

describe('useFileImport — handleImportFiles (QA-32 dialog watchdog)', () => {
  beforeEach(() => {
    openDialogMock.mockReset();
    importPickedFilesMock.mockClear();
  });

  it('falls back to the manual path prompt when the native picker never responds', async () => {
    vi.useFakeTimers();
    openDialogMock.mockReturnValue(new Promise(() => {})); // hangs forever
    const promptForPath = vi.fn<NonNullable<UseFileImportOptions['promptForPath']>>()
      .mockResolvedValue('/manual/file.docx');

    const { result } = renderHook(() => useFileImport(makeOptions(promptForPath)));

    const importPromise = act(async () => {
      const p = result.current.handleImportFiles();
      await vi.advanceTimersByTimeAsync(90_000);
      await p;
    });
    await importPromise;

    expect(promptForPath).toHaveBeenCalledTimes(1);
    const call = promptForPath.mock.calls[0];
    if (!call) throw new Error('expected promptForPath to have been called');
    const [message, defaultValue, options] = call;
    expect(typeof message).toBe('string');
    expect(defaultValue).toBe('');
    expect(typeof options?.title).toBe('string');
    expect(importPickedFilesMock).toHaveBeenCalledWith(
      expect.objectContaining({ paths: ['/manual/file.docx'] }),
    );
    vi.useRealTimers();
  });

  it('does not fall back when the picker resolves normally', async () => {
    openDialogMock.mockResolvedValue(['/picked/file.docx']);
    const promptForPath = vi.fn();

    const { result } = renderHook(() => useFileImport(makeOptions(promptForPath)));
    await act(async () => {
      await result.current.handleImportFiles();
    });

    expect(promptForPath).not.toHaveBeenCalled();
    expect(importPickedFilesMock).toHaveBeenCalledWith(
      expect.objectContaining({ paths: ['/picked/file.docx'] }),
    );
  });

  it('does nothing (no crash) when the picker hangs and no promptForPath is supplied', async () => {
    vi.useFakeTimers();
    openDialogMock.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useFileImport(makeOptions(undefined)));
    await act(async () => {
      const p = result.current.handleImportFiles();
      await vi.advanceTimersByTimeAsync(90_000);
      await p;
    });

    expect(importPickedFilesMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

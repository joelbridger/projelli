/**
 * BUG-034 regression — toolbar "Download" must copy the file's raw bytes.
 *
 * handleDownload previously called workspaceService.readFile() (which returns a
 * UTF-8 string) and handed that to saveFile(). For a binary file (PDF / DOCX /
 * XLSX / image) the text read corrupts the bytes, so the downloaded copy is
 * broken and won't open.
 *
 * The robust fix: a download always reads raw bytes via readFileBinary() (an
 * ArrayBuffer) and hands them to saveFile() (which writes ArrayBuffers as bytes
 * in both Tauri and browser). Reading bytes is lossless for text too and does
 * NOT depend on the isBinaryFile() extension list — so an unusual-but-binary
 * extension can never fall through to the corrupting text path. This test drives
 * the real useFileOperations hook with a mocked WorkspaceService + saveFile.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';

const saveFileMock = vi.fn(
  async (_content: string | ArrayBuffer | Uint8Array, _options?: Record<string, unknown>) =>
    undefined,
);
vi.mock('@/platform/utils/saveFile', () => ({
  saveFile: (content: string | ArrayBuffer | Uint8Array, options?: Record<string, unknown>) =>
    saveFileMock(content, options),
}));

import { useFileOperations } from '@/app/fileOps/useFileOperations';

function makeOptions(ws: {
  readFile: ReturnType<typeof vi.fn>;
  readFileBinary: ReturnType<typeof vi.fn>;
}) {
  const noop = () => {};
  return {
    workspaceServiceRef: { current: ws } as never,
    fileSystemWatcherRef: { current: null } as never,
    handleFileOpen: vi.fn(async () => {}),
    prompt: vi.fn(async () => null),
    setFileTree: noop as never,
    markSaved: noop as never,
    contentIndex: {} as never,
    openTabs: [] as never,
    closeTab: noop as never,
    renameHistoryRef: { current: [] } as never,
    undoStackRef: { current: [] } as never,
  };
}

describe('BUG-034 — binary downloads read bytes, not text', () => {
  beforeEach(() => {
    saveFileMock.mockClear();
  });

  it('reads a .pdf as binary and saves the ArrayBuffer', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe]).buffer; // "%PDF" + binary
    const ws = {
      readFile: vi.fn(async () => 'should-not-be-called'),
      readFileBinary: vi.fn(async () => bytes),
    };
    const { result } = renderHook(() => useFileOperations(makeOptions(ws)));

    await result.current.handleDownload('/ws/report.pdf', 'report.pdf');

    expect(ws.readFileBinary).toHaveBeenCalledWith('/ws/report.pdf');
    expect(ws.readFile).not.toHaveBeenCalled();
    expect(saveFileMock).toHaveBeenCalledTimes(1);
    expect(saveFileMock.mock.calls[0]![0]).toBe(bytes);
  });

  it('reads a .docx as binary', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer; // ZIP/OOXML magic
    const ws = {
      readFile: vi.fn(async () => ''),
      readFileBinary: vi.fn(async () => bytes),
    };
    const { result } = renderHook(() => useFileOperations(makeOptions(ws)));

    await result.current.handleDownload('/ws/brief.docx', 'brief.docx');

    expect(ws.readFileBinary).toHaveBeenCalledWith('/ws/brief.docx');
    expect(ws.readFile).not.toHaveBeenCalled();
    expect(saveFileMock.mock.calls[0]![0]).toBe(bytes);
  });

  it('reads a .txt as bytes too (lossless, list-independent)', async () => {
    const bytes = new TextEncoder().encode('plain text content').buffer;
    const ws = {
      readFile: vi.fn(async () => 'plain text content'),
      readFileBinary: vi.fn(async () => bytes),
    };
    const { result } = renderHook(() => useFileOperations(makeOptions(ws)));

    await result.current.handleDownload('/ws/notes.txt', 'notes.txt');

    // Robust download copies raw bytes for EVERY file, so even a text file no
    // longer touches the (corrupting-for-binary) readFile text path.
    expect(ws.readFileBinary).toHaveBeenCalledWith('/ws/notes.txt');
    expect(ws.readFile).not.toHaveBeenCalled();
    expect(saveFileMock.mock.calls[0]![0]).toBe(bytes);
  });

  it('handles an unusual-but-binary extension not on the isBinaryFile list', async () => {
    // .heic isn't in isBinaryFile()'s list, yet the download must still copy
    // bytes — the old extension-gated path would have corrupted it.
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]).buffer;
    const ws = {
      readFile: vi.fn(async () => ''),
      readFileBinary: vi.fn(async () => bytes),
    };
    const { result } = renderHook(() => useFileOperations(makeOptions(ws)));

    await result.current.handleDownload('/ws/photo.heic', 'photo.heic');

    expect(ws.readFileBinary).toHaveBeenCalledWith('/ws/photo.heic');
    expect(ws.readFile).not.toHaveBeenCalled();
    expect(saveFileMock.mock.calls[0]![0]).toBe(bytes);
  });
});

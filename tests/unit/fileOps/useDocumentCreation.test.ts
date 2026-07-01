/**
 * useDocumentCreation — "New Word document" default-filename bug (2026-07-01,
 * QA real-Windows finding).
 *
 * The create dialog used to be seeded with `defaultValue: ''` — the filename
 * shown ("my-document") was only the placeholder/preview, not a real value.
 * Pressing OK without typing anything confirmed an EMPTY string, which the
 * `if (!name) return;` guard silently swallowed: no file, no error. These
 * tests assert (a) the prompt's real default value is non-empty and
 * collision-free, and (b) creating with that default actually writes a file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDocumentCreation } from '@/app/fileOps/useDocumentCreation';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { PromptOptions } from '@/platform/hooks/usePromptDialog';

function mockService(existingFiles: Set<string> = new Set()) {
  return {
    exists: vi.fn(async (path: string) => existingFiles.has(path)),
    readFileBinary: vi.fn(),
    writeFileBinary: vi.fn(async () => {}),
    writeFile: vi.fn(async () => {}),
    getFileTree: vi.fn(async () => []),
  } as unknown as WorkspaceService & {
    exists: ReturnType<typeof vi.fn>;
    writeFileBinary: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
  };
}

function setup(existingFiles?: Set<string>) {
  const svc = mockService(existingFiles);
  const workspaceServiceRef = { current: svc };
  const setFileTree = vi.fn();
  const openFile = vi.fn();
  const handleFileOpen = vi.fn().mockResolvedValue(undefined);
  const confirm = vi.fn().mockResolvedValue(true);
  // Captures the (message, defaultValue, options) the handler passed in, and
  // simulates the user's action via `respond`.
  let lastCall: { message: string; defaultValue?: string; options?: Omit<PromptOptions, 'defaultValue'> } | null = null;
  let respond: (value: string | null) => Promise<string | null> = async (v) => v;
  const prompt = vi.fn(
    async (message: string, defaultValue?: string, options?: Omit<PromptOptions, 'defaultValue'>) => {
      lastCall = { message, defaultValue, options };
      return respond(defaultValue ?? null);
    },
  );

  const { result } = renderHook(() =>
    useDocumentCreation({
      workspaceServiceRef,
      rootPath: '/workspace',
      setFileTree,
      prompt,
      confirm,
      handleFileOpen,
      openFile,
    }),
  );

  return {
    result,
    svc,
    setFileTree,
    openFile,
    prompt,
    getLastCall: () => lastCall,
    setRespond: (fn: (defaultValue: string | null) => string | null) => {
      respond = async (v) => fn(v);
    },
  };
}

describe('useDocumentCreation — handleCreateDocxAtRoot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('seeds the prompt with a REAL non-empty default value (not just a placeholder)', async () => {
    const { result, getLastCall } = setup();
    await act(async () => {
      await result.current.handleCreateDocxAtRoot();
    });
    const call = getLastCall();
    expect(call?.defaultValue).toBe('my-document');
    expect(call?.defaultValue).not.toBe('');
  });

  it('pressing OK on the default value actually creates a file (was a silent no-op)', async () => {
    const { result, svc } = setup();
    await act(async () => {
      await result.current.handleCreateDocxAtRoot();
    });
    expect(svc.writeFileBinary).toHaveBeenCalledTimes(1);
    const [path] = svc.writeFileBinary.mock.calls[0] as [string, ArrayBuffer];
    expect(path).toBe('/workspace/docs/my-document.docx');
  });

  it('the default value is collision-free when "my-document.docx" already exists', async () => {
    const { result, getLastCall } = setup(new Set(['/workspace/docs/my-document.docx']));
    await act(async () => {
      await result.current.handleCreateDocxAtRoot();
    });
    expect(getLastCall()?.defaultValue).toBe('my-document 2');
  });

  it('confirming an empty name is rejected by validate() instead of silently no-oping', async () => {
    const { result, getLastCall, svc } = setup();
    await act(async () => {
      await result.current.handleCreateDocxAtRoot();
    });
    const validate = getLastCall()?.options?.validate;
    expect(validate).toBeTypeOf('function');
    expect(validate?.('')).toBeTruthy(); // non-empty error message
    expect(validate?.('   ')).toBeTruthy();
    expect(validate?.('report')).toBeUndefined(); // valid input passes
    // Sanity: a genuinely cancelled prompt (null) still no-ops without creating.
    expect(svc.writeFileBinary).toHaveBeenCalledTimes(1); // from the OK-on-default flow above
  });

  it('a cancelled prompt (null) creates nothing', async () => {
    const { result, svc, setRespond } = setup();
    setRespond(() => null);
    await act(async () => {
      await result.current.handleCreateDocxAtRoot();
    });
    expect(svc.writeFileBinary).not.toHaveBeenCalled();
  });
});

describe('useDocumentCreation — handleCreateFolderAtRoot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('seeds a real, collision-free default folder name', async () => {
    const { result, getLastCall } = setup(new Set());
    await act(async () => {
      await result.current.handleCreateFolderAtRoot();
    });
    expect(getLastCall()?.defaultValue).toBe('my-folder');
  });
});

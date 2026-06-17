// VG-4c — unit tests for `applyLetterheadIfConfigured` (the firm-letterhead
// choke point) and the `docxApplyLetterhead` command wrapper.
//
// The helper is opt-in and fail-open: it returns the input bytes unchanged
// unless a template is configured, readable, and the native merge succeeds.
// These tests pin each branch by mocking the dynamic imports the helper makes.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mocks for the helper's dynamic imports -------------------------------
const isTauriMock = vi.fn(() => true);
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const getSettingMock = vi.fn();
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ getSetting: getSettingMock }),
  },
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: {
    getState: () => ({ rootPath: '/ws' }),
  },
}));

vi.mock('@/platform/fs/pathResolve', () => ({
  resolveWorkspacePath: (root: string, p: string) =>
    p.startsWith('/') ? p : `${root}/${p}`,
}));

const readFileMock = vi.fn();
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

import { applyLetterheadIfConfigured } from '@/utils/docx-io';

const ORIGINAL = new Uint8Array([1, 2, 3, 4]);
const TEMPLATE = new Uint8Array([9, 8, 7]);
const MERGED = new Uint8Array([5, 6, 7, 8, 9]);

/** btoa over a byte array (matches the helper's encoding). */
function b64(bytes: Uint8Array): string {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}

describe('applyLetterheadIfConfigured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
  });

  it('passes through unchanged when not running in Tauri', async () => {
    isTauriMock.mockReturnValue(false);
    const out = await applyLetterheadIfConfigured(ORIGINAL);
    expect(out).toBe(ORIGINAL);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('passes through unchanged when no template is configured', async () => {
    getSettingMock.mockReturnValue('');
    const out = await applyLetterheadIfConfigured(ORIGINAL);
    expect(out).toBe(ORIGINAL);
    expect(readFileMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('passes through unchanged (with a warning) when the template cannot be read', async () => {
    getSettingMock.mockReturnValue('templates/letterhead.docx');
    readFileMock.mockRejectedValue(new Error('not found'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await applyLetterheadIfConfigured(ORIGINAL);
    expect(out).toBe(ORIGINAL);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('passes through unchanged (with a warning) when the merge command throws', async () => {
    getSettingMock.mockReturnValue('/ws/templates/letterhead.docx');
    readFileMock.mockResolvedValue(TEMPLATE);
    invokeMock.mockRejectedValue(new Error('engine error'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await applyLetterheadIfConfigured(ORIGINAL);
    expect(out).toBe(ORIGINAL);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns the merged bytes when a template is set, readable, and the merge succeeds', async () => {
    getSettingMock.mockReturnValue('templates/letterhead.docx');
    readFileMock.mockResolvedValue(TEMPLATE);
    invokeMock.mockResolvedValue(b64(MERGED));

    const out = await applyLetterheadIfConfigured(ORIGINAL);

    // Resolved the workspace-relative path to absolute before reading.
    expect(readFileMock).toHaveBeenCalledWith('/ws/templates/letterhead.docx');
    // Invoked the merge command with both documents base64-encoded.
    expect(invokeMock).toHaveBeenCalledWith('docx_apply_letterhead', {
      generatedB64: b64(ORIGINAL),
      templateB64: b64(TEMPLATE),
    });
    // Decoded the merged bytes back out.
    expect(Array.from(out)).toEqual(Array.from(MERGED));
  });
});

/**
 * Fix 3 — docx-commands wrapper resolves relative paths to absolute before invoke.
 *
 * Verifies that docxOpen (and docxSave) call invoke() with an absolute path
 * even when given a workspace-relative path. The resolution uses the workspace
 * store's rootPath via resolveWorkspacePath.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock @tauri-apps/api/core so docxOpen/docxSave actually run ---
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));

// --- Seed the workspace store with a known rootPath ---
// We import the real store and set the rootPath before importing docx-commands,
// so toAbsoluteDocxPath() picks it up at call time.
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

import { invoke } from '@tauri-apps/api/core';
import { docxOpen, docxSave } from '@/utils/docx-commands';
import { convertDocToDocx, convertPptToPdf } from '@/utils/tauri-commands';
import type { DocumentJson } from '@/types/docx';

const invokeMock = vi.mocked(invoke);

const doc: DocumentJson = {
  formatVersion: 1,
  body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'hello' }] }],
  comments: {},
};

const ROOT = '/home/user/Keepance';

describe('docx-commands path resolution (relative → absolute)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Seed the workspace store with a known absolute root path.
    useWorkspaceStore.setState({ rootPath: ROOT });
    invokeMock.mockResolvedValue(doc);
  });

  it('docxOpen resolves a workspace-relative path to absolute before invoking', async () => {
    await docxOpen('docs/The Supreme Court.docx');
    expect(invokeMock).toHaveBeenCalledWith('docx_open', {
      path: `${ROOT}/docs/The Supreme Court.docx`,
    });
  });

  it('docxOpen passes through an already-absolute path unchanged', async () => {
    await docxOpen('/absolute/path/file.docx');
    expect(invokeMock).toHaveBeenCalledWith('docx_open', {
      path: '/absolute/path/file.docx',
    });
  });

  it('docxSave resolves a workspace-relative path to absolute before invoking', async () => {
    invokeMock.mockResolvedValue(undefined);
    await docxSave('docs/matter.docx', doc);
    expect(invokeMock).toHaveBeenCalledWith('docx_save', {
      path: `${ROOT}/docs/matter.docx`,
      document: doc,
    });
  });

  it('docxOpen with null rootPath passes path through unchanged', async () => {
    useWorkspaceStore.setState({ rootPath: null });
    await docxOpen('docs/file.docx');
    // No rootPath: pass through as-is (the Rust guard will reject it if truly relative)
    expect(invokeMock).toHaveBeenCalledWith('docx_open', {
      path: 'docs/file.docx',
    });
  });
});

// ---------------------------------------------------------------------------
// Item 7e: convertDocToDocx and convertPptToPdf also resolve paths to absolute
// ---------------------------------------------------------------------------

describe('tauri-commands path resolution (relative → absolute)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ rootPath: ROOT });
    invokeMock.mockResolvedValue('/absolute/result/file.docx');
  });

  it('convertDocToDocx resolves a workspace-relative path to absolute before invoking', async () => {
    await convertDocToDocx('legacy/Brief.doc');
    expect(invokeMock).toHaveBeenCalledWith('convert_doc_to_docx', {
      inputPath: `${ROOT}/legacy/Brief.doc`,
    });
  });

  it('convertDocToDocx passes through an already-absolute path unchanged', async () => {
    await convertDocToDocx('/absolute/path/Brief.doc');
    expect(invokeMock).toHaveBeenCalledWith('convert_doc_to_docx', {
      inputPath: '/absolute/path/Brief.doc',
    });
  });

  it('convertPptToPdf resolves a workspace-relative path to absolute before invoking', async () => {
    await convertPptToPdf('slides/Presentation.pptx');
    expect(invokeMock).toHaveBeenCalledWith('convert_ppt_to_pdf', {
      inputPath: `${ROOT}/slides/Presentation.pptx`,
    });
  });

  it('convertPptToPdf passes through an already-absolute path unchanged', async () => {
    await convertPptToPdf('/absolute/path/Presentation.pptx');
    expect(invokeMock).toHaveBeenCalledWith('convert_ppt_to_pdf', {
      inputPath: '/absolute/path/Presentation.pptx',
    });
  });
});

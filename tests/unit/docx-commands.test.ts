// Unit tests for the typed docx Tauri command wrappers (WS-A / A3).
//
// Mocks `@tauri-apps/api/core` so we can assert the exact command name +
// argument shape each wrapper sends, and that browser mode throws.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));

import { invoke } from '@tauri-apps/api/core';
import {
  docxOpen,
  docxSave,
  docxResolveRevision,
  docxResolveAll,
  docxAuthorRevision,
  docxAuthorRevisions,
  isDocxEngineAvailable,
} from '@/utils/docx-commands';
import type { DocumentJson, DocxAiEdit } from '@/types/docx';

const invokeMock = vi.mocked(invoke);

const doc: DocumentJson = {
  formatVersion: 1,
  body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'hi' }] }],
  comments: {},
};

describe('docx-commands (Tauri available)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('isDocxEngineAvailable reflects isTauri', () => {
    expect(isDocxEngineAvailable()).toBe(true);
  });

  it('docxOpen invokes docx_open with the path', async () => {
    invokeMock.mockResolvedValue(doc);
    const out = await docxOpen('/ws/file.docx');
    expect(invoke).toHaveBeenCalledWith('docx_open', { path: '/ws/file.docx' });
    expect(out).toBe(doc);
  });

  it('docxSave invokes docx_save with path + document', async () => {
    invokeMock.mockResolvedValue(undefined);
    await docxSave('/ws/file.docx', doc);
    expect(invoke).toHaveBeenCalledWith('docx_save', {
      path: '/ws/file.docx',
      document: doc,
    });
  });

  it('docxResolveRevision passes document, revisionId, action', async () => {
    invokeMock.mockResolvedValue(doc);
    await docxResolveRevision(doc, '42', 'accept');
    expect(invoke).toHaveBeenCalledWith('docx_resolve_revision', {
      document: doc,
      revisionId: '42',
      action: 'accept',
    });
  });

  it('docxResolveAll passes document + action', async () => {
    invokeMock.mockResolvedValue(doc);
    await docxResolveAll(doc, 'reject');
    expect(invoke).toHaveBeenCalledWith('docx_resolve_all', {
      document: doc,
      action: 'reject',
    });
  });

  it('docxAuthorRevision passes the full argument shape with null defaults', async () => {
    invokeMock.mockResolvedValue(doc);
    await docxAuthorRevision(doc, 'insertion', 0, { text: 'added' });
    expect(invoke).toHaveBeenCalledWith('docx_author_revision', {
      document: doc,
      kind: 'insertion',
      paragraphIndex: 0,
      text: 'added',
      needle: null,
      author: null,
      date: null,
    });
  });

  it('docxAuthorRevisions passes the document, edits, and null defaults', async () => {
    const result = { document: doc, results: [] };
    invokeMock.mockResolvedValue(result);
    const edits: DocxAiEdit[] = [
      { op: 'replace', paragraphIndex: 0, anchorText: 'hi', newText: 'hello', reason: 'expand' },
    ];
    const out = await docxAuthorRevisions(doc, edits);
    expect(invoke).toHaveBeenCalledWith('docx_author_revisions', {
      document: doc,
      edits,
      author: null,
      date: null,
    });
    expect(out).toBe(result);
  });

  it('docxAuthorRevisions forwards an explicit author', async () => {
    invokeMock.mockResolvedValue({ document: doc, results: [] });
    await docxAuthorRevisions(doc, [], { author: 'You' });
    expect(invoke).toHaveBeenCalledWith('docx_author_revisions', {
      document: doc,
      edits: [],
      author: 'You',
      date: null,
    });
  });
});

describe('docx-commands (browser mode)', () => {
  beforeEach(() => vi.resetModules());

  it('throws in browser mode (isTauri false)', async () => {
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn(),
      isTauri: () => false,
    }));
    const mod = await import('@/utils/docx-commands');
    expect(mod.isDocxEngineAvailable()).toBe(false);
    await expect(mod.docxOpen('/x.docx')).rejects.toThrow(/desktop app/i);
    await expect(mod.docxSave('/x.docx', doc)).rejects.toThrow(/desktop app/i);
  });
});

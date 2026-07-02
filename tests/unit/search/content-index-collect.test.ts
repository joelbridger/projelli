/**
 * collectDocuments — binary-extraction gate (Codex review follow-up to BUG-035).
 *
 * Broadening isBinaryFile() added many large always-binary formats (.iso/.dmg/
 * .parquet/.sqlite/video/audio/fonts). The indexer must NOT read + base64-encode
 * those: extractForAI can only pull text from docx/xlsx/xls/pptx, so for every
 * other binary the read+encode is wasted work that can spike memory on a big
 * file. The gate returns null BEFORE the read for non-extractable binaries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const extractForAIMock = vi.fn();
vi.mock('@/platform/utils/ai-file-context', () => ({
  extractForAI: (...args: unknown[]) => extractForAIMock(...args),
}));

import { collectDocuments } from '@/platform/search/ContentIndex';
import type { FileNode } from '@/platform/types/workspace';

function fileNode(path: string, name: string): FileNode {
  const extension = name.split('.').pop()?.toLowerCase();
  return {
    id: path,
    path,
    name,
    type: 'file',
    ...(extension !== undefined ? { extension } : {}),
  };
}

function makeService(over: Partial<{ readFile: ReturnType<typeof vi.fn>; readFileBinary: ReturnType<typeof vi.fn> }> = {}) {
  return {
    readFile: over.readFile ?? vi.fn(async () => 'text content'),
    readFileBinary: over.readFileBinary ?? vi.fn(async () => new ArrayBuffer(8)),
  };
}

describe('collectDocuments — binary extraction gate', () => {
  beforeEach(() => {
    extractForAIMock.mockReset();
  });

  it('does NOT read a non-extractable binary (.png) — skipped before the read', async () => {
    const svc = makeService();
    const docs = await collectDocuments(svc as never, [fileNode('/ws/photo.png', 'photo.png')]);
    expect(docs).toHaveLength(0);
    expect(svc.readFileBinary).not.toHaveBeenCalled();
    expect(svc.readFile).not.toHaveBeenCalled();
    expect(extractForAIMock).not.toHaveBeenCalled();
  });

  it('does NOT read a large non-extractable binary (.iso) — the memory-spike case', async () => {
    const svc = makeService();
    const docs = await collectDocuments(svc as never, [fileNode('/ws/disk.iso', 'disk.iso')]);
    expect(docs).toHaveLength(0);
    expect(svc.readFileBinary).not.toHaveBeenCalled();
  });

  it('DOES read + extract an extractable binary (.docx)', async () => {
    extractForAIMock.mockResolvedValue({ extractedText: 'brief body text', fileName: 'brief.docx', path: '/ws/brief.docx' });
    const svc = makeService();
    const docs = await collectDocuments(svc as never, [fileNode('/ws/brief.docx', 'brief.docx')]);
    expect(svc.readFileBinary).toHaveBeenCalledWith('/ws/brief.docx');
    expect(extractForAIMock).toHaveBeenCalledTimes(1);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.content).toContain('brief body text');
  });

  it('indexes a plain-text file via the text path (.md)', async () => {
    const svc = makeService({ readFile: vi.fn(async () => '# Notes\nplan and budget') });
    const docs = await collectDocuments(svc as never, [fileNode('/ws/notes.md', 'notes.md')]);
    expect(svc.readFile).toHaveBeenCalledWith('/ws/notes.md');
    expect(svc.readFileBinary).not.toHaveBeenCalled();
    expect(docs[0]?.content).toContain('plan and budget');
  });
});

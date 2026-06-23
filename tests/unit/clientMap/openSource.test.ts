// tests/unit/clientMap/openSource.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const openFileMock = vi.hoisted(() => vi.fn());
const scrollMock = vi.hoisted(() => vi.fn());
const scopeMock = vi.hoisted(() => vi.fn(() => true));
const rootPathRef = vi.hoisted(() => ({ value: '/root' as string | null }));

vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => ({ rootPath: rootPathRef.value }) },
}));
vi.mock('@/platform/state/editorStore', () => ({
  useEditorStore: { getState: () => ({ openFile: openFileMock }) },
}));
vi.mock('@/platform/utils/scrollToParagraph', () => ({
  requestScrollToParagraph: scrollMock,
}));
vi.mock('@/platform/matter/matterScopeGuard', () => ({
  pathInMatterScope: scopeMock,
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: { getState: () => ({ matters: [] }) },
}));

import { dispatchOpenSource, openSourceDocument } from '@/platform/clientMap/openSource';
import type { SourceRef, DocumentReader } from '@/platform/clientMap/openSource';

const reader = (over: Partial<DocumentReader> = {}): DocumentReader => ({
  readFile: vi.fn(async () => ''),
  readFileBinary: vi.fn(async () => new ArrayBuffer(0)),
  ...over,
});

beforeEach(() => {
  openFileMock.mockReset();
  scrollMock.mockReset();
  scopeMock.mockReset();
  scopeMock.mockReturnValue(true);
  rootPathRef.value = '/root';
});

describe('dispatchOpenSource', () => {
  it('opens an email source through the dedicated open-email action (exact message id)', () => {
    const events: CustomEvent[] = [];
    const h = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('keepance:open-email', h);
    const ref: SourceRef = { kind: 'email', ref: 'mail:abc123', snippet: 's' };
    dispatchOpenSource('m1', ref);
    window.removeEventListener('keepance:open-email', h);
    expect(events).toHaveLength(1);
    expect(events[0]!.detail.sourceId).toBe('mail:abc123');
  });

  it('opens a document source through matter-launch carrying the exact path + snippet', () => {
    const events: CustomEvent[] = [];
    const h = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('keepance:matter-launch', h);
    const ref: SourceRef = { kind: 'document', ref: 'folder/lease.docx', snippet: 'rent is due' };
    dispatchOpenSource('m1', ref);
    window.removeEventListener('keepance:matter-launch', h);
    expect(events).toHaveLength(1);
    expect(events[0]!.detail.matterId).toBe('m1');
    expect(events[0]!.detail.surface).toBe('files');
    expect(events[0]!.detail.source).toEqual({ kind: 'document', ref: 'folder/lease.docx', snippet: 'rent is due' });
  });
});

describe('openSourceDocument', () => {
  it('reads a text document via the injected service and opens it at the cited snippet', async () => {
    const readFile = vi.fn(async () => 'full document text');
    const ok = await openSourceDocument('notes/intake.txt', 'm1', reader({ readFile }), 'cited line');
    expect(ok).toBe(true);
    expect(readFile).toHaveBeenCalledWith('/root/notes/intake.txt');
    expect(openFileMock).toHaveBeenCalledWith('/root/notes/intake.txt', 'intake.txt', 'full document text');
    expect(scrollMock).toHaveBeenCalledWith(expect.objectContaining({ path: '/root/notes/intake.txt', snippet: 'cited line' }));
  });

  it('reads a binary document (e.g. .docx) as a data URL', async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const readFileBinary = vi.fn(async () => buf);
    const ok = await openSourceDocument('docs/contract.docx', 'm1', reader({ readFileBinary }));
    expect(ok).toBe(true);
    expect(readFileBinary).toHaveBeenCalledWith('/root/docs/contract.docx');
    const call = openFileMock.mock.calls[0]!;
    expect(call[1]).toBe('contract.docx');
    expect(String(call[2]).startsWith('data:')).toBe(true);
  });

  it('does not double-prefix an already-absolute path', async () => {
    const readFile = vi.fn(async () => 'x');
    await openSourceDocument('/root/already/abs.txt', 'm1', reader({ readFile }));
    expect(readFile).toHaveBeenCalledWith('/root/already/abs.txt');
  });

  it('fails closed (never opens) when the resolved path is outside the matter scope', async () => {
    scopeMock.mockReturnValue(false);
    const readFile = vi.fn(async () => 'x');
    const ok = await openSourceDocument('other/secret.txt', 'm1', reader({ readFile }));
    expect(ok).toBe(false);
    expect(openFileMock).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(scopeMock).toHaveBeenCalledWith('/root/other/secret.txt', 'm1', expect.anything());
  });

  it('returns false (caller falls back) when there is no active workspace', async () => {
    const ok = await openSourceDocument('x.txt', 'm1', null, 's');
    expect(ok).toBe(false);
    expect(openFileMock).not.toHaveBeenCalled();
  });

  it('returns false when the read fails', async () => {
    const ok = await openSourceDocument('missing.txt', 'm1', reader({ readFile: vi.fn(async () => { throw new Error('gone'); }) }));
    expect(ok).toBe(false);
  });
});

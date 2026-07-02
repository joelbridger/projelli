import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from '@/app/lifecycle/useAutosave';
import { writeTabContentToDisk } from '@/app/fileOps/flushDirtyTabs';
import { writeCoordinator } from '@/platform/fs/writeCoordinator';
import { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { FSBackend, FileStat } from '@/platform/fs/types';
import type { FileNode } from '@/platform/types/workspace';

const WORKSPACE_ROOT = '/test-workspace';

function statFor(path: string, type: FileStat['type'], size = 0): FileStat {
  return {
    path,
    name: path.split('/').pop() || '',
    type,
    size,
    createdAt: new Date(),
    modifiedAt: new Date(),
    isSymlink: false,
  };
}

function createMemoryBackend(): FSBackend {
  const entries = new Map<string, { content: string | ArrayBuffer; stat: FileStat }>([
    [WORKSPACE_ROOT, { content: '', stat: statFor(WORKSPACE_ROOT, 'folder') }],
  ]);
  let rootPath = '';

  const rootStat = (): FileStat => statFor('', 'folder');

  return {
    async setRootPath(path: string) {
      rootPath = path;
    },
    getRootPath() {
      return rootPath;
    },
    async exists(path: string) {
      if (path === '' || path === rootPath) return entries.has(rootPath);
      return entries.has(path);
    },
    async stat(path: string) {
      if (path === '' || path === rootPath) return rootStat();
      const entry = entries.get(path);
      if (!entry) throw new Error(`Path not found: ${path}`);
      return entry.stat;
    },
    async read(path: string) {
      const entry = entries.get(path);
      if (!entry || typeof entry.content !== 'string') {
        throw new Error(`Text file not found: ${path}`);
      }
      return entry.content;
    },
    async readBinary(path: string) {
      const entry = entries.get(path);
      if (!entry) throw new Error(`File not found: ${path}`);
      if (typeof entry.content === 'string') {
        return new TextEncoder().encode(entry.content).buffer;
      }
      return entry.content;
    },
    async write(path: string, content: string) {
      entries.set(path, { content, stat: statFor(path, 'file', content.length) });
    },
    async writeBinary(path: string, content: ArrayBuffer) {
      entries.set(path, { content, stat: statFor(path, 'file', content.byteLength) });
    },
    async delete(path: string) {
      for (const key of [...entries.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) entries.delete(key);
      }
    },
    async move(from: string, to: string) {
      const entry = entries.get(from);
      if (!entry) throw new Error(`Path not found: ${from}`);
      entries.set(to, { ...entry, stat: { ...entry.stat, path: to } });
      entries.delete(from);
    },
    async copy(from: string, to: string) {
      const entry = entries.get(from);
      if (!entry) throw new Error(`Path not found: ${from}`);
      entries.set(to, { ...entry, stat: { ...entry.stat, path: to } });
    },
    async rename(path: string, newName: string) {
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      const to = parent ? `${parent}/${newName}` : newName;
      await this.move(path, to);
    },
    async mkdir(path: string) {
      entries.set(path, { content: '', stat: statFor(path, 'folder') });
    },
    async list(path: string): Promise<FileNode[]> {
      const prefix = path ? `${path}/` : '';
      return [...entries.entries()]
        .filter(([key]) => key !== WORKSPACE_ROOT && key.startsWith(prefix))
        .map(([key, entry]) => ({
          path: key,
          name: entry.stat.name,
          type: entry.stat.type,
          children: entry.stat.type === 'folder' ? [] : undefined,
        }));
    },
    async isSymlink() {
      return false;
    },
    async resolveSymlink(path: string) {
      return path;
    },
  };
}

describe('useAutosave disk writes (TEST-003)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes typed dirty-tab content through WorkspaceService after the 2s autosave tick', async () => {
    const service = new WorkspaceService();
    await service.initialize(createMemoryBackend(), WORKSPACE_ROOT);

    const path = `${WORKSPACE_ROOT}/docs/autosave-note.md`;
    await service.writeFile(path, 'old content');

    const typedContent = 'old content\n\nTyped into the editor and persisted by autosave.';
    const markSaved = vi.fn();
    const serviceRef = { current: service };
    const writeTabContent = (tabPath: string, content: string) =>
      writeTabContentToDisk(service, tabPath, content);

    renderHook(() =>
      useAutosave(
        [{ path, content: typedContent, isDirty: true, rev: 7 }],
        writeTabContent,
        markSaved,
        serviceRef,
      ),
    );

    expect(await service.readFile(path)).toBe('old content');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await writeCoordinator.drain(path);

    expect(await service.readFile(path)).toBe(typedContent);
    expect(markSaved).toHaveBeenCalledWith(path, 7);
  });

  it('Perf (P1.2): still autosaves a continuously-typed tab — a new openTabs reference on every keystroke must not reset the 2s timer', async () => {
    // Regression: the effect used to depend on `openTabs` itself. Since
    // `updateContent` gives every edit a brand-new array + tab object, the
    // interval was torn down and recreated on every keystroke — a user who
    // never paused typing for a full 2s would NEVER get autosaved.
    const service = new WorkspaceService();
    await service.initialize(createMemoryBackend(), WORKSPACE_ROOT);

    const path = `${WORKSPACE_ROOT}/docs/typing-note.md`;
    await service.writeFile(path, '');

    const markSaved = vi.fn();
    const serviceRef = { current: service };
    const writeTabContent = (tabPath: string, content: string) =>
      writeTabContentToDisk(service, tabPath, content);

    const { rerender } = renderHook(
      ({ content }: { content: string }) =>
        useAutosave(
          [{ path, content, isDirty: true, rev: content.length }],
          writeTabContent,
          markSaved,
          serviceRef,
        ),
      { initialProps: { content: 'h' } },
    );

    // Simulate a keystroke every 200ms for 1.8s — well under the 2s autosave
    // period, so if the timer were reset by each rerender it would never fire.
    let typed = 'h';
    for (let i = 0; i < 9; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      typed += 'i';
      rerender({ content: typed });
    }

    // Advance past the ORIGINAL 2s mark (total elapsed so far: 1.8s + 0.3s = 2.1s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await writeCoordinator.drain(path);

    expect(await service.readFile(path)).toBe(typed);
    expect(markSaved).toHaveBeenCalled();
  });
});

/**
 * TauriFSBackend.list — desktop dotfile visibility + shallow contract (UX-21).
 *
 * The desktop backend used to (a) drop EVERY dot-prefixed entry before the UI
 * saw it, so "Show Hidden Files" could never reveal .gitignore, and (b) recurse
 * internally, which after (a)'s removal would have walked huge dot-directories
 * like .git. It now drops ONLY Lantern's internal `.keepance` folder and is
 * SHALLOW (one level, like WebFSBackend) — real recursion + the .trash / dot-dir
 * / symlink rules are owned by WorkspaceService.listRecursive.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const readDir = vi.fn();
const exists = vi.fn(async (..._args: unknown[]) => true);

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: (...args: unknown[]) => readDir(...args),
  exists: (...args: unknown[]) => exists(...args),
}));

import { TauriFSBackend } from '@/platform/fs/TauriFSBackend';

beforeEach(() => {
  readDir.mockReset();
  exists.mockReset().mockResolvedValue(true);
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
});

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe('TauriFSBackend.list — desktop dotfile visibility', () => {
  it('returns ordinary dotfiles (.gitignore), hides only .keepance, keeps .trash', async () => {
    readDir.mockImplementation(async (abs: string) => {
      if (abs === '/ws') {
        return [
          { name: '.gitignore', isDirectory: false, isFile: true },
          { name: '.lantern', isDirectory: true, isFile: false },
          { name: '.git', isDirectory: true, isFile: false },
          { name: '.trash', isDirectory: true, isFile: false },
          { name: 'docs', isDirectory: true, isFile: false },
          { name: 'README.md', isDirectory: false, isFile: true },
        ];
      }
      // Subdirectory listings are empty (no nested entries needed here).
      return [];
    });

    const backend = new TauriFSBackend();
    await backend.setRootPath('/ws');
    const nodes = await backend.list('');
    const names = nodes.map((n) => n.name);

    // Ordinary dotfile now reaches the UI so "Show Hidden Files" can reveal it.
    expect(names).toContain('.gitignore');
    expect(names).toContain('README.md');
    expect(names).toContain('docs');
    // dot-directories still appear (unexpanded) and .trash keeps its handling.
    expect(names).toContain('.git');
    expect(names).toContain('.trash');
    // Lantern's internal config folder is never listed.
    expect(names).not.toContain('.lantern');
    // Shallow contract: list() reads ONLY the requested directory and never
    // walks into ANY subdirectory (so a huge .git can't slow load, no matter how
    // list() is called) — recursion is owned by WorkspaceService.listRecursive.
    expect(readDir).toHaveBeenCalledTimes(1);
    expect(readDir).toHaveBeenCalledWith('/ws');
    expect(nodes.find((n) => n.name === 'docs')?.children).toEqual([]);
  });
});

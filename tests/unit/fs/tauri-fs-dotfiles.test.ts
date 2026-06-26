/**
 * TauriFSBackend.list — desktop dotfile visibility (UX-21, pre-merge review).
 *
 * The desktop backend used to drop EVERY dot-prefixed entry before the UI saw
 * it, so "Show Hidden Files" could never reveal .gitignore and the hiddenNodes
 * helper never got a chance to act. The backend must now drop ONLY Keepance's
 * internal `.keepance` folder (never recursing into it) and let ordinary
 * dotfiles through for the UI/settings layer to decide, while keeping .trash.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const readDir = vi.fn();
const exists = vi.fn(async () => true);

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
          { name: '.keepance', isDirectory: true, isFile: false },
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
    const names = (await backend.list('')).map((n) => n.name);

    // Ordinary dotfile now reaches the UI so "Show Hidden Files" can reveal it.
    expect(names).toContain('.gitignore');
    expect(names).toContain('README.md');
    expect(names).toContain('docs');
    // .trash keeps its existing handling (still returned).
    expect(names).toContain('.trash');
    // Keepance's internal config folder is never listed...
    expect(names).not.toContain('.keepance');
    // ...and is never recursed into (no directory read for its path).
    expect(readDir).not.toHaveBeenCalledWith('/ws/.keepance');
  });
});

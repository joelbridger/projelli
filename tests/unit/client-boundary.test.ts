/**
 * Workstream D — Client boundary / cross-client detection helpers.
 *
 * Tests the pure functions in `src/platform/utils/client-boundary.ts` that determine
 * which top-level folders a set of AI-context file paths belong to, and
 * whether the set spans more than one "client" folder.
 *
 * All functions are stateless; no React, no stores, no mocks needed.
 */

import { describe, it, expect } from 'vitest';
import {
  getTopLevelFolder,
  getDistinctTopLevelFolders,
  detectCrossClientContext,
  ROOT_LEVEL_SENTINEL,
} from '@/platform/utils/client-boundary';

// ---------------------------------------------------------------------------
// getTopLevelFolder
// ---------------------------------------------------------------------------

describe('getTopLevelFolder', () => {
  const ROOT = '/home/jane/Lantern';

  it('returns the immediate child folder for a deeply nested file', () => {
    expect(
      getTopLevelFolder(`${ROOT}/Acme Corp/matter-1/discovery.md`, ROOT),
    ).toBe('Acme Corp');
  });

  it('returns the immediate child folder for a file one level deep', () => {
    expect(
      getTopLevelFolder(`${ROOT}/Acme Corp/brief.md`, ROOT),
    ).toBe('Acme Corp');
  });

  it('returns ROOT_LEVEL_SENTINEL for a file directly in the workspace root', () => {
    expect(
      getTopLevelFolder(`${ROOT}/notes.md`, ROOT),
    ).toBe(ROOT_LEVEL_SENTINEL);
  });

  it('returns null for a file outside the workspace root', () => {
    expect(
      getTopLevelFolder('/other/folder/doc.md', ROOT),
    ).toBeNull();
  });

  it('returns null when filePath is empty', () => {
    expect(getTopLevelFolder('', ROOT)).toBeNull();
  });

  it('returns null when workspaceRoot is empty', () => {
    expect(getTopLevelFolder(`${ROOT}/Acme/doc.md`, '')).toBeNull();
  });

  it('handles workspace root with trailing slash correctly', () => {
    expect(
      getTopLevelFolder(`${ROOT}/Acme Corp/doc.md`, `${ROOT}/`),
    ).toBe('Acme Corp');
  });

  it('handles folder names with spaces and special characters', () => {
    expect(
      getTopLevelFolder(`${ROOT}/Doe, John (Estate)/will.md`, ROOT),
    ).toBe('Doe, John (Estate)');
  });

  it('distinguishes two different client folders', () => {
    const folderA = getTopLevelFolder(`${ROOT}/Client A/file.md`, ROOT);
    const folderB = getTopLevelFolder(`${ROOT}/Client B/file.md`, ROOT);
    expect(folderA).toBe('Client A');
    expect(folderB).toBe('Client B');
    expect(folderA).not.toBe(folderB);
  });
});

// ---------------------------------------------------------------------------
// getDistinctTopLevelFolders
// ---------------------------------------------------------------------------

describe('getDistinctTopLevelFolders', () => {
  const ROOT = '/workspace';

  it('returns a single entry when all files are in the same folder', () => {
    const paths = [
      `${ROOT}/Client A/matter1/doc1.md`,
      `${ROOT}/Client A/matter1/doc2.md`,
      `${ROOT}/Client A/notes.md`,
    ];
    const result = getDistinctTopLevelFolders(paths, ROOT);
    expect(result.size).toBe(1);
    expect(result.has('Client A')).toBe(true);
  });

  it('returns two entries when files span two top-level folders', () => {
    const paths = [
      `${ROOT}/Client A/doc.md`,
      `${ROOT}/Client B/doc.md`,
    ];
    const result = getDistinctTopLevelFolders(paths, ROOT);
    expect(result.size).toBe(2);
    expect(result.has('Client A')).toBe(true);
    expect(result.has('Client B')).toBe(true);
  });

  it('returns three entries when files span three top-level folders', () => {
    const paths = [
      `${ROOT}/Alpha/doc.md`,
      `${ROOT}/Beta/sub/doc.md`,
      `${ROOT}/Gamma/doc.md`,
    ];
    const result = getDistinctTopLevelFolders(paths, ROOT);
    expect(result.size).toBe(3);
  });

  it('includes ROOT_LEVEL_SENTINEL for files at the workspace root', () => {
    const paths = [
      `${ROOT}/root-level-note.md`,
    ];
    const result = getDistinctTopLevelFolders(paths, ROOT);
    expect(result.has(ROOT_LEVEL_SENTINEL)).toBe(true);
  });

  it('mixes root-level files with client-folder files correctly', () => {
    const paths = [
      `${ROOT}/scratch.md`,
      `${ROOT}/Client A/doc.md`,
    ];
    const result = getDistinctTopLevelFolders(paths, ROOT);
    expect(result.size).toBe(2);
    expect(result.has(ROOT_LEVEL_SENTINEL)).toBe(true);
    expect(result.has('Client A')).toBe(true);
  });

  it('silently ignores paths outside the workspace root', () => {
    const paths = [
      `${ROOT}/Client A/doc.md`,
      '/outside/workspace/doc.md',
    ];
    const result = getDistinctTopLevelFolders(paths, ROOT);
    expect(result.size).toBe(1);
    expect(result.has('Client A')).toBe(true);
  });

  it('returns an empty set for an empty paths array', () => {
    expect(getDistinctTopLevelFolders([], ROOT).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// detectCrossClientContext
// ---------------------------------------------------------------------------

describe('detectCrossClientContext', () => {
  const ROOT = '/ws';

  it('returns isCrossClient=false when all files are in the same folder', () => {
    const paths = [
      `${ROOT}/Client A/matter1/doc.md`,
      `${ROOT}/Client A/matter2/doc.md`,
    ];
    const result = detectCrossClientContext(paths, ROOT);
    expect(result.isCrossClient).toBe(false);
    expect(result.folders).toEqual(['Client A']);
  });

  it('returns isCrossClient=true when files span two folders', () => {
    const paths = [
      `${ROOT}/Client A/doc.md`,
      `${ROOT}/Client B/doc.md`,
    ];
    const result = detectCrossClientContext(paths, ROOT);
    expect(result.isCrossClient).toBe(true);
    expect(result.folders).toContain('Client A');
    expect(result.folders).toContain('Client B');
    expect(result.folders).toHaveLength(2);
  });

  it('returns sorted folders list', () => {
    const paths = [
      `${ROOT}/Zeta Corp/doc.md`,
      `${ROOT}/Alpha LLC/doc.md`,
      `${ROOT}/Beta Inc/doc.md`,
    ];
    const result = detectCrossClientContext(paths, ROOT);
    expect(result.isCrossClient).toBe(true);
    expect(result.folders).toEqual(['Alpha LLC', 'Beta Inc', 'Zeta Corp']);
  });

  it('returns isCrossClient=false when no files are provided', () => {
    const result = detectCrossClientContext([], ROOT);
    expect(result.isCrossClient).toBe(false);
    expect(result.folders).toHaveLength(0);
  });

  it('returns isCrossClient=false when workspaceRoot is null', () => {
    const result = detectCrossClientContext(
      [`${ROOT}/Client A/doc.md`],
      null,
    );
    expect(result.isCrossClient).toBe(false);
    expect(result.folders).toHaveLength(0);
  });

  it('returns isCrossClient=false when workspaceRoot is undefined', () => {
    const result = detectCrossClientContext(
      [`${ROOT}/Client A/doc.md`],
      undefined,
    );
    expect(result.isCrossClient).toBe(false);
    expect(result.folders).toHaveLength(0);
  });

  it('handles a single file — no cross-client risk', () => {
    const paths = [`${ROOT}/Smith Tax 2024/return.md`];
    const result = detectCrossClientContext(paths, ROOT);
    expect(result.isCrossClient).toBe(false);
    expect(result.folders).toEqual(['Smith Tax 2024']);
  });

  it('correctly flags when root-level and client-folder files are mixed', () => {
    // A file at the workspace root + a file in a client folder = two distinct
    // top-level locations, so isCrossClient should be true.
    const paths = [
      `${ROOT}/scratch.md`,          // at workspace root
      `${ROOT}/Client A/brief.md`,   // in a client folder
    ];
    const result = detectCrossClientContext(paths, ROOT);
    expect(result.isCrossClient).toBe(true);
    expect(result.folders).toContain(ROOT_LEVEL_SENTINEL);
    expect(result.folders).toContain('Client A');
  });
});

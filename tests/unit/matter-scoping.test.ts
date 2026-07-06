/**
 * Workstream D, Phase 1 — Matter Scoping
 *
 * Tests for the pure scoping logic:
 *   - filterByScope (from client-boundary.ts)
 *   - getTopLevelFolderNames (from client-boundary.ts)
 *   - Integration with ExtractedContext (the shape AIChatViewer uses)
 *
 * All functions are stateless; no React, no stores, no mocks needed.
 */

import { describe, it, expect } from 'vitest';
import {
  filterByScope,
  getTopLevelFolderNames,
  ROOT_LEVEL_SENTINEL,
} from '@/platform/utils/client-boundary';
import type { ExtractedContext } from '@/platform/utils/ai-file-context';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(path: string): ExtractedContext {
  const fileName = path.split('/').pop() ?? path;
  return {
    fileName,
    path,
    extractedText: `Content of ${fileName}`,
    tokenEstimate: 10,
    truncated: false,
    sourceKind: 'text',
  };
}

// ---------------------------------------------------------------------------
// filterByScope
// ---------------------------------------------------------------------------

describe('filterByScope', () => {
  const ROOT = '/home/jane/Lantern';

  it('returns all paths unchanged when scopedFolder is null', () => {
    const paths = [
      `${ROOT}/Acme Corp/matter1/doc.md`,
      `${ROOT}/Beta Inc/brief.md`,
    ];
    expect(filterByScope(paths, ROOT, null)).toEqual(paths);
  });

  it('returns all paths unchanged when scopedFolder is undefined', () => {
    const paths = [
      `${ROOT}/Acme Corp/matter1/doc.md`,
      `${ROOT}/Beta Inc/brief.md`,
    ];
    expect(filterByScope(paths, ROOT, undefined)).toEqual(paths);
  });

  it('returns all paths unchanged when workspaceRoot is null', () => {
    const paths = [
      `${ROOT}/Acme Corp/matter1/doc.md`,
    ];
    expect(filterByScope(paths, null, 'Acme Corp')).toEqual(paths);
  });

  it('returns all paths unchanged when workspaceRoot is undefined', () => {
    const paths = [`${ROOT}/Acme Corp/doc.md`];
    expect(filterByScope(paths, undefined, 'Acme Corp')).toEqual(paths);
  });

  it('filters to only files inside the scoped folder', () => {
    const paths = [
      `${ROOT}/Acme Corp/matter1/discovery.md`,
      `${ROOT}/Acme Corp/matter2/brief.md`,
      `${ROOT}/Beta Inc/contract.md`,
    ];
    const result = filterByScope(paths, ROOT, 'Acme Corp');
    expect(result).toHaveLength(2);
    expect(result).toContain(`${ROOT}/Acme Corp/matter1/discovery.md`);
    expect(result).toContain(`${ROOT}/Acme Corp/matter2/brief.md`);
    expect(result).not.toContain(`${ROOT}/Beta Inc/contract.md`);
  });

  it('returns an empty array when no files match the scoped folder', () => {
    const paths = [
      `${ROOT}/Beta Inc/contract.md`,
      `${ROOT}/Gamma LLC/notes.md`,
    ];
    const result = filterByScope(paths, ROOT, 'Acme Corp');
    expect(result).toHaveLength(0);
  });

  it('handles deeply nested files within the scoped folder', () => {
    const paths = [
      `${ROOT}/Acme Corp/2024/Q1/depositions/exhibit-1.md`,
      `${ROOT}/Acme Corp/2024/Q2/motions/summary.md`,
      `${ROOT}/Beta Inc/invoice.md`,
    ];
    const result = filterByScope(paths, ROOT, 'Acme Corp');
    expect(result).toHaveLength(2);
    expect(result).not.toContain(`${ROOT}/Beta Inc/invoice.md`);
  });

  it('does not include files whose folder name starts with the scoped folder name', () => {
    // "Acme Corp Extra" should NOT match scope "Acme Corp"
    const paths = [
      `${ROOT}/Acme Corp/doc.md`,
      `${ROOT}/Acme Corp Extra/other.md`,
    ];
    const result = filterByScope(paths, ROOT, 'Acme Corp');
    expect(result).toHaveLength(1);
    expect(result).toContain(`${ROOT}/Acme Corp/doc.md`);
    expect(result).not.toContain(`${ROOT}/Acme Corp Extra/other.md`);
  });

  it('handles a workspace root with a trailing slash', () => {
    const paths = [
      `${ROOT}/Acme Corp/doc.md`,
      `${ROOT}/Beta Inc/doc.md`,
    ];
    const result = filterByScope(paths, `${ROOT}/`, 'Acme Corp');
    expect(result).toHaveLength(1);
    expect(result).toContain(`${ROOT}/Acme Corp/doc.md`);
  });

  it('returns an empty array for an empty paths array', () => {
    expect(filterByScope([], ROOT, 'Acme Corp')).toHaveLength(0);
  });

  it('handles folder names with spaces and special characters', () => {
    const paths = [
      `${ROOT}/Doe, John (Estate)/will.md`,
      `${ROOT}/Smith Tax 2024/return.md`,
    ];
    const result = filterByScope(paths, ROOT, 'Doe, John (Estate)');
    expect(result).toHaveLength(1);
    expect(result).toContain(`${ROOT}/Doe, John (Estate)/will.md`);
  });
});

// ---------------------------------------------------------------------------
// getTopLevelFolderNames
// ---------------------------------------------------------------------------

describe('getTopLevelFolderNames', () => {
  const ROOT = '/workspace';

  it('returns an empty array when workspaceRoot is null', () => {
    const paths = [`${ROOT}/Acme Corp/doc.md`];
    expect(getTopLevelFolderNames(paths, null)).toHaveLength(0);
  });

  it('returns an empty array when workspaceRoot is undefined', () => {
    const paths = [`${ROOT}/Acme Corp/doc.md`];
    expect(getTopLevelFolderNames(paths, undefined)).toHaveLength(0);
  });

  it('returns a sorted list of distinct top-level folders', () => {
    const paths = [
      `${ROOT}/Zeta Corp/doc.md`,
      `${ROOT}/Alpha LLC/doc.md`,
      `${ROOT}/Alpha LLC/other.md`,
      `${ROOT}/Beta Inc/doc.md`,
    ];
    const result = getTopLevelFolderNames(paths, ROOT);
    expect(result).toEqual(['Alpha LLC', 'Beta Inc', 'Zeta Corp']);
  });

  it('includes ROOT_LEVEL_SENTINEL for files at the workspace root', () => {
    const paths = [
      `${ROOT}/notes.md`,
      `${ROOT}/Acme Corp/doc.md`,
    ];
    const result = getTopLevelFolderNames(paths, ROOT);
    expect(result).toContain(ROOT_LEVEL_SENTINEL);
    expect(result).toContain('Acme Corp');
  });

  it('returns an empty array for an empty paths array', () => {
    expect(getTopLevelFolderNames([], ROOT)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: scoping ExtractedContext objects (the shape used in the UI)
// ---------------------------------------------------------------------------

describe('matter scoping with ExtractedContext objects', () => {
  const ROOT = '/Users/lawyer/Lantern';

  it('given a set of open files and a scopedFolder, returns only matching files', () => {
    const allFiles: ExtractedContext[] = [
      makeFile(`${ROOT}/Smith Estate/will.md`),
      makeFile(`${ROOT}/Smith Estate/trust-amendment.md`),
      makeFile(`${ROOT}/Jones Divorce/settlement.md`),
      makeFile(`${ROOT}/scratch.md`),
    ];

    const scopedPaths = new Set(
      filterByScope(allFiles.map((f) => f.path), ROOT, 'Smith Estate'),
    );
    const result = allFiles.filter((f) => scopedPaths.has(f.path));

    expect(result).toHaveLength(2);
    expect(result.map((f) => f.fileName)).toContain('will.md');
    expect(result.map((f) => f.fileName)).toContain('trust-amendment.md');
    expect(result.map((f) => f.fileName)).not.toContain('settlement.md');
    expect(result.map((f) => f.fileName)).not.toContain('scratch.md');
  });

  it('returns all files when scopedFolder is null (no scope)', () => {
    const allFiles: ExtractedContext[] = [
      makeFile(`${ROOT}/Smith Estate/will.md`),
      makeFile(`${ROOT}/Jones Divorce/settlement.md`),
    ];

    const scopedPaths = new Set(
      filterByScope(allFiles.map((f) => f.path), ROOT, null),
    );
    const result = allFiles.filter((f) => scopedPaths.has(f.path));

    expect(result).toHaveLength(2);
  });

  it('returns an empty result when the scoped folder has no open files', () => {
    const allFiles: ExtractedContext[] = [
      makeFile(`${ROOT}/Jones Divorce/settlement.md`),
    ];

    const scopedPaths = new Set(
      filterByScope(allFiles.map((f) => f.path), ROOT, 'Smith Estate'),
    );
    const result = allFiles.filter((f) => scopedPaths.has(f.path));

    expect(result).toHaveLength(0);
  });

  it('folder picker list excludes folders not present in the open files', () => {
    const openFiles: ExtractedContext[] = [
      makeFile(`${ROOT}/Alpha Client/doc.md`),
      makeFile(`${ROOT}/Beta Client/doc.md`),
    ];
    const folderNames = getTopLevelFolderNames(
      openFiles.map((f) => f.path),
      ROOT,
    );
    expect(folderNames).toEqual(['Alpha Client', 'Beta Client']);
    // "Gamma Client" is not in open files, so it should not appear
    expect(folderNames).not.toContain('Gamma Client');
  });

  it('workspace retrieval filtering: only hits inside scoped folder are kept', () => {
    // Simulate the @workspace retrieval hit-filtering logic in AIChatViewer
    const scopedFolder = 'Acme Corp';
    const allHitPaths = [
      `${ROOT}/Acme Corp/matter1/doc.md`,
      `${ROOT}/Acme Corp/matter2/notes.md`,
      `${ROOT}/Beta Inc/contract.md`,          // should be excluded
      `${ROOT}/scratch.md`,                     // should be excluded
    ];

    const filteredPaths = allHitPaths.filter((hitPath) => {
      const scoped = filterByScope([hitPath], ROOT, scopedFolder);
      return scoped.length > 0;
    });

    expect(filteredPaths).toHaveLength(2);
    expect(filteredPaths).toContain(`${ROOT}/Acme Corp/matter1/doc.md`);
    expect(filteredPaths).toContain(`${ROOT}/Acme Corp/matter2/notes.md`);
    expect(filteredPaths).not.toContain(`${ROOT}/Beta Inc/contract.md`);
    expect(filteredPaths).not.toContain(`${ROOT}/scratch.md`);
  });
});

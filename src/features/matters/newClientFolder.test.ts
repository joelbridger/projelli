/**
 * QA-5 (P1) — a brand-new client, created via "+ New client", must get a
 * usable, ISOLATED document location by default. The bug: the create dialog
 * passed no `folderPaths`, so a new client was scoped to nothing — every
 * document/import landed unscoped and the client's own Documents view showed
 * "No documents yet" even though the files existed on disk.
 *
 * These tests pin the derivation that gives each new client its own workspace
 * subfolder (matching how seeded clients are structured in
 * seedDemoClients.ts / seedWebDemoClientMap.ts: one folder per client under the
 * workspace root, named for the client).
 */
import { describe, it, expect } from 'vitest';
import { deriveNewClientFolderPath } from './matterManagerDialogHelpers';

describe('deriveNewClientFolderPath (QA-5)', () => {
  it('creates a per-client folder under the workspace root, named for the client', () => {
    expect(
      deriveNewClientFolderPath('The Brennan Household', 'Retirement plan', '/test-workspace', []),
    ).toBe('/test-workspace/The Brennan Household');
  });

  it('falls back to the matter name when the client field is blank', () => {
    expect(deriveNewClientFolderPath('', 'Estate matter', '/test-workspace', [])).toBe(
      '/test-workspace/Estate matter',
    );
  });

  it('normalizes a workspace root with trailing slash / backslashes', () => {
    expect(deriveNewClientFolderPath('Reyes', '', 'C:\\workspaces\\Northcrest\\', [])).toBe(
      'C:/workspaces/Northcrest/Reyes',
    );
  });

  it('uniquifies when a folder of that name is already linked to another client (isolation)', () => {
    expect(
      deriveNewClientFolderPath('Smith', 'x', '/ws', ['/ws/Smith']),
    ).toBe('/ws/Smith 2');
  });

  it('keeps uniquifying past the first collision', () => {
    expect(
      deriveNewClientFolderPath('Smith', 'x', '/ws', ['/ws/Smith', '/ws/Smith 2']),
    ).toBe('/ws/Smith 3');
  });

  it('treats collisions case-insensitively and across path separators', () => {
    expect(
      deriveNewClientFolderPath('Smith', 'x', '/ws', ['/ws/smith/']),
    ).toBe('/ws/Smith 2');
  });

  it('sanitizes path separators and illegal filename characters out of the folder name', () => {
    // Slashes/colons/etc. must never let a client escape its own subfolder.
    expect(deriveNewClientFolderPath('A/B: C*?', '', '/ws', [])).toBe('/ws/A B C');
  });

  it('uniquifies against a LEGACY RELATIVE folder that resolves to the same absolute path', () => {
    // The matter store allows a not-yet-touched matter to keep a workspace-
    // RELATIVE folderPath (e.g. 'Smith'). Resolved against the root it IS
    // '/ws/Smith', so a new "Smith" must not silently reuse that same folder
    // (Codex review: isolation hole).
    expect(deriveNewClientFolderPath('Smith', 'x', '/ws', ['Smith'])).toBe('/ws/Smith 2');
  });

  it('uniquifies against a legacy relative folder with subfolders + backslashes', () => {
    expect(deriveNewClientFolderPath('Reyes Household', 'x', 'C:/ws', ['Reyes Household'])).toBe(
      'C:/ws/Reyes Household 2',
    );
  });

  it('rejects a candidate that would ENGULF another client\'s nested folder', () => {
    // Matter scoping includes all descendants, so a new "Smith" scoped to
    // /ws/Smith would see an existing client's /ws/Smith/Docs (Codex review).
    expect(deriveNewClientFolderPath('Smith', 'x', '/ws', ['/ws/Smith/Docs'])).toBe('/ws/Smith 2');
  });

  it('rejects an engulfing candidate even when the nested folder is a legacy relative path', () => {
    expect(deriveNewClientFolderPath('Smith', 'x', '/ws', ['Smith/Docs'])).toBe('/ws/Smith 2');
  });

  it('does NOT treat the whole-workspace "everything" scope as a collision (no infinite loop)', () => {
    // A sample/all-matters client can be scoped to the workspace root itself.
    // A new client's per-client subfolder legitimately lives under it — the root
    // scope must not block it (and must not loop forever uniquifying).
    expect(deriveNewClientFolderPath('Smith', 'x', '/ws', ['/ws'])).toBe('/ws/Smith');
  });

  it('rejects a dot-only name (".", "..") that would collapse to the workspace/parent', () => {
    // '/ws/.' means the whole workspace and '/ws/..' the parent once the scope
    // resolver collapses dot segments — never a valid isolated client folder.
    expect(deriveNewClientFolderPath('.', '', '/ws', [])).toBeNull();
    expect(deriveNewClientFolderPath('..', '', '/ws', [])).toBeNull();
    expect(deriveNewClientFolderPath('...', '   ', '/ws', [])).toBeNull();
    // Falls through to the matter name when the client is dot-only.
    expect(deriveNewClientFolderPath('..', 'Estate', '/ws', [])).toBe('/ws/Estate');
  });

  it('strips trailing dots/spaces (invalid on Windows) from the folder name', () => {
    expect(deriveNewClientFolderPath('Acme Corp.', '', '/ws', [])).toBe('/ws/Acme Corp');
  });

  it('returns null when no workspace is open (nothing to scope to)', () => {
    expect(deriveNewClientFolderPath('Smith', 'x', null, [])).toBeNull();
  });

  it('returns null when both the client and matter names are empty', () => {
    expect(deriveNewClientFolderPath('   ', '  ', '/ws', [])).toBeNull();
  });
});

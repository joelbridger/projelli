/**
 * resolveMatterIdForWorkspacePath — Windows path-shape regression (smoke-2
 * P0 #5 retest, docs/evidence/windows-smoke-2/RUN-LOG.md).
 *
 * On real Windows, "Send to Wealthbox" never rendered for a normal client
 * note whose folder mapping was independently confirmed correct: MainPanel
 * gates the button on `resolveMatterIdForWorkspacePath(tab.path, rootPath)`
 * resolving to a real matter id, and that call returned `unassigned` for the
 * open tab.
 *
 * Root cause: `resolveMatterIdForWorkspacePath` (used by MainPanel for the
 * docx toolbar) and `resolveMatterIdWithWorkspaceForms` (registered as the
 * RAG indexer's matter resolver, `setMatterResolver`) are two independently
 * maintained implementations of the same "resolve a workspace path to a
 * matter" operation. The toolbar's resolver used its own ad-hoc
 * `isAbsoluteWorkspacePath` / `buildWorkspaceAbsolutePath` instead of the
 * canonical, Windows-hardened primitives in `appPath.ts` (the same module
 * `Matter.folderPaths` is itself canonicalized through), and it never tried
 * the workspace-relative fallback form the RAG resolver does. Two
 * implementations of a confidentiality-boundary check WILL drift — this is
 * the same class of bug fixed hours earlier in commit 334412ec
 * (classifyEstateSource's ad-hoc colon check rejecting Windows drive-letter
 * paths instead of using the canonical scheme-prefix check).
 *
 * These tests exercise the real seam (`resolveMatterIdForWorkspacePath`,
 * imported unmodified) rather than a copy of its internals.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveMatterIdForWorkspacePath } from '@/platform/hooks/useMemoryWiring';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { UNASSIGNED_MATTER_ID } from '@/platform/types/matter';

describe('resolveMatterIdForWorkspacePath — Windows path shapes', () => {
  beforeEach(() => {
    useMatterStore.setState({ matters: [], activeMatterId: null });
    useWorkspaceStore.setState({ rootPath: null } as any);
  });

  function setupCaldwellMatter(rootPath: string, folderRelative = 'Clients/Caldwell, Jennifer') {
    useWorkspaceStore.getState().setRootPath(rootPath);
    const { createMatter, addFolderPath } = useMatterStore.getState();
    const matter = createMatter({ name: 'Caldwell, Jennifer', client: 'Caldwell, Jennifer' });
    addFolderPath(matter.id, folderRelative);
    return matter;
  }

  it('resolves an open docx tab under a Windows-native (backslash, drive-letter) workspace root — the bench repro shape', () => {
    const rootPath = 'C:\\lantern-plus-smoke\\Northcrest Wealth Partners';
    const matter = setupCaldwellMatter(rootPath);

    const tabPath =
      'Clients/Caldwell, Jennifer/Planning/Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx';
    const result = resolveMatterIdForWorkspacePath(tabPath, useWorkspaceStore.getState().rootPath);

    expect(result).toBe(matter.id);
    expect(result).not.toBe(UNASSIGNED_MATTER_ID);
  });

  it('treats a single leading backslash as an absolute (drive-root-relative) path and does NOT silently join it onto rootPath', () => {
    // Windows semantics: a path starting with a single `\` means "root of
    // the CURRENT drive", not "workspace-relative" — joining it onto
    // rootPath would produce a path pointing somewhere the file isn't. The
    // canonical `isAbsolutePath` (appPath.ts) correctly classifies this as
    // absolute; the resolver must fail closed (unassigned) rather than
    // guess, exactly like it does for any other absolute path that matches
    // no matter folder.
    setupCaldwellMatter('C:\\lantern-plus-smoke\\Northcrest Wealth Partners');
    const tabPath =
      '\\Clients/Caldwell, Jennifer/Planning/Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx';
    const result = resolveMatterIdForWorkspacePath(tabPath, useWorkspaceStore.getState().rootPath);

    expect(result).toBe(UNASSIGNED_MATTER_ID);
  });

  it('resolves via the workspace-relative fallback when given an ALREADY-ABSOLUTE path under the current root (the RAG resolver path MainPanel\'s resolver did not try)', () => {
    const rootPath = 'C:\\lantern-plus-smoke\\Northcrest Wealth Partners';
    const matter = setupCaldwellMatter(rootPath);

    // Some callers pass a fully-resolved absolute path (e.g. citation
    // click-through, backend-reported path) rather than a workspace-relative
    // tab path. The unified resolver must handle both shapes identically.
    const absoluteTabPath =
      'C:/lantern-plus-smoke/Northcrest Wealth Partners/Clients/Caldwell, Jennifer/Planning/Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx';
    const result = resolveMatterIdForWorkspacePath(absoluteTabPath, useWorkspaceStore.getState().rootPath);

    expect(result).toBe(matter.id);
  });

  it('stays unassigned for a file genuinely outside every matter folder (no false positive)', () => {
    setupCaldwellMatter('C:\\lantern-plus-smoke\\Northcrest Wealth Partners');

    const tabPath = 'Clients/Someone Else/Planning/Notes.docx';
    const result = resolveMatterIdForWorkspacePath(tabPath, useWorkspaceStore.getState().rootPath);

    expect(result).toBe(UNASSIGNED_MATTER_ID);
  });

  it('stays unassigned (fails closed, not open) for a case-only segment collision — matter isolation must never guess', () => {
    setupCaldwellMatter('C:\\lantern-plus-smoke\\Northcrest Wealth Partners');

    // A workspace root whose directory segments differ in case from the
    // folder the matter was mapped against is a genuine identity question,
    // not a formatting difference — resolving it would risk leaking one
    // client's file into another client's scope on a case-sensitive volume.
    useWorkspaceStore.getState().setRootPath('c:\\lantern-plus-smoke\\northcrest wealth partners');
    const tabPath =
      'Clients/Caldwell, Jennifer/Planning/Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx';
    const result = resolveMatterIdForWorkspacePath(tabPath, useWorkspaceStore.getState().rootPath);

    expect(result).toBe(UNASSIGNED_MATTER_ID);
  });

  it('an ambiguous canonical (absolute) match stays unassigned even when a legacy relative folderPaths entry would otherwise resolve cleanly (Codex review finding)', () => {
    const rootPath = 'C:\\lantern-plus-smoke\\Northcrest Wealth Partners';
    useWorkspaceStore.getState().setRootPath(rootPath);
    const { createMatter } = useMatterStore.getState();

    const sharedFolder = 'C:/lantern-plus-smoke/Northcrest Wealth Partners/Clients/Caldwell, Jennifer';
    // Two DIFFERENT matters independently claim the exact same absolute
    // folder (e.g. a bulk/manual folder remap wrote a duplicate claim) — a
    // genuine identity conflict the resolver must fail closed on.
    const matterA = createMatter({ name: 'Caldwell, Jennifer (A)', client: 'Caldwell, Jennifer' });
    const matterB = createMatter({ name: 'Caldwell, Jennifer (B)', client: 'Caldwell, Jennifer' });
    useMatterStore.setState((state) => ({
      matters: state.matters.map((m) =>
        m.id === matterA.id || m.id === matterB.id
          ? { ...m, folderPaths: [sharedFolder] }
          : m,
      ),
    }));
    // matterA ALSO carries a stale, legacy RELATIVE folderPaths entry for the
    // same client folder (e.g. left over from before folderPaths were always
    // canonicalized to absolute — see matterStore.ts's resolveAbsolute doc
    // comment). Trying the relative form of the same tab path must not let
    // this stale entry override the absolute form's ambiguity finding.
    useMatterStore.setState((state) => ({
      matters: state.matters.map((m) =>
        m.id === matterA.id
          ? { ...m, folderPaths: [...m.folderPaths, 'Clients/Caldwell, Jennifer'] }
          : m,
      ),
    }));

    const tabPath =
      'Clients/Caldwell, Jennifer/Planning/Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx';
    const result = resolveMatterIdForWorkspacePath(tabPath, useWorkspaceStore.getState().rootPath);

    expect(result).toBe(UNASSIGNED_MATTER_ID);
  });

  it('stays unassigned when one matter holds a legacy RELATIVE claim and another holds the canonical ABSOLUTE claim for the SAME physical folder (Codex review round 2 finding)', () => {
    const rootPath = 'C:\\lantern-plus-smoke\\Northcrest Wealth Partners';
    useWorkspaceStore.getState().setRootPath(rootPath);
    const { createMatter } = useMatterStore.getState();

    // matterA: canonical absolute claim (the normal shape addFolderPath writes).
    const matterA = createMatter({ name: 'Caldwell, Jennifer (A)', client: 'Caldwell, Jennifer' });
    useMatterStore.setState((state) => ({
      matters: state.matters.map((m) =>
        m.id === matterA.id
          ? { ...m, folderPaths: ['C:/lantern-plus-smoke/Northcrest Wealth Partners/Clients/Caldwell, Jennifer'] }
          : m,
      ),
    }));
    // matterB: a stale/legacy RELATIVE claim for the exact same real folder
    // (e.g. left over from before folderPaths were always canonicalized to
    // absolute — matterStore.ts's resolveAbsolute doc comment). Naively
    // comparing raw string lengths would make matterA's absolute claim
    // "longer" and silently win; canonicalizing both to the same coordinate
    // system must reveal they're the same folder and fail closed.
    const matterB = createMatter({ name: 'Caldwell, Jennifer (B)', client: 'Caldwell, Jennifer' });
    useMatterStore.setState((state) => ({
      matters: state.matters.map((m) =>
        m.id === matterB.id ? { ...m, folderPaths: ['Clients/Caldwell, Jennifer'] } : m,
      ),
    }));

    const tabPath =
      'Clients/Caldwell, Jennifer/Planning/Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx';
    const result = resolveMatterIdForWorkspacePath(tabPath, useWorkspaceStore.getState().rootPath);

    expect(result).toBe(UNASSIGNED_MATTER_ID);
  });

  it('stays unassigned when one claim has a redundant double slash and the other is cleanly spelled for the SAME physical folder (Codex review round 3 finding)', () => {
    const rootPath = 'C:\\lantern-plus-smoke\\Northcrest Wealth Partners';
    useWorkspaceStore.getState().setRootPath(rootPath);
    const { createMatter } = useMatterStore.getState();

    const matterA = createMatter({ name: 'Caldwell, Jennifer (A)', client: 'Caldwell, Jennifer' });
    const matterB = createMatter({ name: 'Caldwell, Jennifer (B)', client: 'Caldwell, Jennifer' });
    useMatterStore.setState((state) => ({
      matters: state.matters.map((m) => {
        if (m.id === matterA.id) {
          return { ...m, folderPaths: ['C:/lantern-plus-smoke/Northcrest Wealth Partners/Clients/Caldwell, Jennifer'] };
        }
        if (m.id === matterB.id) {
          // Redundant internal separator — `isPathInFolder` treats this as the
          // SAME folder as matterA's (sameOrInside collapses duplicate
          // slashes), so the specificity length used to break the tie must
          // agree, or this "longer" spelling would silently win instead of
          // the genuine ambiguity failing closed.
          return { ...m, folderPaths: ['C:/lantern-plus-smoke/Northcrest Wealth Partners/Clients//Caldwell, Jennifer'] };
        }
        return m;
      }),
    }));

    const tabPath =
      'Clients/Caldwell, Jennifer/Planning/Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx';
    const result = resolveMatterIdForWorkspacePath(tabPath, useWorkspaceStore.getState().rootPath);

    expect(result).toBe(UNASSIGNED_MATTER_ID);
  });
});

/**
 * QA-5 (P1) end-to-end guard — a client created the "+ New client" way must end
 * up with a usable, ISOLATED document location, so files added to it appear in
 * its Documents view (the bug was the opposite: zero folders linked → every
 * file unscoped → "No documents yet").
 *
 * This wires the real pieces the dialog uses together WITHOUT rendering React:
 *   deriveNewClientFolderPath  →  matterStore.createMatter  →  scopeFileTreeToFolders
 * i.e. exactly the chain from "+ New client" to what the client's Documents grid
 * renders. It asserts the new client (a) is scoped to its own folder and (b)
 * sees its own files while NOT seeing another client's files.
 */
import { beforeEach, describe, it, expect } from 'vitest';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { deriveNewClientFolderPath } from '@/features/matters/matterManagerDialogHelpers';
import { scopeFileTreeToFolders } from '@/features/documents/scopeFileTree';
import { resolveMatterId } from '@/platform/rag/matterResolver';
import type { FileNode } from '@/platform/types/workspace';

const ROOT = '/test-workspace';

function folder(name: string, children: FileNode[] = []): FileNode {
  return { id: `${ROOT}/${name}`, name, path: `${ROOT}/${name}`, type: 'folder', children };
}
function file(parent: string, name: string): FileNode {
  return { id: `${ROOT}/${parent}/${name}`, name, path: `${ROOT}/${parent}/${name}`, type: 'file' };
}

/** Mirror MatterManagerDialog.handleCreate's store-side effect. */
function createClientLikeDialog(clientName: string, matterName: string) {
  const { rootPath } = useWorkspaceStore.getState();
  const taken = useMatterStore.getState().matters.flatMap((m) => m.folderPaths);
  const clientFolder = deriveNewClientFolderPath(clientName, matterName, rootPath, taken);
  return useMatterStore.getState().createMatter({
    name: matterName,
    client: clientName,
    ...(clientFolder ? { folderPaths: [clientFolder] } : {}),
  });
}

describe('QA-5: a new client is scoped to its own folder end-to-end', () => {
  beforeEach(() => {
    useMatterStore.setState({ matters: [], activeMatterId: null });
    useWorkspaceStore.setState({ rootPath: ROOT });
  });

  it('gives a brand-new client a non-empty, per-client folderPaths', () => {
    const m = createClientLikeDialog('The Reyes Household', 'Retirement plan');
    expect(m.folderPaths).toEqual(['/test-workspace/The Reyes Household']);
  });

  it("surfaces the new client's own files and hides another client's files", () => {
    const reyes = createClientLikeDialog('Reyes', 'Reyes plan');

    // A workspace where each client has its own folder + a document inside.
    const tree: FileNode[] = [
      folder('Reyes', [file('Reyes', 'Reyes IPS.docx')]),
      folder('Okafor', [file('Okafor', 'Okafor Trust.docx')]),
    ];

    const scoped = scopeFileTreeToFolders(tree, reyes.folderPaths);
    const names: string[] = [];
    const walk = (ns: FileNode[]) => {
      ns.forEach((n) => { names.push(n.name); if (n.children) walk(n.children); });
    };
    walk(scoped);

    // The new client sees its own document (Documents view is NOT empty)...
    expect(names).toContain('Reyes IPS.docx');
    // ...and never sees the other client's document (matter isolation holds).
    expect(names).not.toContain('Okafor Trust.docx');
  });

  it('does not collide two same-named clients onto one folder', () => {
    const a = createClientLikeDialog('Smith', 'Smith A');
    const b = createClientLikeDialog('Smith', 'Smith B');
    expect(a.folderPaths[0]).not.toBe(b.folderPaths[0]);
    expect(b.folderPaths).toEqual(['/test-workspace/Smith 2']);
  });
});

describe('QA-24 (P1): duplicate-submission race can never bind two matters to one folder', () => {
  beforeEach(() => {
    useMatterStore.setState({ matters: [], activeMatterId: null });
    useWorkspaceStore.setState({ rootPath: ROOT });
  });

  /**
   * Reproduces the triple-click bug directly at the store layer: two rapid
   * "Create client" submissions both read the SAME stale `matters` snapshot
   * (React hadn't re-rendered between them yet), so both independently derive
   * the identical "free" candidate folder and both call `createMatter` with
   * that same `folderPaths`. `deriveNewClientFolderPath`'s own uniqueness
   * check can't catch this — it only sees each call in isolation. The store's
   * `createMatter` must be the backstop that re-verifies against the LIVE
   * matters array at actual write time, however the caller got there.
   */
  it('createMatter re-verifies against live state and auto-suffixes a colliding folder, even when two calls are handed the identical candidate', () => {
    const staleTaken: string[] = []; // both "clicks" see this same (empty) snapshot
    const clientFolder = deriveNewClientFolderPath('Klutz Test Client', 'Klutz Test Client', ROOT, staleTaken);
    expect(clientFolder).toBe('/test-workspace/Klutz Test Client');

    const first = useMatterStore.getState().createMatter({
      name: 'Klutz Test Client',
      client: 'Klutz Test Client',
      folderPaths: [clientFolder!],
    });
    // Second "click" computed the exact same candidate from the same stale
    // snapshot — this is the race, not a caller bug.
    const second = useMatterStore.getState().createMatter({
      name: 'Klutz Test Client',
      client: 'Klutz Test Client',
      folderPaths: [clientFolder!],
    });

    expect(useMatterStore.getState().matters).toHaveLength(2);
    expect(first.folderPaths[0]).toBe('/test-workspace/Klutz Test Client');
    // The deeper fix: the store itself must never let two matters end up with
    // the exact same folder, regardless of what the caller passed in.
    expect(second.folderPaths[0]).not.toBe(first.folderPaths[0]);
    expect(second.folderPaths).toEqual(['/test-workspace/Klutz Test Client 2']);
  });

  it('a third racing submission also gets its own unique folder (not just the second)', () => {
    const clientFolder = '/test-workspace/Klutz Test Client';
    const one = useMatterStore.getState().createMatter({ name: 'K', client: 'Klutz Test Client', folderPaths: [clientFolder] });
    const two = useMatterStore.getState().createMatter({ name: 'K', client: 'Klutz Test Client', folderPaths: [clientFolder] });
    const three = useMatterStore.getState().createMatter({ name: 'K', client: 'Klutz Test Client', folderPaths: [clientFolder] });

    const folders = [one, two, three].map((m) => m.folderPaths[0]);
    expect(new Set(folders).size).toBe(3);
  });

  it('files created inside each duplicate resolve unambiguously to that duplicate — the actual user-visible bug', () => {
    const clientFolder = '/test-workspace/Klutz Test Client';
    const dup1 = useMatterStore.getState().createMatter({ name: 'K', client: 'Klutz Test Client', folderPaths: [clientFolder] });
    const dup2 = useMatterStore.getState().createMatter({ name: 'K', client: 'Klutz Test Client', folderPaths: [clientFolder] });

    const matters = useMatterStore.getState().matters;
    const fileInDup1 = `${dup1.folderPaths[0]}/notes.docx`;
    const fileInDup2 = `${dup2.folderPaths[0]}/notes.docx`;

    // Before the fix, both matters shared the identical folder, so the
    // resolver's fail-closed ambiguity guard returned UNASSIGNED for every
    // file under it — files vanished from BOTH duplicates' Documents view.
    expect(resolveMatterId(fileInDup1, matters)).toBe(dup1.id);
    expect(resolveMatterId(fileInDup2, matters)).toBe(dup2.id);
  });

  it('does not disturb the legitimate whole-workspace sample-matter folder pattern', () => {
    // The sample/onboarding matter intentionally owns the ENTIRE workspace
    // root; per-client matters live nested inside it. That's containment, not
    // an exact-folder collision, and must never be suffixed away.
    const sample = useMatterStore.getState().createMatter({
      id: 'matter_sample_x',
      name: 'Sample',
      client: 'Sample',
      folderPaths: [ROOT],
      isSample: true,
    });
    const client = createClientLikeDialog('Reyes', 'Reyes plan');

    expect(sample.folderPaths).toEqual([ROOT]);
    expect(client.folderPaths).toEqual(['/test-workspace/Reyes']);
  });
});

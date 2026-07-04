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

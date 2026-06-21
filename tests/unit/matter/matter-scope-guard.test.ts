/**
 * BUG-036 / BUG-037 — shared matter-scope guard for the AI's file tools and
 * open-file context. A chat scoped to one matter must not be able to read,
 * search, write, or inject another matter's files.
 */
import { describe, it, expect } from 'vitest';
import { pathInMatterScope } from '@/platform/matter/matterScopeGuard';
import type { Matter } from '@/platform/types/matter';

const matterA = { id: 'A', name: 'Acme v. Beta', folderPaths: ['/ws/Acme'] } as Matter;
const matterB = { id: 'B', name: 'Garcia v. Meridian', folderPaths: ['/ws/Garcia'] } as Matter;
// A nested sub-mapping: a subfolder of Acme actually belongs to matter C.
const matterC = { id: 'C', name: 'Shared Co-counsel', folderPaths: ['/ws/Acme/co-counsel'] } as Matter;
const matterNoFolders = { id: 'D', name: 'Mail-only matter', folderPaths: [] } as Matter;
const matters = [matterA, matterB, matterC, matterNoFolders];

describe('pathInMatterScope', () => {
  it('all-matters scope (null) allows any path', () => {
    expect(pathInMatterScope('/ws/Acme/secret.docx', null, matters)).toBe(true);
    expect(pathInMatterScope('/ws/Garcia/deposition.md', null, matters)).toBe(true);
    expect(pathInMatterScope('/ws/loose-file.txt', null, matters)).toBe(true);
  });

  it('allows a file inside the active matter folder', () => {
    expect(pathInMatterScope('/ws/Acme/contract.docx', 'A', matters)).toBe(true);
    expect(pathInMatterScope('/ws/Acme/sub/deep.md', 'A', matters)).toBe(true);
  });

  it('DENIES a file that belongs to a different matter (the core leak)', () => {
    expect(pathInMatterScope('/ws/Garcia/deposition.md', 'A', matters)).toBe(false);
    expect(pathInMatterScope('/ws/Acme/contract.docx', 'B', matters)).toBe(false);
  });

  it('DENIES a file outside every matter (unassigned)', () => {
    expect(pathInMatterScope('/ws/loose-file.txt', 'A', matters)).toBe(false);
    expect(pathInMatterScope('/ws/Other/x.md', 'B', matters)).toBe(false);
  });

  it('respects the LONGEST mapped folder (nested sub-mapping wins)', () => {
    // /ws/Acme/co-counsel belongs to matter C, not A — even though it is under
    // Acme's folder. While scoped to A, that nested file must be denied.
    expect(pathInMatterScope('/ws/Acme/co-counsel/brief.docx', 'A', matters)).toBe(false);
    expect(pathInMatterScope('/ws/Acme/co-counsel/brief.docx', 'C', matters)).toBe(true);
  });

  it('a matter with no mapped folders owns no files (everything denied while active)', () => {
    expect(pathInMatterScope('/ws/Acme/contract.docx', 'D', matters)).toBe(false);
    expect(pathInMatterScope('/ws/anything.md', 'D', matters)).toBe(false);
  });

  it('fails closed on ".." traversal — even in all-matters scope', () => {
    // A path that string-prefix-matches the matter folder but escapes via "..".
    expect(pathInMatterScope('/ws/Acme/../Garcia/secret.md', 'A', matters)).toBe(false);
    // And rejected even with no active matter (all-matters), so tools can't use it.
    expect(pathInMatterScope('/ws/Acme/../Garcia/secret.md', null, matters)).toBe(false);
    expect(pathInMatterScope('/ws/../etc/passwd', null, matters)).toBe(false);
  });
});

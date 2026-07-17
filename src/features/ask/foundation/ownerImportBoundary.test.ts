import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
// Drives the SHARED feature-boundary guard read-only. We do NOT modify the guard
// or its config (that is a separate coordinator-owned tooling lane). When that
// lane extends the guard to cover src/app/ and the fixtures tree, the two
// "pending" assertions below flip from red to green automatically.
// @ts-expect-error - the shared boundary guard is a plain .mjs with no type declarations
import { findBoundaryViolations as findBoundaryViolationsJs } from '../../../../scripts/check-boundaries.mjs';

type BoundaryViolation = {
  readonly file: string;
  readonly specifier: string;
  readonly message: string;
};
const findBoundaryViolations = findBoundaryViolationsJs as (options: {
  repoRoot: string;
}) => readonly BoundaryViolation[];

const OWNER_IMPORT = '@/features/ask/foundation/owner';
let repoRoot = '';
let violationFiles: string[] = [];

function write(root: string, rel: string, body: string) {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
}

describe('owner-binding deep-import boundary (shared guard)', () => {
  beforeAll(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'ask-owner-boundary-'));
    // Minimal feature skeleton: Ask with an internal owner module + public barrel
    // that does NOT re-export it.
    write(
      repoRoot,
      'src/features/ask/foundation/owner.ts',
      'export function createAskSharedClientOwner() {\n  return { bind() {}, release() {} };\n}\n'
    );
    write(
      repoRoot,
      'src/features/ask/index.ts',
      "export const askPublicSurface = true;\n"
    );
    // CONTROL: a sibling feature deep-importing the owner is a violation TODAY.
    write(
      repoRoot,
      'src/features/sibling/consumer.ts',
      `import { createAskSharedClientOwner } from '${OWNER_IMPORT}';\nvoid createAskSharedClientOwner;\n`
    );
    // PENDING: an app-shell file deep-importing the owner. src/app already imports
    // Ask today, so this is real code that must be forbidden too.
    write(
      repoRoot,
      'src/app/consumer.ts',
      `import { createAskSharedClientOwner } from '${OWNER_IMPORT}';\nvoid createAskSharedClientOwner;\n`
    );
    // PENDING: a fixtures-tree file (the family the outside consumer tests use)
    // deep-importing the owner.
    write(
      repoRoot,
      'src/foundation-contracts/ask/consumer.ts',
      `import { createAskSharedClientOwner } from '${OWNER_IMPORT}';\nvoid createAskSharedClientOwner;\n`
    );

    violationFiles = findBoundaryViolations({ repoRoot }).map((v) => v.file);
  });

  afterAll(() => {
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('control: a SIBLING feature deep-importing the owner IS flagged today', () => {
    expect(violationFiles).toContain('src/features/sibling/consumer.ts');
  });

  it('src/app deep-import of the owner is forbidden (auto-greens when the shared guard fix lands)', () => {
    // REQUIREMENT (not weakened): a file under src/app/ that deep-imports the
    // owner-binding must be a boundary violation. RED until the shared guard fix
    // extends coverage to src/app/.
    expect(violationFiles).toContain('src/app/consumer.ts');
  });

  it('fixtures-tree deep-import of the owner is forbidden (auto-greens when the shared guard fix lands)', () => {
    // REQUIREMENT (not weakened): a file in the foundation-contracts fixtures
    // tree that deep-imports the owner-binding must be a boundary violation. RED
    // until the shared guard fix extends coverage to the fixtures tree.
    expect(violationFiles).toContain('src/foundation-contracts/ask/consumer.ts');
  });
});

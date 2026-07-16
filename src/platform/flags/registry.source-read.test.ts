import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const registryPath = path.resolve(process.cwd(), 'src/platform/flags/registry.ts');

// This guard deliberately reads production source rather than importing it.
// The impact selector must classify it as opaque/always-run, including when
// Node's fs.promises binding is aliased.
test('the CRM shell flag keeps its owning lane', async () => {
  const registry = await fs.readFile(registryPath, 'utf8');

  // The registry converted to one-line defineFlag(id, description, ownerLane, ...) form
  // (merge-union adoption 2026-07-16); the proof stays: flag id present with its owning
  // lane as the third argument of the same descriptor line.
  expect(registry).toContain("defineFlag('crm-shell-v1'");
  expect(registry).toMatch(/defineFlag\('crm-shell-v1',[^)]*'crm-shell-v1',/);
});

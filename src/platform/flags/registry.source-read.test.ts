import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const registryPath = path.resolve(process.cwd(), 'src/platform/flags/registry.ts');

// This guard deliberately reads production source rather than importing it.
// The impact selector must classify it as opaque/always-run, including when
// Node's fs.promises binding is aliased.
test('the CRM shell flag keeps its owning lane', async () => {
  const registry = await fs.readFile(registryPath, 'utf8');

  expect(registry).toContain("id: 'crm-shell-v1'");
  expect(registry).toContain("ownerLane: 'crm-shell-v1'");
});

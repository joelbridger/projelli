#!/usr/bin/env node
/**
 * Keeps the committed egress inventory honest.
 *
 * The snapshot is generated from the two policy registries. The companion
 * inventory records the receipt and Offline Mode boundary test that covers
 * every registry operation. Adding a capability now needs all three updates:
 * registry → generated snapshot → named tests in the inventory.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const rustRegistryPath = join(repoRoot, 'src-tauri/src/network_policy.rs');
const rendererRegistryPath = join(repoRoot, 'src/platform/privacy/egressRegistry.ts');
const snapshotPath = join(repoRoot, 'scripts/contracts/egress-registry.snapshot.json');
const inventoryPath = join(repoRoot, 'scripts/contracts/egress-inventory.json');

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function readRustOperations() {
  const source = readFileSync(rustRegistryPath, 'utf8');
  const registry = source.match(/pub const EGRESS_OPERATION_REGISTRY:[\s\S]*?\];/)?.[0];
  if (!registry) throw new Error('Could not find EGRESS_OPERATION_REGISTRY in network_policy.rs');

  const constants = [...registry.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*,/gm)].map((match) => match[1]);
  const operations = [];
  for (const constant of constants) {
    const declaration = source.match(
      new RegExp(`pub const ${constant}: EgressOperation = EgressOperation \\{([\\s\\S]*?)\\n\\};`),
    )?.[1];
    const id = declaration?.match(/\bid:\s*"([^"]+)"/)?.[1];
    if (!id) throw new Error(`Could not find id for Rust operation ${constant}`);
    operations.push(id);
  }
  return uniqueSorted(operations);
}

function readRendererOperations() {
  const source = readFileSync(rendererRegistryPath, 'utf8');
  const initialOperations = source.match(/const initialOperations = \[([\s\S]*?)\] as const/)?.[1];
  if (!initialOperations) throw new Error('Could not find initialOperations in egressRegistry.ts');
  return uniqueSorted([...initialOperations.matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1]));
}

export function generatedRegistrySnapshot() {
  return {
    version: 1,
    rust: readRustOperations(),
    renderer: readRendererOperations(),
  };
}

function stableJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateInventory(snapshot) {
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const failures = [];
  for (const kind of ['rust', 'renderer']) {
    const section = inventory[kind];
    if (!section || !Array.isArray(section.operations)) {
      failures.push(`inventory.${kind}.operations must be an array`);
      continue;
    }
    // Each registry has one exhaustive receipt and boundary test. The tests
    // iterate its live registry, so an operation cannot be added without being
    // covered. Keeping their names once per registry makes this inventory easy
    // to review while still making the test requirements explicit.
    const entries = section.operations.map((id) => ({
      id,
      receiptTest: section.receiptTest,
      boundaryTest: section.boundaryTest,
    }));
    const ids = uniqueSorted(entries.map((entry) => entry.id));
    if (!sameStrings(ids, snapshot[kind])) {
      const missing = snapshot[kind].filter((id) => !ids.includes(id));
      const stale = ids.filter((id) => !snapshot[kind].includes(id));
      if (missing.length) failures.push(`${kind} inventory is missing: ${missing.join(', ')}`);
      if (stale.length) failures.push(`${kind} inventory is stale: ${stale.join(', ')}`);
    }
    for (const entry of entries) {
      if (!entry.receiptTest || !entry.boundaryTest) {
        failures.push(`${kind}:${entry.id} needs both receiptTest and boundaryTest`);
      }
      for (const testPath of [entry.receiptTest, entry.boundaryTest].filter(Boolean)) {
        const file = testPath.split('::')[0];
        if (!existsSync(join(repoRoot, file))) {
          failures.push(`${kind}:${entry.id} names missing test file ${file}`);
        }
      }
    }
  }
  return failures;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const snapshot = generatedRegistrySnapshot();
  if (process.argv.includes('--write')) {
    writeFileSync(snapshotPath, stableJson(snapshot));
    console.log(`✅ Wrote ${snapshotPath.replace(`${repoRoot}/`, '')}.`);
    process.exit(0);
  }

  const failures = [];
  if (!existsSync(snapshotPath)) {
    failures.push('Generated registry snapshot is missing. Run node scripts/check-egress-registry.mjs --write.');
  } else {
    const committed = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    if (stableJson(committed) !== stableJson(snapshot)) {
      failures.push('Generated registry snapshot is stale. Run node scripts/check-egress-registry.mjs --write and update the egress inventory tests.');
    }
  }
  failures.push(...validateInventory(snapshot));

  if (failures.length) {
    console.error('❌ Egress registry/inventory proof failed:');
    for (const failure of failures) console.error(`   - ${failure}`);
    process.exit(1);
  }
  console.log(`✅ Egress registry snapshot matches inventory (${snapshot.rust.length} native, ${snapshot.renderer.length} renderer operations; all name receipt + boundary tests).`);
}

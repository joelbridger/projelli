#!/usr/bin/env node
/**
 * Runs every registered golden-loop driver against an already-running desktop
 * app. `scripts/test-goldenloop.mjs` owns process startup/restart/teardown.
 *
 * The manifest is deliberately fail-closed: a CrmHomeRoute without a driver,
 * a stale manifest entry, or a driver file not registered in the manifest is
 * a failed loop, never a warning.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SURFACES } from './golden-loop.manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const verifyPersisted = process.argv.includes('--verify-persisted');
const registeredDrivers = [
  ...new Set(
    SURFACES.flatMap((surface) => (surface.driver ? [surface.driver] : []))
  ),
];
const actualDrivers = readdirSync(here).filter(
  (file) =>
    file.endsWith('.mjs') &&
    !['run-all.mjs', 'golden-loop.manifest.mjs'].includes(file)
);
const routeSource = readFileSync(
  path.join(root, 'src/features/crm-home/CrmHome.tsx'),
  'utf8'
);
const declaredRoutes = [
  ...new Set(
    [...routeSource.matchAll(/^\s*\|\s*'([^']+)'/gm)].map((match) => match[1])
  ),
];
const manifestRoutes = new Set(SURFACES.map((surface) => surface.id));
const missingManifestRoutes = declaredRoutes.filter(
  (route) => !manifestRoutes.has(route)
);
const staleManifestRoutes = SURFACES.filter(
  (surface) => surface.id !== 'clients' && !declaredRoutes.includes(surface.id)
).map((surface) => surface.id);
const missingDrivers = SURFACES.filter((surface) => !surface.driver).map(
  (surface) => surface.id
);
const missingFiles = registeredDrivers.filter(
  (file) => !existsSync(path.join(here, file))
);
const unregisteredDrivers = actualDrivers.filter(
  (file) => !registeredDrivers.includes(file)
);

const run = (file) =>
  new Promise((resolve) => {
    const args = [
      path.join(here, file),
      ...(verifyPersisted ? ['--verify-persisted'] : []),
    ];
    const child = spawn('node', args, { stdio: 'inherit', env: process.env });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });

let failed = 0;
for (const file of registeredDrivers) {
  console.log(
    `\n=== GOLDEN LOOP${verifyPersisted ? ' PERSISTENCE' : ''}: ${file} ===`
  );
  const code = await run(file);
  if (code !== 0) {
    console.error(`❌ ${file} FAILED (exit ${code})`);
    failed += 1;
  } else {
    console.log(`✅ ${file} passed`);
  }
}

const integrityFailures = [
  missingDrivers.length &&
    `surfaces without drivers: ${missingDrivers.join(', ')}`,
  missingManifestRoutes.length &&
    `CrmHomeRoute values absent from the manifest: ${missingManifestRoutes.join(', ')}`,
  staleManifestRoutes.length &&
    `manifest routes absent from CrmHomeRoute: ${staleManifestRoutes.join(', ')}`,
  missingFiles.length &&
    `registered driver files missing: ${missingFiles.join(', ')}`,
  unregisteredDrivers.length &&
    `driver files absent from the manifest: ${unregisteredDrivers.join(', ')}`,
].filter(Boolean);
if (integrityFailures.length) {
  failed += integrityFailures.length;
  console.error(
    `\n❌ GOLDEN LOOP COVERAGE FAILED\n- ${integrityFailures.join('\n- ')}`
  );
}

console.log(
  failed === 0
    ? `\n🟢 GOLDEN LOOP ${verifyPersisted ? 'PERSISTENCE' : 'WRITE'}: COMPLETE`
    : `\n🔴 GOLDEN LOOP ${verifyPersisted ? 'PERSISTENCE' : 'WRITE'}: INCOMPLETE (${failed} failures)`
);
process.exit(failed === 0 ? 0 : 1);

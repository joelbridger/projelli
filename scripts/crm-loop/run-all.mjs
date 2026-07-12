#!/usr/bin/env node
/**
 * Runs every registered golden-loop driver against an already-running desktop
 * app. `scripts/test-goldenloop.mjs` owns process startup/restart/teardown.
 *
 * The manifest is deliberately fail-closed: a registry-mounted CRM surface
 * without a driver, a stale manifest entry, or a driver file not registered
 * in the manifest is a failed loop, never a warning.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SURFACES } from './golden-loop.manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const verifyPersisted = process.argv.includes('--verify-persisted');
const checkManifestOnly = process.argv.includes('--check-manifest');
const registeredDrivers = [
  ...new Set(
    SURFACES.flatMap((surface) => surface.drivers)
  ),
];
const actualDrivers = readdirSync(here).filter(
  (file) =>
    file.endsWith('.mjs') &&
    !['run-all.mjs', 'golden-loop.manifest.mjs'].includes(file)
);
const registryPath = path.join(root, 'src/features/crm-home/registry.ts');
const registrySource = readFileSync(registryPath, 'utf8');
const registryEntries = registrySource
  .match(/crmHomeSurfaceRegistry[^=]*=\s*\[([\s\S]*?)\]/)?.[1]
  ?.match(/\b[A-Za-z_$][\w$]*\b/g)
  ?.filter((entry) => entry.endsWith('Surface')) ?? [];
const importedModules = new Map();
for (const match of registrySource.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g)) {
  for (const name of match[1].match(/\b[A-Za-z_$][\w$]*\b/g) ?? []) {
    importedModules.set(name, match[2]);
  }
}
const modulePath = (specifier) => {
  const base = specifier.startsWith('@/')
    ? path.join(root, 'src', specifier.slice(2))
    : path.resolve(path.dirname(registryPath), specifier);
  return ['.tsx', '.ts', '/index.tsx', '/index.ts']
    .map((suffix) => `${base}${suffix}`)
    .find(existsSync);
};
const unresolvedRegistryEntries = [];
const mountedRoutes = [];
for (const entry of registryEntries) {
  const sourcePath = modulePath(importedModules.get(entry) ?? '');
  const source = sourcePath && readFileSync(sourcePath, 'utf8');
  const route = source?.match(new RegExp(`export const ${entry}[^;]*?route:\\s*'([^']+)'`))?.[1];
  if (route) mountedRoutes.push(route);
  else unresolvedRegistryEntries.push(entry);
}
// Client records are rendered by the application shell, outside CrmHome.
const declaredRoutes = [...new Set(['clients', ...mountedRoutes])];
const manifestRoutes = new Set(SURFACES.map((surface) => surface.id));
const missingManifestRoutes = declaredRoutes.filter(
  (route) => !manifestRoutes.has(route)
);
const staleManifestRoutes = SURFACES.filter(
  (surface) => !declaredRoutes.includes(surface.id)
).map((surface) => surface.id);
const missingDrivers = SURFACES.filter((surface) => !surface.drivers?.length).map(
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
if (!checkManifestOnly) {
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
}

const integrityFailures = [
  missingDrivers.length &&
    `surfaces without drivers: ${missingDrivers.join(', ')}`,
  missingManifestRoutes.length &&
    `registry-mounted routes absent from the manifest: ${missingManifestRoutes.join(', ')}`,
  staleManifestRoutes.length &&
    `manifest routes absent from the CRM surface registry: ${staleManifestRoutes.join(', ')}`,
  unresolvedRegistryEntries.length &&
    `registry entries without a readable route: ${unresolvedRegistryEntries.join(', ')}`,
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

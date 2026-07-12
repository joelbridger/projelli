#!/usr/bin/env node
/**
 * The golden loop: drives every wired CRM surface in the RUNNING app through the
 * debug bridge, in the order an advisor would actually use them. Each lane's
 * driver is one step; a failing step stops the loop with a non-zero exit.
 *
 * A surface with no driver counts as UNWIRED and fails the loop — this file is
 * the honest answer to "does the product actually work?", so it must never pass
 * by omission.
 *
 * Prereq: the app is running (`npm run tauri:dev`) with the debug bridge on 9250.
 */
import { spawn } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORDER = ['clients.mjs', 'today-tasks.mjs', 'workflows.mjs', 'migration.mjs', 'reports.mjs'];

const present = ORDER.filter((f) => existsSync(path.join(here, f)));
const missing = ORDER.filter((f) => !present.includes(f));
const extra = readdirSync(here).filter(
  (f) => f.endsWith('.mjs') && f !== 'run-all.mjs' && !ORDER.includes(f)
);

const run = (file) =>
  new Promise((resolve) => {
    const child = spawn('node', [path.join(here, file)], { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
  });

let failed = 0;
for (const file of [...present, ...extra]) {
  console.log(`\n=== GOLDEN LOOP: ${file} ===`);
  const code = await run(file);
  if (code !== 0) {
    console.error(`❌ ${file} FAILED (exit ${code})`);
    failed += 1;
    break;
  }
  console.log(`✅ ${file} passed`);
}

if (missing.length)
  console.warn(`\n⚠️  NOT YET WIRED (no driver): ${missing.join(', ')}`);
console.log(
  failed === 0 && missing.length === 0
    ? '\n🟢 GOLDEN LOOP: COMPLETE — every surface drives the real engines'
    : `\n🔴 GOLDEN LOOP: INCOMPLETE (${failed} failed, ${missing.length} unwired)`
);
process.exit(failed === 0 && missing.length === 0 ? 0 : 1);

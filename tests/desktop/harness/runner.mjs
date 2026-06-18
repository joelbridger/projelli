/**
 * runner.mjs — runs ONE desktop spec against a live tauri-driver.
 *
 * Invoked by run.sh once per spec, with a fresh isolated profile + its own
 * tauri-driver already started. Reads env:
 *   TAURI_APP         absolute path to the app binary
 *   TAURI_DRIVER_PORT tauri-driver intermediary port
 *   KP_WORKSPACE      the temp workspace dir (real Tauri FS) for this run
 *   KP_TMPROOT        the temp profile root for this run
 *   KP_EVIDENCE_DIR   where to write screenshots/logs
 *   KP_SPEC           absolute path to the spec .mjs to run
 *
 * A spec is an ES module that default-exports `{ name, async run(ctx) }`.
 * `ctx` = { session, workspace, tmproot, evidenceDir, app: appHelpers, log }.
 * The spec throws to fail; returns normally to pass. The runner always closes
 * the session and screenshots on failure.
 *
 * Exit code 0 = pass, 1 = fail.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Session } from './webdriver.mjs';
import * as appHelpers from './app.mjs';

const {
  TAURI_APP,
  TAURI_DRIVER_PORT,
  KP_WORKSPACE,
  KP_TMPROOT,
  KP_EVIDENCE_DIR,
  KP_SPEC,
} = process.env;

for (const [k, v] of Object.entries({ TAURI_APP, TAURI_DRIVER_PORT, KP_WORKSPACE, KP_EVIDENCE_DIR, KP_SPEC })) {
  if (!v) throw new Error(`runner.mjs: missing env ${k}`);
}

const log = (msg) => console.log(`[spec] ${msg}`);

const mod = await import(pathToFileURL(KP_SPEC).href);
const spec = mod.default ?? mod.spec;
if (!spec || typeof spec.run !== 'function') {
  throw new Error(`Spec ${KP_SPEC} must default-export { name, run(ctx) }`);
}
const specName = spec.name || path.basename(KP_SPEC);

const session = new Session({ app: TAURI_APP, driverPort: Number(TAURI_DRIVER_PORT), log });
const ctx = {
  session,
  workspace: KP_WORKSPACE,
  tmproot: KP_TMPROOT,
  evidenceDir: KP_EVIDENCE_DIR,
  app: appHelpers,
  log,
};

const safeName = specName.replace(/[^a-z0-9._-]+/gi, '_');
const started = Date.now();
let failed = false;

try {
  await spec.run(ctx);
  const ms = Date.now() - started;
  // Capture a pass screenshot too (cheap, useful evidence) if a session exists.
  try { await session.screenshot(path.join(KP_EVIDENCE_DIR, `${safeName}.pass.png`)); } catch {}
  console.log(`PASS ${specName} (${ms}ms)`);
} catch (err) {
  failed = true;
  const ms = Date.now() - started;
  try { await session.screenshot(path.join(KP_EVIDENCE_DIR, `${safeName}.FAIL.png`)); } catch {}
  console.error(`FAIL ${specName} (${ms}ms): ${err?.stack || err?.message || err}`);
} finally {
  await session.close();
}

process.exit(failed ? 1 : 0);

// scripts/robot/verbs/atlas.mjs
// One-off UX screenshot atlas capture. Not part of the normal robot verb set —
// invoked directly by the ux-atlas capture script, not via cli.mjs/server.mjs.
//
// shoot(page, dir, seq, name) writes <dir>/<seq>-<name>.png (full-page-off,
// viewport screenshot — matches what a user actually sees, not a scrolled
// composite) and returns the written path so the caller can log it.

import { mkdirSync } from 'node:fs';
import path from 'node:path';

let counter = 0;

export function resetCounter(n = 0) {
  counter = n;
}

export async function shoot(page, dir, name, { fullPage = false, pad = 3 } = {}) {
  mkdirSync(dir, { recursive: true });
  counter += 1;
  const seq = String(counter).padStart(pad, '0');
  const fname = `${seq}-${name}.png`;
  const p = path.join(dir, fname);
  await page.screenshot({ path: p, type: 'png', fullPage }).catch((e) => {
    throw new Error(`screenshot failed for ${name}: ${e.message || e}`);
  });
  return { seq, fname, path: p };
}

export async function safeClick(page, testid, opts = {}) {
  await page.click(`[data-testid="${testid}"]`, { timeout: opts.timeout ?? 5000 });
  if (opts.wait !== 0) await page.waitForTimeout(opts.wait ?? 500);
}

export async function tryClick(page, testid, opts = {}) {
  try {
    await safeClick(page, testid, opts);
    return true;
  } catch {
    return false;
  }
}

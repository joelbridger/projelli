// scripts/robot/verbs/reset.mjs
// Verb: reset_to_seed — bring the Legion bench to a clean, fully-seeded state.
//
// Three modes:
//   'fast' (default) — in-page only: purge residue keys + inject seed + location.reload().
//                      No app kill. KEEPS the existing index. Use when the app is
//                      healthy and you just need a clean slate between test runs.
//   'full'           — kill app -> delete .keepance vector index -> restart ->
//                      wait for ports -> reconnect -> inject seed. NOTE: leaves the
//                      index DELETED (ask/isolation can't retrieve until re-indexed).
//   'snapshot'       — kill app -> RESTORE the frozen, fully-indexed workspace from
//                      its archive (no re-import / no re-embed) -> restart -> wait ->
//                      reconnect -> inject seed. The fast path to a clean world that
//                      can immediately Ask. Requires a golden archive built once via
//                      `node scripts/robot/build-snapshot.mjs`; refuses to wipe the
//                      live workspace if no valid archive exists.
//
// In all modes matters are read from the repo on the SERVER (not from the bench)
// and injected via page.evaluate(), matching legion-seed.mjs's exact localStorage shapes.
//
// Returns: { ok, mode, removed, remaining, seeded, restored? }
//   ok       — boolean; false if post-seed verification fails (profession≠'advisor' or
//              mattersCount≠26) or (snapshot) if the restore failed
//   mode     — the mode that ran
//   removed  — array of localStorage keys that were removed as residue
//   remaining — number of localStorage keys after purge (before seed keys added)
//   seeded   — { profession, mattersCount, settings } from the live app after seed
//   restored — (snapshot only) the snapshot.ps1 restore result packet

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { reconnect } from '../connection.mjs';
import {
  scpTo,
  killApp,
  deleteIndex,
  restartApp,
  waitForPorts,
  scpSnapshotPs,
  snapshotStatus,
  assertSnapshotRestorable,
  restoreSnapshot,
} from '../bench.mjs';

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

/** The residue localStorage keys that should be purged between test runs.
 *  Matches legion-purge-residue.mjs's exactKill set + prefix patterns EXACTLY.
 *  Guards against silent drift (the "128 fake duplicate facts" incident).
 */
export const RESIDUE_KEYS = {
  exact: [
    'keepance:client-maps',
    'ai-chat-storage',
    'keepance:matter-ui-snapshots',
    'keepance:client-map-templates',
    'workspace_versions',
  ],
  prefixes: [/^workspace_(tabs|expanded)_/],
};

/** Where the matters JSON lives on the bench (after scpTo in full mode). */
export const SEED_MATTERS_PATH = 'C:/northcrest_matters.json';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const WS_PATH = 'C:/keepance-demo-northcrest/Northcrest Wealth Partners';
const WS_NAME = 'Northcrest Wealth Partners';

/** Read the 26 Northcrest matters from the server-side repo file. */
function loadMatters() {
  const here = dirname(fileURLToPath(import.meta.url));
  const mattersPath = join(here, '../../demo/northcrest_matters.json');
  return JSON.parse(readFileSync(mattersPath, 'utf8'));
}

/** Run purge + seed as a single page.evaluate — avoids a second round-trip.
 *  The prefix RegExps are serialized to their .source strings for the
 *  structured-clone boundary, then reconstructed inside the browser context.
 */
async function applyPurgeAndSeed(page, matters) {
  return page.evaluate(
    ({ exactKill, prefixSources, matters, wsPath, wsName }) => {
      // Build prefix patterns inside the browser context (structured-clone can't carry RegExp)
      const prefixPatterns = prefixSources.map((s) => new RegExp(s));

      // --- Purge residue ---
      const removed = [];
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      for (const k of keys) {
        if (exactKill.includes(k) || prefixPatterns.some((re) => re.test(k))) {
          localStorage.removeItem(k);
          removed.push(k);
        }
      }
      const remaining = localStorage.length;

      // --- Apply seed (mirrors legion-seed.mjs lines 49-74 exactly) ---

      // profession + onboarding
      localStorage.setItem('keepance_profession', 'advisor');
      localStorage.setItem('keepance_onboarding_complete', 'true');

      // settings: preserve persist wrapper, merge the three flag values on
      let s = null;
      try { s = JSON.parse(localStorage.getItem('keepance:settings') || 'null'); } catch (_) {}
      if (!s || typeof s !== 'object') s = { state: { values: {} }, version: 0 };
      const sState = s.state || (s.state = {});
      sState.values = Object.assign({}, sState.values || {}, {
        memoryEnabled: true,
        includePdfsInWorkspaceIndex: true,
        ocrScannedPdfs: true,
      });
      localStorage.setItem('keepance:settings', JSON.stringify(s));

      // matters: exact shape {state:{matters,activeMatterId:null}, version:5}
      localStorage.setItem('keepance:matters', JSON.stringify({
        state: { matters, activeMatterId: null },
        version: 5,
      }));

      // recent workspaces: prepend Northcrest, keep last 10
      let r = [];
      try { r = JSON.parse(localStorage.getItem('keepance_recent_workspaces') || '[]'); } catch (_) {}
      if (!Array.isArray(r)) r = [];
      r = r.filter((w) => w && w.path !== wsPath);
      r.unshift({ path: wsPath, name: wsName, lastOpened: new Date().toISOString() });
      localStorage.setItem('keepance_recent_workspaces', JSON.stringify(r.slice(0, 10)));

      return { removed, remaining };
    },
    {
      exactKill: RESIDUE_KEYS.exact,
      prefixSources: RESIDUE_KEYS.prefixes.map((re) => re.source),
      matters,
      wsPath: WS_PATH,
      wsName: WS_NAME,
    },
  );
}

/** Read back the seeded values from the live app for the verification packet. */
async function readSeededState(page) {
  return page.evaluate(() => {
    const mm = JSON.parse(localStorage.getItem('keepance:matters') || '{}');
    const ss = JSON.parse(localStorage.getItem('keepance:settings') || '{}');
    return {
      profession: localStorage.getItem('keepance_profession'),
      mattersCount: ((mm.state || mm).matters || []).length,
      settings: (ss.state || ss).values || {},
    };
  });
}

// ---------------------------------------------------------------------------
// Exported verb
// ---------------------------------------------------------------------------

/**
 * Reset the Legion bench to a clean, fully-seeded state.
 *
 * @param {import('playwright').Page} page  — the live Keepance WebView2 page
 * @param {{ mode?: 'fast' | 'full' }} opts
 * @returns {Promise<{ ok: boolean, mode: string, removed: string[], remaining: number, seeded: object }>}
 */
export async function resetToSeed(page, { mode = 'fast' } = {}) {
  const matters = loadMatters();

  if (mode === 'fast') {
    // In-page purge + seed, then reload so Zustand stores rehydrate
    const { removed, remaining } = await applyPurgeAndSeed(page, matters);
    await page.evaluate(() => location.reload());
    await sleep(4000);
    const seeded = await readSeededState(page);
    const ok = seeded.profession === 'advisor' && seeded.mattersCount === 26;
    return { ok, mode, removed, remaining, seeded };
  }

  if (mode === 'full') {
    // 1. SCP matters JSON to bench so the path C:/northcrest_matters.json exists
    const here = dirname(fileURLToPath(import.meta.url));
    const localMattersPath = join(here, '../../demo/northcrest_matters.json');
    scpTo(localMattersPath, SEED_MATTERS_PATH);

    // 2. Kill -> delete index -> restart -> wait for ports
    killApp();
    deleteIndex();
    restartApp();
    const portsReady = await waitForPorts();
    if (!portsReady) {
      return {
        ok: false, mode, removed: [], remaining: 0,
        seeded: { error: 'ports did not come up after restart' },
      };
    }

    // 3. Reconnect to the freshly started app
    const freshPage = await reconnect();

    // 4. Purge any residue left from the fresh start + apply seed, then reload so
    //    the freshly-started app's Zustand stores rehydrate FROM the seeded
    //    localStorage. They hydrated from the OLD storage at startup, before we
    //    wrote the seed — without this reload the UI would stay stale even though
    //    localStorage (and therefore the verification read) looks correct.
    const { removed, remaining } = await applyPurgeAndSeed(freshPage, matters);
    await freshPage.evaluate(() => location.reload());
    await sleep(4000);

    // 5. Verify
    const seeded = await readSeededState(freshPage);
    const ok = seeded.profession === 'advisor' && seeded.mattersCount === 26;
    return { ok, mode, removed, remaining, seeded };
  }

  if (mode === 'snapshot') {
    // 0. Pre-flight the guard while the app is still up: FAIL before we kill
    //    anything if there is no usable golden archive to put back.
    scpSnapshotPs();
    const preStatus = snapshotStatus();
    assertSnapshotRestorable(preStatus); // throws -> caller's runVerb records ok:false

    // 1. Kill the app to release the LanceDB / WebView2 file locks.
    killApp();

    // 2. Restore the frozen workspace (extract -> verify -> atomic swap). The
    //    bench-side script re-guards and only swaps after verifying the extract.
    //    Wrap so a thrown re-guard (e.g. a transient SSH miss) becomes a clean
    //    failure return rather than an unhandled throw after the app was killed.
    let restored;
    try {
      restored = restoreSnapshot();
    } catch (e) {
      restored = { ok: false, error: String(e.message || e) };
    }
    if (!restored || restored.ok !== true) {
      return {
        ok: false, mode, restored, removed: [], remaining: 0,
        seeded: { error: `snapshot restore failed: ${(restored && restored.error) || 'unknown'}` },
      };
    }

    // 3. Restart -> wait for ports -> reconnect to the fresh app.
    restartApp();
    const portsReady = await waitForPorts();
    if (!portsReady) {
      return {
        ok: false, mode, restored, removed: [], remaining: 0,
        seeded: { error: 'ports did not come up after restart' },
      };
    }
    const freshPage = await reconnect();

    // 4. Seed localStorage (matters/profession/settings) + reload so the freshly
    //    started app's Zustand stores rehydrate from the seeded storage.
    const { removed, remaining } = await applyPurgeAndSeed(freshPage, matters);
    await freshPage.evaluate(() => location.reload());
    await sleep(4000);

    // 5. Verify.
    const seeded = await readSeededState(freshPage);
    const ok = seeded.profession === 'advisor' && seeded.mattersCount === 26;
    return { ok, mode, restored, removed, remaining, seeded };
  }

  throw new Error(`Unknown reset mode: ${mode}. Use 'fast', 'full', or 'snapshot'.`);
}

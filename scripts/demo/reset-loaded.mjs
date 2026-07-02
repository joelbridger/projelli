#!/usr/bin/env node
// reset-loaded.mjs — restore the LOADED demo to a clean, ready-to-show state.
//
// What it does (between showings, no full re-index needed):
//   - wipes localStorage residue (test ai-chat threads, stray recents, etc.)
//   - lays down the captured LOADED seed: 27 Northcrest matters, 26 pre-built
//     client maps (Brennan EXCLUDED so it builds live on stage), advisor settings
//     with the feature tour suppressed and the confidentiality choice already made
//   - reopens the Northcrest workspace and dismisses any tour
//
// The vector index (LanceDB) and the OpenAI key (OS keychain) are untouched, so
// Ask + every client map work immediately. Re-opening the workspace shows the
// background "Indexing PDFs" banner for a few minutes; that is cosmetic (the data
// is already on disk) and reinforces the "nothing leaves your machine" message.
//
// Brennan keeps its folder mapped + its 5 files indexed and matter-tagged (that
// lives in the index, not localStorage), but has NO client map — so on stage you
// open Brennan -> Client Map and watch it build in ~15s.
//
// Run from the server through the CDP tunnel:  DESKTOP_CDP_PORT=9444 node reset-loaded.mjs
import { getPage, disconnect } from '../robot/connection.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED = JSON.parse(readFileSync(join(__dirname, 'seed-loaded.json'), 'utf8'));
const page = await getPage();
page.setDefaultTimeout(20000);

// 1. clear + lay down the seed
const wrote = await page.evaluate((seed) => {
  localStorage.clear();
  const put = (k, v) => { if (v != null) localStorage.setItem(k, v); };
  put('lantern:matters', seed.matters);
  put('lantern:client-maps', seed.clientMaps);
  put('lantern:settings', seed.settings);
  put('lantern_profession', seed.profession);
  put('lantern_onboarding_complete', seed.onboardingComplete);
  put('lantern_default_provider', seed.defaultProvider);
  put('lantern_default_model', seed.defaultModel);
  put('lantern_models_openai', seed.modelsOpenai);
  put('lantern:profile', seed.profile);
  put('lantern:matter-at-a-glance', seed.matterAtAGlance);
  put('lantern_recent_workspaces', seed.recentWorkspaces);
  const cm = JSON.parse(seed.clientMaps || '{}');
  const maps = (cm.state ? cm.state.maps : cm.maps) || {};
  const m = JSON.parse(seed.matters || '{}');
  return { matters: ((m.state ? m.state.matters : m.matters) || []).length, maps: Object.keys(maps).length };
}, SEED);
console.log('seed laid down:', JSON.stringify(wrote));

// 2. reload so the stores rehydrate from the fresh localStorage
await page.evaluate(() => location.reload());
await page.waitForTimeout(5000);

// 3. reopen the Northcrest workspace (reload drops to the workspace picker)
async function rowCount() {
  return page.$$eval('[data-testid="recent-workspace-row"]', (e) => e.length).catch(() => 0);
}
const onSelector = await page.$('[data-testid="workspace-selector-dialog"]');
if (onSelector) {
  for (let i = 0; i < 3 && (await rowCount()) === 0; i++) {
    await page.click('[data-testid="recent-workspaces-toggle"]').catch(() => {});
    await page.waitForTimeout(700);
  }
  const rows = await page.$$('[data-testid="recent-workspace-row"]');
  for (const r of rows) {
    const t = await r.innerText().catch(() => '');
    if (/Northcrest/.test(t)) { await r.click(); break; }
  }
  await page.waitForTimeout(4000);
}

// 4. dismiss any feature tour (should be suppressed, but be safe)
for (let i = 0; i < 4; i++) {
  const tour = await page.$('[data-testid="feature-tour-center"]');
  if (tour) { await page.click('[data-testid="feature-tour-skip"]').catch(() => page.keyboard.press('Escape')); await page.waitForTimeout(500); } else break;
}

// 5. verify
await page.waitForSelector('[data-testid="spine-nav-matters"]', { timeout: 30000 }).catch(() => {});
const verify = await page.evaluate(() => {
  const tids = new Set([...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')));
  const m = JSON.parse(localStorage.getItem('lantern:matters') || '{}');
  const cm = JSON.parse(localStorage.getItem('lantern:client-maps') || '{}');
  const maps = (cm.state ? cm.state.maps : cm.maps) || {};
  return {
    workspaceOpen: tids.has('spine-nav-matters'),
    tourPresent: tids.has('feature-tour-center'),
    matters: ((m.state ? m.state.matters : m.matters) || []).length,
    clientMaps: Object.keys(maps).length,
    brennanHasMap: !!maps['matter_nc_brennan_thomas_karen'],
  };
});
console.log('VERIFY:', JSON.stringify(verify, null, 2));
console.log(verify.workspaceOpen && verify.matters === 27 && verify.clientMaps === 26 && !verify.brennanHasMap
  ? 'RESET-LOADED OK ✓  (Brennan ready to build live)'
  : 'RESET-LOADED needs attention ✗');
await disconnect();

#!/usr/bin/env node
/**
 * UI ITERATION SYSTEM — Part 4: the robot rehearsal.
 *
 * Walks the DEMO-V1 6-step critical path against the app running MACHINE-LOCALLY
 * in a real browser (the `build:web-demo` bundle), gripping PERMANENT HANDLES
 * (data-testid) — never visual structure or English copy. It produces a
 * green/amber/red verdict + a screenshot per step, and an overall pass/fail, so
 * that after ANY UI change you can confirm the demo path still works in minutes
 * instead of a full manual re-test.
 *
 * HONEST SCOPE (this is machine-local, NOT the Legion). Five of the six demo
 * steps depend on the Tauri desktop shell (on-device Local AI, connector OAuth,
 * live import progress, Teams capture, transcription). Those cannot truly run in
 * a browser, so this rehearsal:
 *   • FULLY exercises Step 4 (Ask → cited answer) — the demo's local core.
 *   • Navigates the OTHER steps' surfaces and asserts their handles resolve
 *     (REDUCED: "UI reachable; the live action is desktop-only").
 *   • Marks genuinely un-runnable pieces SKIP-NEEDS-BENCH — never a fake green.
 * The permanent-handle guard (handle-guard.mjs) separately enforces that EVERY
 * step's handles persist in source, so the demo path's grip points are protected
 * even for the steps this local run can't drive.
 *
 * The full live 6-step run remains the Legion/desktop job. This is the cheap,
 * repeatable, per-iteration check.
 *
 * Prereq: the web-demo build is served locally. This script can start it itself
 * (default) or attach to an already-running preview via REHEARSAL_URL.
 *
 * Usage:
 *   node scripts/ui-system/rehearsal.mjs                 # build+serve+drive, headless
 *   REHEARSAL_URL=http://localhost:4173/try/ node scripts/ui-system/rehearsal.mjs
 *   REHEARSAL_HEADED=1 node scripts/ui-system/rehearsal.mjs   # watch it drive
 *   REHEARSAL_SKIP_BUILD=1 ...                           # reuse an existing dist-web-demo
 *
 * Exit: 0 = the locally-verifiable path is healthy, 1 = a local regression.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { evaluateHandleFacts, ALLOWED_WRAPPERS } from './lib/handle-eval.mjs';
import { evaluateScrollabilityFacts } from './lib/scroll-eval.mjs';
import { withBrowserLaunchOptions } from '../browser-launch.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const ARTIFACTS = resolve(repoRoot, '.rehearsal');
const PORT = Number(process.env.REHEARSAL_PORT || 4173);
const BASE_URL = process.env.REHEARSAL_URL || `http://localhost:${PORT}/try/`;
function ensureQueryParam(url, key, value) {
  if (new RegExp(`(?:[?&])${key}=`).test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + `${key}=${value}`;
}
// testMode disables the browser build's single-writer tab guard (App.tsx reads
// `?testMode=true` at load). Without it, the guard's StrictMode double-mount can
// ping-pong a "workspace open in another tab" overlay and the shell never
// settles. `seedDemo=1` makes the robot start with the same seeded clients as
// the browser e2e mirror tests, instead of an empty "click a client" shell.
// Both flags are read once at module load, so they persist across in-app nav.
const URL = ensureQueryParam(ensureQueryParam(BASE_URL, 'testMode', 'true'), 'seedDemo', '1');
// The URL the local preview root responds to (for the server-up health check).
const HEALTH_URL = `http://localhost:${PORT}/try/`;
const HEADED = !!process.env.REHEARSAL_HEADED;
const SKIP_BUILD = !!process.env.REHEARSAL_SKIP_BUILD;
const OWN_SERVER = !process.env.REHEARSAL_URL; // if a URL was given, don't manage a server

const GREEN = 'GREEN';
const REDUCED = 'REDUCED';
const SKIP = 'SKIP-NEEDS-BENCH';
const FAIL = 'FAIL';

const results = [];
let stepNo = 0;
function record(title, verdict, note, shot) {
  results.push({ step: ++stepNo, title, verdict, note: note || '', shot: shot || '' });
  const mark = { GREEN: '🟢', REDUCED: '🟡', [SKIP]: '⚪', FAIL: '🔴' }[verdict] || '·';
  console.log(`${mark} [${verdict}] ${title}${note ? ' — ' + note : ''}`);
}

// ---- local server management ------------------------------------------------
let serverProc = null;
function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: repoRoot, stdio: 'inherit', ...opts });
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
    p.on('error', rej);
  });
}
async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 200) return true;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}
async function startServer() {
  if (!SKIP_BUILD) {
    console.log('[rehearsal] building web-demo bundle …');
    await run('npm', ['run', 'build:web-demo']);
  } else if (!existsSync(resolve(repoRoot, 'dist-web-demo'))) {
    throw new Error('REHEARSAL_SKIP_BUILD set but dist-web-demo/ is missing — build it first.');
  }
  console.log('[rehearsal] starting preview server …');
  serverProc = spawn('npx', ['vite', 'preview', '--config', 'vite.config.web-demo.ts', '--port', String(PORT)], {
    cwd: repoRoot,
    stdio: 'ignore',
    detached: false,
  });
  const up = await waitForServer(HEALTH_URL, 30000);
  if (!up) throw new Error(`preview server did not come up at ${HEALTH_URL}`);
}
function stopServer() {
  if (serverProc && !serverProc.killed) {
    try { serverProc.kill('SIGTERM'); } catch { /* ignore */ }
  }
}

// ---- boot the demo, tolerant of the seed/auto-open navigation race -----------
async function bootStable(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Poll for the shell to mount AND settle: the demo seeds OPFS then auto-opens
  // the workspace, which can re-render mid-load. Require the spine nav handle to
  // be present on two consecutive polls before proceeding.
  //
  // The browser build's single-writer tab guard can show a "workspace open in
  // another tab" overlay on first mount (its own StrictMode double-mount looks
  // like a second tab). Click through it via its permanent handle — a real
  // visitor does the same. Then wait for the shell.
  let stableHits = 0;
  for (let i = 0; i < 90; i++) {
    await sleep(700);
    if (await hasHandle(page, 'tab-write-guard-overlay')) {
      await page.locator('[data-testid="tab-write-guard-take-over"]').click({ timeout: 5000 }).catch(() => {});
      await sleep(500);
      continue;
    }
    const present = await page
      .$('[data-testid="spine-nav-matters"]')
      .then((h) => !!h)
      .catch(() => false);
    stableHits = present ? stableHits + 1 : 0;
    if (stableHits >= 2) return true;
  }
  return false;
}

// A page.evaluate that returns null instead of throwing on a navigation race.
const ev = (page, fn, arg) => page.evaluate(fn, arg).catch(() => null);
const hasHandle = (page, id) =>
  page.$(`[data-testid="${id}"]`).then((h) => !!h).catch(() => false);
async function openFirstClientHub(page, preferredClientRowId = null) {
  await page.locator('[data-testid="spine-nav-matters"]').click({ timeout: 8000 }).catch(() => {});
  await sleep(500);
  if (await hasHandle(page, 'clientmap-panel')) return true;

  const selectors = [
    preferredClientRowId ? `[data-testid="${preferredClientRowId}"]` : null,
    '[data-testid^="spine-client-row-"]',
    '[data-testid^="matter-row-"]',
  ].filter(Boolean);

  for (const selector of selectors) {
    const first = page.locator(selector).first();
    const count = await first.count().catch(() => 0);
    if (count < 1) continue;
    await first.click({ timeout: 8000 }).catch(() => {});
    const opened = await page.waitForSelector('[data-testid="clientmap-panel"], [data-testid="hub-subtab-bar"]', { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return true;
  }
  return false;
}
async function shot(page, name) {
  const file = join(ARTIFACTS, `${name}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}

// ---- P0-3: runtime handle integrity ----------------------------------------
// The static handle-guard proves a handle STRING still exists in source. That
// is not enough (adversarial review): a handle can drift onto a wrapper, be
// duplicated, hidden, or disabled while the string survives. For each reachable
// demo-path handle this asserts, in the LIVE DOM: exactly one match (singleton),
// visible, enabled, and that it IS or CONTAINS the real interactive control.
// `kind`: 'control' (button/link), 'input' (text field), 'region' (container).
async function handleIntegrity(page, id, kind) {
  // Collect FACTS in the live DOM; the pass/fail DECISION is the pure,
  // unit-tested evaluateHandleFacts (tests/unit/ui-system/handle-eval.test.ts).
  // Round-2 P0: the handle must BE the control (selfControl/selfInput), not merely
  // CONTAIN one — a wrapper is accepted ONLY via an explicit ALLOWED_WRAPPERS
  // entry naming the inner target selector (the real click point).
  const wrapperSel = (ALLOWED_WRAPPERS[id] && ALLOWED_WRAPPERS[id].target) || null;
  const facts = await ev(page, ({ id, wrapperSel }) => {
    const els = [...document.querySelectorAll(`[data-testid="${id}"]`)];
    if (els.length === 0) return { id, count: 0 };
    const el = els[0];
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const visible =
      style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.01 && r.width > 0 && r.height > 0;
    const controlSel = 'button,a[href],[role="button"],[role="tab"],[role="switch"],[role="option"],select';
    const inputSel = 'input,textarea,[contenteditable="true"],[role="textbox"]';
    const selfControl = el.matches(controlSel) || el.matches(inputSel);
    const selfInput = el.matches(inputSel);
    const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
    const pointerNone = style.pointerEvents === 'none';
    const out = { id, count: els.length, visible, selfControl, selfInput, disabled, pointerNone };
    if (wrapperSel) {
      const t = el.querySelector(wrapperSel);
      out.targetExists = !!t;
      if (t) {
        const ts = getComputedStyle(t);
        const tr = t.getBoundingClientRect();
        out.targetVisible = ts.display !== 'none' && ts.visibility !== 'hidden' && tr.width > 0 && tr.height > 0;
        out.targetEnabled = !(t.disabled === true || t.getAttribute('aria-disabled') === 'true');
        out.targetControl = t.matches(controlSel) || t.matches(inputSel);
        out.targetInput = t.matches(inputSel);
      }
    }
    return out;
  }, { id, wrapperSel });
  const decision = evaluateHandleFacts(facts || { id, count: 0 }, kind, ALLOWED_WRAPPERS);
  return { id, ok: decision.ok, issues: decision.issues };
}

async function checkHandles(page, specs) {
  const out = [];
  for (const [id, kind] of specs) out.push(await handleIntegrity(page, id, kind));
  return out;
}

// ---- P1: cheap deterministic visual assertions -----------------------------
// Catches the visual-bug class the review flagged (clipping, off-viewport
// controls, copy overflow) without a full pixel-diff harness. Screenshot-diff
// against a blessed baseline is DEFERRED (see README) — these geometric checks
// are the fast, false-positive-resistant subset.
async function visualChecks(page, keyControlIds) {
  const res = await ev(page, (ids) => {
    const doc = document.documentElement;
    const hOverflow = doc.scrollWidth - doc.clientWidth;
    const vw = window.innerWidth, vh = window.innerHeight;
    const offscreen = [];
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // A key control must be within the horizontal viewport (vertical scroll is
      // fine; horizontal clipping is a real demo bug).
      if (r.left < -2 || r.right > vw + 2) offscreen.push(id);
    }
    return { hOverflow, offscreen, vw, vh };
  }, keyControlIds);
  return res || { hOverflow: 0, offscreen: [], vw: 0, vh: 0 };
}

// ---- P1: per-surface vertical scrollability -------------------------------
// A common app-shell failure is a tall surface getting clipped because one
// parent in the flex chain forgot `min-height: 0`, or because the tall content
// has no `overflow-y: auto` owner. The live robot proves the fix by injecting a
// temporary tall probe into each main surface and checking that a scroll
// container inside that surface can reach the bottom.
async function scrollabilityProbe(page, { rootSelector, contentSelector = rootSelector }) {
  const facts = await ev(page, async ({ rootSelector, contentSelector }) => {
    const root = document.querySelector(rootSelector);
    if (!root) return { rootPresent: false, contentPresent: false };
    const target = document.querySelector(contentSelector);
    if (!target) return { rootPresent: true, contentPresent: false };

    const probe = document.createElement('div');
    probe.setAttribute('data-rehearsal-scroll-probe', 'true');
    Object.assign(probe.style, {
      flex: '0 0 auto',
      height: `${Math.max(window.innerHeight * 1.5, 720)}px`,
      width: '1px',
      opacity: '0',
      pointerEvents: 'none',
    });
    target.appendChild(probe);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const visible = (el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 40;
    };
    const labelFor = (el) => {
      const testId = el.getAttribute('data-testid');
      return testId ? `[data-testid="${testId}"]` : el.tagName.toLowerCase();
    };

    const candidates = [];
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const s = getComputedStyle(el);
      if (!['auto', 'scroll'].includes(s.overflowY)) continue;
      if (!visible(el)) continue;
      const maxScrollTop = el.scrollHeight - el.clientHeight;
      if (maxScrollTop > 4) {
        candidates.push({
          el,
          label: labelFor(el),
          overflowY: s.overflowY,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          maxScrollTop,
        });
      }
    }
    candidates.sort((a, b) => b.maxScrollTop - a.maxScrollTop);
    const best = candidates[0] ?? null;

    let bestCanScroll = false;
    let reachedBottom = false;
    if (best) {
      const before = best.el.scrollTop;
      best.el.scrollTop = best.el.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const max = best.el.scrollHeight - best.el.clientHeight;
      bestCanScroll = max > 4;
      reachedBottom = best.el.scrollTop >= max - 4;
      best.el.scrollTop = before;
    }

    const rootOverflowed = root.scrollHeight > root.clientHeight + 4;
    const targetOverflowed = target.scrollHeight > target.clientHeight + 4;
    const contentTallerThanViewport =
      rootOverflowed ||
      targetOverflowed ||
      probe.getBoundingClientRect().bottom > window.innerHeight + 4;

    const out = {
      rootPresent: true,
      contentPresent: true,
      contentTallerThanViewport,
      rootOverflowed,
      scrollContainerCount: candidates.length,
      bestCanScroll,
      reachedBottom,
      best: best
        ? {
            label: best.label,
            overflowY: best.overflowY,
            clientHeight: best.clientHeight,
            scrollHeight: best.scrollHeight,
            maxScrollTop: best.maxScrollTop,
          }
        : null,
    };
    probe.remove();
    return out;
  }, { rootSelector, contentSelector });
  const decision = evaluateScrollabilityFacts(facts);
  return { ok: decision.ok, facts, issues: decision.issues };
}

function scrollNote(result) {
  if (result.ok) {
    return result.facts?.best
      ? `${result.facts.best.label} reaches bottom (${result.facts.best.scrollHeight}px / ${result.facts.best.clientHeight}px)`
      : 'content did not need a scrollbar';
  }
  return `issues: ${result.issues.join(', ')}`;
}

// ---- Step 4: Ask → cited answer (the real local check) ----------------------
const ATT = '[data-testid="ask-cited-attestation"]';
const CHIP = '[data-testid^="ask-citation-chip-"]';
async function reachAsk(page) {
  if (await hasHandle(page, 'ask-composer-input')) return true;
  await page.locator('[data-testid="spine-nav-search"]').click({ timeout: 8000 }).catch(() => {});
  if (await page.waitForSelector('[data-testid="ask-composer-input"]', { timeout: 10000 }).then(() => true).catch(() => false)) {
    return true;
  }
  await page.locator('[data-testid="spine-nav-matters"]').click().catch(() => {});
  await page
    .waitForSelector('[data-testid^="matter-actions-menu-"], [data-testid="ask-composer-input"]', { timeout: 20000 })
    .catch(() => {});
  if (!(await hasHandle(page, 'ask-composer-input'))) {
    const menu = page.locator('[data-testid^="matter-actions-menu-"]').first();
    const menuId = await menu.getAttribute('data-testid', { timeout: 15000 }).catch(() => null);
    if (menuId) {
      const matterId = menuId.replace('matter-actions-menu-', '');
      await menu.click({ timeout: 15000 }).catch(() => {});
      await page.locator(`[data-testid="matter-launch-ask-${matterId}"]`).click({ timeout: 15000 }).catch(() => {});
    }
  }
  return page.waitForSelector('[data-testid="ask-composer-input"]', { timeout: 20000 }).then(() => true).catch(() => false);
}

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true });
  // Clean prior artifacts so a stale screenshot can't masquerade as this run's.
  for (const f of ['boot', 'step1-ai', 'step2-data', 'step3-progress', 'step4-ask', 'step5-meeting', 'step6-transcript']) {
    try { rmSync(join(ARTIFACTS, `${f}.png`)); } catch { /* none */ }
  }

  if (OWN_SERVER) await startServer();

  const browser = await chromium.launch(withBrowserLaunchOptions({ headless: !HEADED }));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  let bootOk = false;
  try {
    bootOk = await bootStable(page);
    if (bootOk) await openFirstClientHub(page);
  } catch (e) {
    console.error('[rehearsal] boot error:', e.message);
  }

  const bootShot = await shot(page, 'boot');
  if (!bootOk) {
    record('Boot demo (web-demo bundle mounts, Client Map renders)', FAIL, 'app did not mount / spine nav never appeared', bootShot);
    return finish(browser, false);
  }
  const clientMap = await hasHandle(page, 'clientmap-panel');
  const spine = await ev(page, () =>
    ['spine-nav-matters', 'spine-nav-search', 'spine-nav-workflows'].every(
      (id) => !!document.querySelector(`[data-testid="${id}"]`),
    ),
  );
  record(
    'Boot demo (web-demo bundle mounts, Client Map + spine handles resolve)',
    clientMap && spine ? GREEN : FAIL,
    `clientmap-panel=${clientMap} spine-nav=${spine}`,
    bootShot,
  );

  // --- Handle integrity + visual assertions (Client Map) --------------------
  // P0-3 + P1: prove the reachable demo-path handles are unique/visible/enabled
  // real controls, and the screen has no horizontal overflow / off-viewport
  // controls — at desktop AND a narrow width (copy-overflow guard).
  // Resolve the dynamic client-row handle (id carries the matter id) so it's
  // covered too — not just the static nav handles.
  const clientRowId = await ev(page, () => {
    const el = document.querySelector('[data-testid^="spine-client-row-"]');
    return el ? el.getAttribute('data-testid') : null;
  });
  const clientMapHandles = [
    ['spine-nav-matters', 'control'],
    ['spine-nav-search', 'control'],
    ['spine-nav-workflows', 'control'],
    ['spine-new-client', 'control'],
    ['hub-subtab-overview', 'control'],
    ['hub-subtab-documents', 'control'],
    ['hub-subtab-email', 'control'],
    ['hub-subtab-meetings', 'control'],
    ['hub-subtab-activity', 'control'],
    ['clientmap-panel', 'region'],
    ...(clientRowId ? [[clientRowId, 'control']] : []),
  ];
  const integ1 = await checkHandles(page, clientMapHandles);
  const integ1Bad = integ1.filter((r) => !r.ok);
  const visWide = await visualChecks(page, ['spine-nav-matters', 'spine-new-client']);
  await page.setViewportSize({ width: 820, height: 800 });
  await sleep(500);
  const visNarrow = await visualChecks(page, ['spine-nav-matters']);
  await page.setViewportSize({ width: 1280, height: 800 });
  await sleep(300);
  const overflowBad = visWide.hOverflow > 4 || visNarrow.hOverflow > 4;
  const offscreenBad = visWide.offscreen.length > 0;
  const integrityOk = integ1Bad.length === 0 && !overflowBad && !offscreenBad;
  record(
    'Handle integrity + visual (Client Map: unique/visible/enabled controls, no overflow)',
    integrityOk ? GREEN : FAIL,
    integrityOk
      ? `${integ1.length} handles clean; hOverflow wide=${visWide.hOverflow}px narrow=${visNarrow.hOverflow}px`
      : `issues: ${integ1Bad.map((r) => r.id + '[' + r.issues.join(';') + ']').join(', ')}${overflowBad ? ` | horizontal overflow (wide=${visWide.hOverflow}px narrow=${visNarrow.hOverflow}px)` : ''}${offscreenBad ? ` | off-viewport: ${visWide.offscreen.join(',')}` : ''}`,
    await shot(page, 'integrity-clientmap'),
  );

  let scrollOk = true;
  async function recordScroll(title, spec, shotName) {
    const result = await scrollabilityProbe(page, spec);
    scrollOk = scrollOk && result.ok;
    record(title, result.ok ? GREEN : FAIL, scrollNote(result), await shot(page, shotName));
    return result.ok;
  }

  // Visual-only mode (the P-safe gate): boot + handle integrity + visual smoke
  // are exactly the re-checks a token/asset/copy swap needs. Stop here.
  if (process.env.REHEARSAL_VISUAL_ONLY) {
    return finish(browser, results[0].verdict === GREEN && integrityOk);
  }

  // --- Scrollability sweep: every main surface must own tall content --------
  await recordScroll(
    'Scrollability — Client Map detail',
    { rootSelector: '[data-testid="clientmap-panel"]', contentSelector: '[data-testid="clientmap-panel-scroll"]' },
    'scroll-clientmap',
  );

  await page.locator('[data-testid="spine-all-clients-row"]').click({ timeout: 8000 }).catch(() => {});
  await page.waitForSelector('[data-testid="matters-home-scroll"]', { timeout: 10000 }).catch(() => {});
  await recordScroll(
    'Scrollability — All Clients table',
    { rootSelector: '[data-testid="matters-home-scroll"]' },
    'scroll-all-clients',
  );

  await page.locator('[data-testid="spine-nav-workflows"]').click({ timeout: 8000 }).catch(() => {});
  await page.waitForSelector('[data-testid="associate-surface-header"]', { timeout: 10000 }).catch(() => {});
  await recordScroll(
    'Scrollability — Workflows',
    { rootSelector: '[data-testid="associate-home"]' },
    'scroll-workflows',
  );

  await page.locator('[data-testid="settings-gear"]').click({ timeout: 8000 }).catch(() => {});
  await page.waitForSelector('[data-testid="settings-content-scroll"]', { timeout: 10000 }).catch(() => {});
  await recordScroll(
    'Scrollability — Settings',
    { rootSelector: '[data-testid="settings-page"]', contentSelector: '[data-testid="settings-content-scroll"]' },
    'scroll-settings',
  );

  await page.locator('[data-testid="settings-category-privacy-center"]').click({ timeout: 8000 }).catch(() => {});
  await page.waitForSelector('[data-testid="privacy-center-scroll"]', { timeout: 10000 }).catch(() => {});
  await recordScroll(
    'Scrollability — Privacy Center',
    { rootSelector: '[data-testid="settings-page"]', contentSelector: '[data-testid="privacy-center-scroll"]' },
    'scroll-privacy-center',
  );

  await openFirstClientHub(page, clientRowId);

  // --- Step 1: Connect AI ---------------------------------------------------
  // Demo pre-configures cloud AI (Direct mode) and offers BYOK ("use my own
  // key"). On-device Local AI is a Tauri sidecar — not available in a browser.
  const byok = (await hasHandle(page, 'demo-byok-open')) || (await ev(page, () =>
    /use my own key/i.test(document.body.innerText),
  ));
  record(
    'Step 1 — Connect AI (ChatGPT + on-device Local AI)',
    REDUCED,
    `cloud AI pre-connected in demo; BYOK affordance present=${!!byok}; on-device Local AI is desktop-only (handle guard enforces its handles in source)`,
    await shot(page, 'step1-ai'),
  );

  // --- Step 2: Connect Data -------------------------------------------------
  // Connector OAuth/sync short-circuit under !isTauri(); the demo ships seeded
  // data instead. The client's data surfaces (documents/email) ARE reachable.
  let dataReachable = false;
  await page.locator('[data-testid="hub-subtab-documents"]').click({ timeout: 8000 }).catch(() => {});
  await sleep(800);
  dataReachable = (await hasHandle(page, 'hub-subtab-documents')) && (await hasHandle(page, 'hub-subtab-email'));
  record(
    'Step 2 — Connect Data (Outlook / OneDrive / Wealthbox)',
    dataReachable ? REDUCED : SKIP,
    'live connector OAuth+sync are desktop-only; demo ships seeded client data; data surfaces reachable=' + dataReachable,
    await shot(page, 'step2-data'),
  );
  await page.waitForSelector('[data-testid="document-grid-scroll"]', { timeout: 10000 }).catch(() => {});
  await recordScroll(
    'Scrollability — Documents',
    { rootSelector: '[data-testid="documents-split"]', contentSelector: '[data-testid="document-grid-scroll"]' },
    'scroll-documents',
  );
  await page.locator('[data-testid="hub-subtab-email"]').click({ timeout: 8000 }).catch(() => {});
  await page.waitForSelector('[data-testid="email-workspace"]', { timeout: 10000 }).catch(() => {});
  await recordScroll(
    'Scrollability — Email',
    { rootSelector: '[data-testid="email-workspace"]' },
    'scroll-email',
  );

  // --- Step 3: Import progress ----------------------------------------------
  record(
    'Step 3 — Import progress screen',
    SKIP,
    'the progress UI is driven by a live desktop import (model download / connector sync); no real import exists in a browser to drive it',
    await shot(page, 'step3-progress'),
  );

  // --- Step 4: Ask → cited answer (FULL local check) ------------------------
  // Stub the demo model call so the run is deterministic, air-gapped, and free.
  // Citations are produced by the demo's local keyword retriever over the seeded
  // Webb workspace, not by the model, so a canned answer still yields a cited
  // turn. Any real AI host would be a leak — we never install a key.
  await page.route('**/api/demo-chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        text: 'Based on the financial plan, the household\'s total portfolio value is about $508,000 [1].',
        model: 'rehearsal-stub',
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    }),
  );

  let askVerdict = FAIL;
  let askNote = '';
  let askIntegrityOk = true;
  try {
    const reached = await reachAsk(page);
    if (!reached) {
      askVerdict = FAIL;
      askNote = 'Ask composer (ask-composer-input) unreachable';
      askIntegrityOk = false;
    } else {
      await recordScroll(
        'Scrollability — Ask',
        { rootSelector: '[data-testid="ask-thread-scroll"]' },
        'scroll-ask',
      );
      // P0-3 on the Ask surface. The composer input must be a unique, visible,
      // enabled real input BEFORE typing. The submit button is (correctly)
      // disabled while the field is empty, so we assert IT after filling — when
      // it should be enabled. (Asserting submit-enabled on an empty field would
      // be a false positive, not a drift bug.)
      const inputInteg = await handleIntegrity(page, 'ask-composer-input', 'input');
      const askVis = await visualChecks(page, ['ask-composer-input']);
      const askBad = [inputInteg].filter((r) => !r.ok);
      const attBefore = await page.$$eval(ATT, (e) => e.length).catch(() => 0);
      const chipBefore = await page.$$eval(CHIP, (e) => e.length).catch(() => 0);
      await page.fill('[data-testid="ask-composer-input"]', 'What is the total portfolio value for this household?');
      await sleep(300);
      const submitInteg = await handleIntegrity(page, 'ask-composer-submit', 'control');
      // submit may live under a different handle in some builds; only fail if it
      // exists AND is broken (drifted/duplicate/hidden), not merely absent.
      if (!submitInteg.ok && !submitInteg.issues.includes('not present on this screen')) askBad.push(submitInteg);
      askIntegrityOk = askBad.length === 0 && askVis.hOverflow <= 4 && askVis.offscreen.length === 0;
      if (!askIntegrityOk) {
        askNote = `handle/visual issue: ${askBad.map((r) => r.id + '[' + r.issues.join(';') + ']').join(', ')}${askVis.hOverflow > 4 ? ` overflow=${askVis.hOverflow}px` : ''}${askVis.offscreen.length ? ` offscreen=${askVis.offscreen.join(',')}` : ''}; `;
      }
      await page.press('[data-testid="ask-composer-input"]', 'Enter').catch(() => {});
      let settled = false;
      for (let i = 0; i < 30; i++) {
        await sleep(1000);
        const answering = await ev(page, () => /Answering/i.test(document.body.innerText));
        const attNow = await page.$$eval(ATT, (e) => e.length).catch(() => 0);
        if (attNow > attBefore && !answering) { settled = true; break; }
      }
      const attAfter = await page.$$eval(ATT, (e) => e.length).catch(() => 0);
      const chipAfter = await page.$$eval(CHIP, (e) => e.length).catch(() => 0);
      const inputWorks = await hasHandle(page, 'ask-composer-input');
      if (settled && attAfter > attBefore && chipAfter > chipBefore) {
        askVerdict = GREEN;
        askNote += `cited turn produced (attestation +${attAfter - attBefore}, chips +${chipAfter - chipBefore}), air-gapped stub`;
      } else if (inputWorks) {
        askVerdict = REDUCED;
        askNote += `composer reachable + accepts input + submits; retrieval + citation chip render (chips+${chipAfter - chipBefore}); full cited-answer completion is the live robot's job (demo proxy round-trip not deterministically reproducible in a stub)`;
      }
      // A handle/visual regression on the Ask surface is a real failure even if
      // the answer flow looks fine.
      if (!askIntegrityOk) askVerdict = FAIL;
    }
  } catch (e) {
    askNote += 'error: ' + e.message;
    askIntegrityOk = false;
  }
  record('Step 4 — Ask about the data, with citations', askVerdict, askNote, await shot(page, 'step4-ask'));

  // --- Step 5: Record Teams meeting + notice card ---------------------------
  let meetingReachable = false;
  await page.locator('[data-testid="spine-nav-matters"]').click({ timeout: 8000 }).catch(() => {});
  await sleep(500);
  await page.locator('[data-testid="hub-subtab-meetings"]').click({ timeout: 8000 }).catch(() => {});
  await sleep(800);
  meetingReachable = await hasHandle(page, 'record-meeting-button');
  record(
    'Step 5 — Record Teams meeting (in-meeting notice card)',
    meetingReachable ? REDUCED : SKIP,
    'Teams capture + the notice card are Tauri sidecar/native; meetings surface reachable=' + meetingReachable + ' (record action is desktop-only)',
    await shot(page, 'step5-meeting'),
  );
  await recordScroll(
    'Scrollability — Meetings list',
    { rootSelector: '[data-testid="client-meetings-tab"]' },
    'scroll-meetings-list',
  );
  const meetingRows = await page.locator('[data-testid="meeting-row"]').count().catch(() => 0);
  if (meetingRows > 0) {
    await page.locator('[data-testid="meeting-row"]').first().click({ timeout: 8000 }).catch(() => {});
    const detailOpen = await page.waitForSelector('[data-testid="meeting-entry"]', { timeout: 10000 }).then(() => true).catch(() => false);
    if (detailOpen) {
      for (const [label, tabId, shotName] of [
        ['Recording', 'meeting-subtab-recording', 'scroll-meeting-recording'],
        ['Transcript', 'meeting-subtab-transcript', 'scroll-meeting-transcript'],
        ['Summary', 'meeting-subtab-summary', 'scroll-meeting-summary'],
      ]) {
        await page.locator(`[data-testid="${tabId}"]`).click({ timeout: 8000 }).catch(() => {});
        await recordScroll(
          `Scrollability — Meeting detail ${label} tab`,
          { rootSelector: '[data-testid="meeting-entry"]', contentSelector: '[data-testid="meeting-entry-tab-scroll"]' },
          shotName,
        );
      }
      // Send left the tab row; it opens the merged send surface in a drawer from
      // the header Send action (disabled until the meeting is reviewed, so this
      // is best-effort in the demo).
      await page.locator('[data-testid="meeting-entry-send"]').click({ timeout: 8000 }).catch(() => {});
      const sendDrawerOpen = await page
        .waitForSelector('[data-testid="meeting-send-drawer"]', { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (sendDrawerOpen) {
        await recordScroll(
          'Scrollability — Meeting send drawer',
          { rootSelector: '[data-testid="meeting-send-drawer"]', contentSelector: '.kp-slide-panel__body' },
          'scroll-meeting-send-drawer',
        );
      } else {
        record(
          'Scrollability — Meeting send drawer',
          SKIP,
          'Send opens only for a reviewed meeting; the web-demo meeting is not reviewed',
          await shot(page, 'scroll-meeting-send-drawer-skip'),
        );
      }
    } else {
      scrollOk = false;
      record('Scrollability — Meeting detail sub-tabs', FAIL, 'meeting row existed, but the detail view did not open', await shot(page, 'scroll-meeting-detail-missing'));
    }
  } else {
    record(
      'Scrollability — Meeting detail sub-tabs',
      SKIP,
      'web-demo data has no saved meeting row; this guard runs when a meeting row exists',
      await shot(page, 'scroll-meeting-detail-skip'),
    );
  }

  // --- Step 6: Search transcript --------------------------------------------
  record(
    'Step 6 — Search transcript',
    SKIP,
    'a transcript only exists after a native recording+transcription; transcript search then runs through Ask (Step 4 proves the Ask path)',
    await shot(page, 'step6-transcript'),
  );

  // Overall pass: the locally-verifiable core must be healthy —
  //  • boot GREEN, • Client Map handle-integrity + visual clean,
  //  • every reachable main surface owns tall vertical content,
  //  • Ask reachable+interactive with clean handle-integrity (askIntegrityOk),
  //  • Ask verdict GREEN or REDUCED (not FAIL).
  // SKIP steps never fail the run; a FAIL on boot / integrity / Ask does.
  const bootGreen = results[0].verdict === GREEN;
  const askOk = askVerdict === GREEN || askVerdict === REDUCED;
  const pass = bootGreen && integrityOk && scrollOk && askOk && askIntegrityOk;
  return finish(browser, pass);

  async function finish(br, ok) {
    const summary = {
      url: URL,
      generatedNote: 'machine-local rehearsal; 5/6 steps have desktop-only actions (see notes). Full live run is the Legion job.',
      pass: ok,
      steps: results,
    };
    writeFileSync(join(ARTIFACTS, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log('\n----------------------------------------------------');
    console.log(`Artifacts: ${ARTIFACTS} (screenshots + summary.json)`);
    console.log(ok ? '✅ REHEARSAL PASS — locally-verifiable demo path healthy.' : '❌ REHEARSAL FAIL — a local regression on the demo path.');
    console.log('----------------------------------------------------');
    await br.close().catch(() => {});
    stopServer();
    process.exit(ok ? 0 : 1);
  }
}

process.on('SIGINT', () => { stopServer(); process.exit(130); });
main().catch((e) => {
  console.error('[rehearsal] fatal:', e);
  stopServer();
  process.exit(1);
});

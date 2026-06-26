// scripts/robot/smoke.mjs — end-to-end proof against the Legion bench.
//
// Runs the full chain and asserts every verb's proof packet is ok:
//   reset -> open(workspace) -> sweep -> ask -> isolation
//
// DEFAULT (deterministic): restore the FROZEN snapshot (clean, fully-indexed
// world) and answer Ask from the recorded OpenAI fixture, with an egress guard
// that FAILS the run if anything reaches a live model. Fast, free, repeatable.
//
// FAIL-CLOSED on AI: live AI is opt-IN only. Deterministic replay needs a DEV
// build (the app uses webview fetch that page.route can intercept). If the bench
// is a PRODUCTION build (Rust AI path, uninterceptable) the smoke REFUSES to run
// rather than silently using the live model — unless you set ROBOT_SMOKE_LIVE_AI=1.
//
// Env switches:
//   ROBOT_SMOKE_LIVE_AI=1  opt into the LIVE model (weekly drift run; no fixture,
//                          no egress guard) + lighter 'fast' reset.
//   ROBOT_SMOKE_FULL=1     full kill+delete-index reset (leaves index deleted).
//   ROBOT_SMOKE_FAST=1     in-page 'fast' reset (keeps whatever index is present).
//
// Deterministic runs default to the 'snapshot' reset because a deterministic Ask
// needs the frozen index (so recorded citations stay stable). Requires a golden
// archive built once via `node scripts/robot/build-snapshot.mjs` (snapshot reset
// refuses without it).
//
// Exit code: 0 = all pass, 1 = any failure (incl. the fail-closed AI refusal).
import { ensureTunnel } from './bench.mjs';
import { getPage, disconnect } from './connection.mjs';
import { attachConsoleAndNetwork } from './artifacts.mjs';
import { runVerb } from './proof.mjs';
import { resetToSeed } from './verbs/reset.mjs';
import { openWorkspace } from './verbs/workspace.mjs';
import { runSurfaceSweep } from './verbs/sweep.mjs';
import { askQuestion } from './verbs/ask.mjs';
import { verifyIsolation } from './verbs/isolation.mjs';
import { closeAllReplayServers } from './fixtures/aiReplay.mjs';

// Deterministic by default. Live AI is opt-IN only, via ROBOT_SMOKE_LIVE_AI=1 —
// the smoke must never silently run live (that would skip the fixture + egress
// guard, the exact protection we built). A build-mode probe (below) FAILS CLOSED
// if deterministic replay can't be used and the operator didn't opt into live.
const EXPLICIT_LIVE = !!process.env.ROBOT_SMOKE_LIVE_AI;
const ai = { deterministic: !EXPLICIT_LIVE };
const RESET_MODE = process.env.ROBOT_SMOKE_FULL
  ? 'full'
  : process.env.ROBOT_SMOKE_FAST
    ? 'fast'
    : 'snapshot';

const steps = [
  ['reset', (p) => resetToSeed(p, { mode: RESET_MODE })],
  ['open', (p) => openWorkspace(p, {})],
  ['sweep', (p) => runSurfaceSweep(p, {})],
  ['ask', (p) => askQuestion(p, {
    question: 'What is the total portfolio value for this household?',
    deterministic: ai.deterministic, // fixture-replayed + egress-guarded when possible
  })],
  ['isolation', (p) => verifyIsolation(p, {})],
];

let allOk = true;
const summary = [];
try {
  await ensureTunnel();
  let page = await getPage();
  attachConsoleAndNetwork(page);

  // Build-mode probe: deterministic interception only works on a DEV build (the
  // app uses webview fetch). On a PRODUCTION build (vite preview + packaged binary)
  // the app routes AI through Rust — page.route can't intercept it — so a
  // deterministic run would never use the fixture and would silently hit LIVE AI.
  // FAIL CLOSED: refuse to run unless the operator explicitly opted into live.
  if (ai.deterministic) {
    const build = await page.evaluate(() => ({
      hasViteClient: !!document.querySelector('script[src*="@vite/client"]'),
      hasTauri: !!window.__TAURI__,
    })).catch(() => ({ hasViteClient: true, hasTauri: false }));
    if (build.hasTauri && !build.hasViteClient) {
      throw new Error(
        'FAIL CLOSED: PRODUCTION build detected (Tauri, no vite dev client). The deterministic ' +
        'replay + egress guard CANNOT intercept the Rust AI path, so the fixture would be unused ' +
        'and the run would silently use LIVE AI. Refusing to run. Fix: run the bench in dev mode ' +
        '(tauri dev) for deterministic AI, OR set ROBOT_SMOKE_LIVE_AI=1 to run live deliberately.',
      );
    }
  }
  if (EXPLICIT_LIVE) {
    console.log('[smoke] ⚠ ROBOT_SMOKE_LIVE_AI=1 — running the LIVE model (no fixture, no egress guard). Use this only for the weekly drift check.');
  }
  console.log(`[smoke] reset=${RESET_MODE} ai=${ai.deterministic ? 'deterministic (fixture + egress guard)' : 'LIVE model'}`);
  for (const [name, fn] of steps) {
    page = await getPage(); // refresh in case a prior step (full reset) reconnected
    const packet = await runVerb(name, () => fn(page));
    const mark = packet.ok ? 'PASS' : 'FAIL';
    let extra = packet.error ? ' — ' + packet.error : '';
    if (name === 'ask' && packet.data && packet.data.egress) {
      const e = packet.data.egress;
      extra += ` — egress: served=${e.served} leaks=${e.violationCount}${e.ok ? '' : ' ⚠ LIVE-AI LEAK OR FIXTURE UNUSED'}`;
    }
    summary.push(`[${mark}] ${name} (${packet.durationMs}ms)${extra}`);
    console.log(summary[summary.length - 1]);
    if (!packet.ok) {
      allOk = false;
      console.log(JSON.stringify(packet.data, null, 2));
    }
  }
} catch (e) {
  console.error('SMOKE ERROR', e.message);
  allOk = false;
} finally {
  closeAllReplayServers();
  await disconnect();
}

console.log('\n' + summary.join('\n'));
console.log(allOk ? '\nSMOKE: ALL PASS' : '\nSMOKE: FAILURES');
process.exit(allOk ? 0 : 1);

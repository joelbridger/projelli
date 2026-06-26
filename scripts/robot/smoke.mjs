// scripts/robot/smoke.mjs — end-to-end proof against the Legion bench.
//
// Runs the full chain and asserts every verb's proof packet is ok:
//   reset -> open(workspace) -> sweep -> ask -> isolation
//
// DEFAULT (deterministic): restore the FROZEN snapshot (clean, fully-indexed
// world) and answer Ask from the recorded OpenAI fixture, with an egress guard
// that FAILS the run if anything reaches a live model. Fast, free, repeatable.
//
// Env switches:
//   ROBOT_SMOKE_LIVE_AI=1  weekly drift run: real model + lighter 'fast' reset.
//   ROBOT_SMOKE_FULL=1     full kill+delete-index reset (leaves index deleted).
//   ROBOT_SMOKE_FAST=1     in-page 'fast' reset (keeps whatever index is present).
//
// Reset mode is bound to determinism: a deterministic Ask needs the frozen index
// (so the recorded citations stay stable), so deterministic runs default to the
// 'snapshot' restore. Requires a golden archive built once via
// `node scripts/robot/build-snapshot.mjs` (snapshot reset refuses without it).
//
// Exit code: 0 = all pass, 1 = any failure.
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

// AI mode is mutable: a build-mode probe (below) may force it to LIVE if the
// bench is a PRODUCTION build, where the AI call goes through the Tauri Rust HTTP
// plugin and page.route (the deterministic replay + egress guard) cannot see it.
const ai = { deterministic: !process.env.ROBOT_SMOKE_LIVE_AI };
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
  // app uses webview fetch). On a PRODUCTION build (vite preview + packaged
  // binary) the app routes AI through Rust — page.route can't intercept it — so a
  // deterministic run would never use the fixture. Fall back to LIVE with a loud
  // warning rather than failing confusingly.
  if (ai.deterministic) {
    const build = await page.evaluate(() => ({
      hasViteClient: !!document.querySelector('script[src*="@vite/client"]'),
      hasTauri: !!window.__TAURI__,
    })).catch(() => ({ hasViteClient: true, hasTauri: false }));
    if (build.hasTauri && !build.hasViteClient) {
      ai.deterministic = false;
      console.log('[smoke] ⚠ PRODUCTION build detected (Tauri, no vite dev client): AI goes through Rust, which page.route cannot intercept. Falling back to LIVE model. Run the bench in dev mode (tauri dev) for deterministic AI.');
    }
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

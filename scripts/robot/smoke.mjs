// scripts/robot/smoke.mjs — end-to-end live proof against the Legion bench.
//
// Runs the full chain and asserts every verb's proof packet is ok:
//   reset(fast) -> open(workspace) -> sweep -> ask -> isolation
//
// Default reset is 'fast' (purge residue + reseed, KEEPS the existing index so
// ask/isolation have something to retrieve). Set ROBOT_SMOKE_FULL=1 for a full
// kill+delete-index+restart reset (NOTE: full mode wipes the index; ask/isolation
// then need a re-index step that this MVP does not yet provide).
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

const RESET_MODE = process.env.ROBOT_SMOKE_FULL ? 'full' : 'fast';

const steps = [
  ['reset', (p) => resetToSeed(p, { mode: RESET_MODE })],
  ['open', (p) => openWorkspace(p, {})],
  ['sweep', (p) => runSurfaceSweep(p, {})],
  ['ask', (p) => askQuestion(p, {
    question: 'What is the total portfolio value for this household?',
    // Live model for now: deterministic replay infra is built + unit-tested, but a
    // provider-accurate OpenAI SSE fixture must be recorded first (top fast-follow).
    deterministic: false,
  })],
  ['isolation', (p) => verifyIsolation(p, {})],
];

let allOk = true;
const summary = [];
try {
  await ensureTunnel();
  let page = await getPage();
  attachConsoleAndNetwork(page);
  for (const [name, fn] of steps) {
    page = await getPage(); // refresh in case a prior step (full reset) reconnected
    const packet = await runVerb(name, () => fn(page));
    const mark = packet.ok ? 'PASS' : 'FAIL';
    summary.push(`[${mark}] ${name} (${packet.durationMs}ms)${packet.error ? ' — ' + packet.error : ''}`);
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

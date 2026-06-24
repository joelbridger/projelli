// scripts/robot/cli.mjs — call the robot.
//
//   node scripts/robot/cli.mjs <verb> ['{json args}'] [--no-daemon] [--port N]
//
// Default: POST to the running daemon (scripts/robot/server.mjs).
// --no-daemon: connect + run the verb directly in this process (no daemon needed).
// Exit code mirrors the proof packet's ok (0 = pass, 1 = fail).
import { ensureTunnel } from './bench.mjs';
import { getPage, disconnect } from './connection.mjs';
import { attachConsoleAndNetwork } from './artifacts.mjs';
import { runVerb } from './proof.mjs';
import { resetToSeed } from './verbs/reset.mjs';
import { openWorkspace } from './verbs/workspace.mjs';
import { runSurfaceSweep } from './verbs/sweep.mjs';
import { askQuestion } from './verbs/ask.mjs';
import { verifyIsolation } from './verbs/isolation.mjs';

const VERBS = {
  reset: resetToSeed,
  open: openWorkspace,
  sweep: runSurfaceSweep,
  ask: askQuestion,
  isolation: verifyIsolation,
};

const argv = process.argv.slice(2);
const verb = argv[0];
const noDaemon = argv.includes('--no-daemon');
const portIdx = argv.indexOf('--port');
const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : Number(process.env.ROBOT_PORT || 7331);

const jsonArg = argv.slice(1).find((a) => a.startsWith('{'));
let args = {};
if (jsonArg) {
  try { args = JSON.parse(jsonArg); } catch (e) { console.error('bad JSON args:', e.message); process.exit(2); }
}

if (!verb || !VERBS[verb]) {
  console.error(`usage: cli.mjs <${Object.keys(VERBS).join('|')}> ['{json}'] [--no-daemon] [--port N]`);
  process.exit(2);
}

async function viaDaemon() {
  const res = await fetch(`http://127.0.0.1:${port}/v/${verb}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  return res.json();
}

async function direct() {
  await ensureTunnel();
  const page = await getPage();
  attachConsoleAndNetwork(page);
  const packet = await runVerb(verb, () => VERBS[verb](page, args));
  await disconnect();
  return packet;
}

try {
  const packet = noDaemon ? await direct() : await viaDaemon();
  console.log(JSON.stringify(packet, null, 2));
  process.exit(packet.ok ? 0 : 1);
} catch (e) {
  console.error('ERR', e.message);
  process.exit(1);
}

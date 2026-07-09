#!/usr/bin/env node
// scripts/bench-smoke.mjs — scripted smoke harness for the Windows/Azure
// bench, automating the manual smoke checklist in
// docs/evidence/windows-smoke-2/RUN-LOG.md. Drives the app over CDP via the
// unmodified scripts/desktop-drive.mjs, invoked as a subprocess over SSH
// exactly like scripts/legion-drive.sh — see scripts/bench-smoke/README (or
// docs/qa/BENCH-SMOKE-HARNESS.md) for the full design and how to add checks.
//
// Usage:
//   node scripts/bench-smoke.mjs --plan                     # print the checklist, touch nothing
//   node scripts/bench-smoke.mjs --target legion             # run all checks against the Legion
//   node scripts/bench-smoke.mjs --target azure-cloud-bench-1
//   node scripts/bench-smoke.mjs --only wave2-wealthbox-queue-review
//   node scripts/bench-smoke.mjs --only a,b --only c       # run several checks
//   node scripts/bench-smoke.mjs --live                      # ALSO run the sandbox-only Approve step
//   node scripts/bench-smoke.mjs --host 100.x.x.x --user someuser --repo-dir 'C:\lantern-plus'
//
// Exit codes: 0 = all checks that ran PASSED. 1 = at least one FAIL.
// 3 = no FAIL, but at least one SETUP-BLOCKED (bench/data wasn't ready).
// 4 = no FAIL/SETUP-BLOCKED, but TODO/SKIPPED checks remain (not green).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTarget, listTargets } from './bench-smoke/targets.mjs';
import { Driver } from './bench-smoke/driver.mjs';
import { CHECKLIST, STUBS, allCheckIds, findCheck } from './bench-smoke/checklist.mjs';
import { STATUS, makeResult, summarize, aggregateExitCode, toMarkdownTable } from './bench-smoke/result.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');

function parseArgs(argv) {
  const args = { target: undefined, host: undefined, user: undefined, repoDir: undefined, plan: false, live: false, onlyIds: [], evidenceDir: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') args.target = argv[++i];
    else if (a === '--host') args.host = argv[++i];
    else if (a === '--user') args.user = argv[++i];
    else if (a === '--repo-dir') args.repoDir = argv[++i];
    else if (a === '--plan') args.plan = true;
    else if (a === '--live') args.live = true;
    else if (a === '--only') args.onlyIds.push(...String(argv[++i]).split(',').map((id) => id.trim()).filter(Boolean));
    else if (a === '--evidence-dir') args.evidenceDir = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function printHelp() {
  console.log(`bench-smoke.mjs — scripted Windows/Azure bench smoke harness

  --plan                 Print the checklist (id, section, title) and exit. Touches nothing.
  --target <id>          Bench to run against (known: ${listTargets().map((t) => t.id).join(', ')}). Default: legion.
  --host / --user / --repo-dir   Override or fully specify an ad hoc target.
  --only <check-id>       Run one or more checks by id. Repeat it or pass a comma list.
  --live                  Also run sandbox-only checks that mutate state (e.g. Wealthbox Approve).
  --evidence-dir <path>   Where to write screenshots + summary.json. Default: docs/evidence/bench-smoke/<target>-<timestamp>/
  --help                  This message.

Known check ids: ${allCheckIds().join(', ')}
`);
}

function printPlan() {
  const rows = [...CHECKLIST, ...STUBS].map((c) => ({ id: c.id, section: c.section, title: c.title, liveOnly: !!c.liveOnly }));
  console.log(JSON.stringify(rows, null, 2));
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function primeConsoleWatch(driver) {
  try {
    await driver.installConsoleWatch();
    await driver.readConsoleErrors();
  } catch {
    // Best-effort evidence hook only. A console-watch setup problem should not
    // change the result of the check that is about to run.
  }
}

async function collectFailureForensics(result, driver) {
  const forensics = { files: [], console: null, errors: [] };
  const screenshots = [...(result.screenshots ?? [])];

  try {
    const consoleCapture = await driver.readConsoleErrors();
    forensics.console = consoleCapture;
  } catch (err) {
    forensics.errors.push(`console capture failed: ${err.message}`);
  }

  try {
    const shot = await driver.captureScreenshot(`failure-${result.id}`);
    screenshots.push(shot);
    forensics.files.push(shot);
  } catch (err) {
    forensics.errors.push(`failure screenshot failed: ${err.message}`);
  }

  try {
    const log = await driver.captureAppLogTail(`failure-${result.id}-tauri-dev-tail`, { lineCount: 200 });
    forensics.files.push(log);
  } catch (err) {
    forensics.errors.push(`app log tail failed: ${err.message}`);
  }

  return { ...result, screenshots, forensics };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  if (args.plan) return printPlan();

  const target = resolveTarget(args.target, { host: args.host, user: args.user, repoDir: args.repoDir });
  const evidenceDir =
    args.evidenceDir ?? path.join(REPO_ROOT, 'docs', 'evidence', 'bench-smoke', `${target.id}-${timestamp()}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const driver = new Driver(target, { evidenceDir });
  console.log(`[bench-smoke] target: ${target.label} (${target.sshUser}@${target.sshHost})`);
  console.log(`[bench-smoke] evidence dir: ${evidenceDir}`);

  const reachable = await driver.isReachable();
  console.log(`[bench-smoke] reachable: ${reachable}`);

  if (reachable) {
    const originCheck = await driver.assertSameOrigin();
    console.log(`[bench-smoke] origin preflight: ${originCheck.fetchUrl} matches ${originCheck.webviewOrigin}`);

    const overlay = await driver.dismissBlockingOverlay();
    if (overlay.before > 0) {
      console.log(
        `[bench-smoke] dismissed a pre-existing open overlay via Escape (open elements: ${overlay.before} -> ${overlay.after})`
      );
    }
  }

  const selectedChecks = args.onlyIds.length > 0 ? args.onlyIds.map((id) => findCheck(id)) : CHECKLIST;
  const unknownIds = args.onlyIds.filter((id) => !findCheck(id));
  if (unknownIds.length > 0) {
    throw new Error(`Unknown check id(s): ${unknownIds.join(', ')}. Known ids: ${allCheckIds().join(', ')}`);
  }
  const checksToRun = args.onlyIds.length > 0 ? selectedChecks.filter((c) => c && CHECKLIST.includes(c)) : CHECKLIST;
  const stubsToRun = args.onlyIds.length > 0 ? selectedChecks.filter((c) => c && STUBS.includes(c)) : STUBS;

  const results = [];

  if (!reachable) {
    for (const check of checksToRun) {
      if (STUBS.includes(check)) continue;
      results.push(
        makeResult({
          id: check.id,
          section: check.section,
          status: STATUS.SETUP_BLOCKED,
          detail: `Bench ${target.label} (${target.sshHost}) was not reachable over SSH within the probe timeout.`,
        })
      );
    }
  } else {
    for (const check of checksToRun) {
      if (STUBS.includes(check)) continue;
      // Best-effort: a modal a PREVIOUS check opened (e.g. wave0's Draft
      // follow-up dialog) can still be open and intercept this check's own
      // clicks — confirmed live. Dismiss before every check, not just once
      // at the very start.
      await driver.dismissBlockingOverlay();
      await primeConsoleWatch(driver);
      console.log(`[bench-smoke] running: ${check.id}`);
      let result = await check.run({ driver, live: args.live, target });
      if (result.status === STATUS.FAIL) {
        result = await collectFailureForensics(result, driver);
      }
      console.log(`[bench-smoke]   -> ${result.status}: ${result.detail}`);
      results.push(result);
    }
  }

  for (const stub of stubsToRun) {
    results.push(await stub.run());
  }

  const summary = summarize(results, { generatedAt: new Date().toISOString(), target: target.id, live: args.live });
  fs.writeFileSync(path.join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log('');
  console.log(toMarkdownTable(results));
  console.log('');
  console.log(`[bench-smoke] overall: ${summary.overall}`);
  console.log(`[bench-smoke] summary written to ${path.join(evidenceDir, 'summary.json')}`);

  process.exitCode = aggregateExitCode(results);
}

main().catch((err) => {
  console.error(`[bench-smoke] fatal: ${err.stack || err.message}`);
  process.exitCode = 1;
});

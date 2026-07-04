#!/usr/bin/env node
// Run the bench smoke checklist across several benches at once, then merge the
// child summaries into one combined verdict.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CHECKLIST, STUBS, allCheckIds, findCheck } from './bench-smoke/checklist.mjs';
import { listTargets, resolveTarget } from './bench-smoke/targets.mjs';
import { STATUS, makeResult, summarize, toMarkdownTable } from './bench-smoke/result.mjs';
import { splitChecksAcrossTargets, mergeShardSummaries, aggregateShardExitCode } from './bench-smoke/shard.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const BENCH_SMOKE = path.join(REPO_ROOT, 'scripts', 'bench-smoke.mjs');

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function parseArgs(argv) {
  const args = { targetIds: [], adhocTargets: [], onlyIds: [], plan: false, live: false, evidenceDir: undefined, help: false };
  let currentAdhoc = null;

  const ensureAdhoc = () => {
    if (!currentAdhoc) {
      currentAdhoc = {};
      args.adhocTargets.push(currentAdhoc);
    }
    return currentAdhoc;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--targets') args.targetIds.push(...String(argv[++i]).split(',').map((id) => id.trim()).filter(Boolean));
    else if (a === '--target') args.targetIds.push(argv[++i]);
    else if (a === '--target-id') ensureAdhoc().id = argv[++i];
    else if (a === '--target-host') {
      if (currentAdhoc?.host) currentAdhoc = null;
      ensureAdhoc().host = argv[++i];
    }
    else if (a === '--target-user') ensureAdhoc().user = argv[++i];
    else if (a === '--target-repo-dir') ensureAdhoc().repoDir = argv[++i];
    else if (a === '--only') args.onlyIds.push(...String(argv[++i]).split(',').map((id) => id.trim()).filter(Boolean));
    else if (a === '--plan') args.plan = true;
    else if (a === '--live') args.live = true;
    else if (a === '--evidence-dir') args.evidenceDir = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function printHelp() {
  console.log(`bench-smoke-shard.mjs — shard smoke checks across benches

  --plan                       Print the shard plan and exit. Touches nothing.
  --targets <a,b>              Known targets to use. Known: ${listTargets().map((t) => t.id).join(', ')}
  --target <id>                Add one known target. Can be repeated.
  --target-host <host> --target-user <user> [--target-repo-dir <dir>] [--target-id <id>]
                               Add an ad hoc bench target. Repeat the triple for more.
  --only <check-id[,id]>       Optional subset. Repeat or pass a comma list.
  --live                       Forward --live to child smoke runs.
  --evidence-dir <path>        Combined evidence directory.
  --help                       This message.
`);
}

function buildTargetSpecs(args) {
  const specs = [];
  for (const id of args.targetIds) {
    const target = resolveTarget(id);
    specs.push({ id: target.id, label: target.label, childArgs: ['--target', id] });
  }

  args.adhocTargets.forEach((adhoc, index) => {
    if (!adhoc.host || !adhoc.user) {
      throw new Error('Each ad hoc shard target needs --target-host and --target-user.');
    }
    const id = adhoc.id || `adhoc-${index + 1}`;
    const target = resolveTarget(id, { host: adhoc.host, user: adhoc.user, repoDir: adhoc.repoDir });
    const childArgs = ['--target', id, '--host', target.sshHost, '--user', target.sshUser];
    if (target.repoDir) childArgs.push('--repo-dir', target.repoDir);
    specs.push({ id: target.id, label: target.label, childArgs });
  });

  return specs;
}

function selectedChecks(onlyIds) {
  const ids = onlyIds.length > 0 ? onlyIds : allCheckIds();
  const unknown = ids.filter((id) => !findCheck(id));
  if (unknown.length > 0) throw new Error(`Unknown check id(s): ${unknown.join(', ')}. Known ids: ${allCheckIds().join(', ')}`);
  return ids.map((id) => findCheck(id));
}

function runChildShard(shard, { evidenceDir, live }) {
  return new Promise((resolve) => {
    const shardDir = path.join(evidenceDir, `shard-${shard.index + 1}-${shard.target.id}`);
    fs.mkdirSync(shardDir, { recursive: true });
    const childArgs = [
      BENCH_SMOKE,
      ...shard.target.childArgs,
      '--evidence-dir',
      shardDir,
      ...shard.checkIds.flatMap((id) => ['--only', id]),
      ...(live ? ['--live'] : []),
    ];

    const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
      process.stdout.write(String(d).replace(/^/gm, `[${shard.target.id}] `));
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      process.stderr.write(String(d).replace(/^/gm, `[${shard.target.id}] `));
    });
    child.on('close', (code) => {
      const summaryPath = path.join(shardDir, 'summary.json');
      if (fs.existsSync(summaryPath)) {
        try {
          const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
          resolve({ code, summary, summaryPath, stdout, stderr });
          return;
        } catch (err) {
          resolve({ code, summary: syntheticShardFailure(shard, `Could not parse ${summaryPath}: ${err.message}`), summaryPath, stdout, stderr });
          return;
        }
      }
      resolve({ code, summary: syntheticShardFailure(shard, `Shard exited ${code}; no summary.json was written.`), summaryPath, stdout, stderr });
    });
    child.on('error', (err) => {
      resolve({ code: -1, summary: syntheticShardFailure(shard, `Could not start shard process: ${err.message}`), summaryPath: null, stdout, stderr });
    });
  });
}

function syntheticShardFailure(shard, detail) {
  return summarize(
    [
      makeResult({
        id: `shard-${shard.target.id}`,
        section: 'Shard runner',
        status: STATUS.FAIL,
        detail,
      }),
    ],
    { generatedAt: new Date().toISOString(), target: shard.target.id }
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  let targets = buildTargetSpecs(args);
  if (targets.length === 0 && args.plan) {
    targets = listTargets().map((target) => ({ id: target.id, label: target.label, childArgs: ['--target', target.id] }));
  }
  if (targets.length === 0) {
    throw new Error('Pass at least one target with --targets, --target, or --target-host/--target-user.');
  }

  const checks = selectedChecks(args.onlyIds);
  const shards = splitChecksAcrossTargets(checks, targets).filter((shard) => shard.checkIds.length > 0);

  if (args.plan) {
    console.log(JSON.stringify(shards.map((shard) => ({ target: shard.target.id, checks: shard.checkIds })), null, 2));
    return;
  }

  const evidenceDir = args.evidenceDir ?? path.join(REPO_ROOT, 'docs', 'evidence', 'bench-smoke', `sharded-${timestamp()}`);
  fs.mkdirSync(evidenceDir, { recursive: true });
  console.log(`[bench-smoke-shard] evidence dir: ${evidenceDir}`);
  console.log(`[bench-smoke-shard] shards: ${shards.map((s) => `${s.target.id} (${s.checkIds.length})`).join(', ')}`);

  const childRuns = await Promise.all(shards.map((shard) => runChildShard(shard, { evidenceDir, live: args.live })));
  const combined = mergeShardSummaries(childRuns.map((run) => run.summary), {
    generatedAt: new Date().toISOString(),
    live: args.live,
    orderedIds: allCheckIds(),
  });

  const summaryPath = path.join(evidenceDir, 'summary.json');
  const markdownPath = path.join(evidenceDir, 'summary.md');
  fs.writeFileSync(summaryPath, JSON.stringify(combined, null, 2));
  fs.writeFileSync(markdownPath, `${toMarkdownTable(combined.results)}\n`);

  console.log('');
  console.log(toMarkdownTable(combined.results));
  console.log('');
  console.log(`[bench-smoke-shard] overall: ${combined.overall}`);
  console.log(`[bench-smoke-shard] summary written to ${summaryPath}`);
  console.log(`[bench-smoke-shard] markdown written to ${markdownPath}`);

  process.exitCode = aggregateShardExitCode(combined);
}

main().catch((err) => {
  console.error(`[bench-smoke-shard] fatal: ${err.stack || err.message}`);
  process.exitCode = 1;
});

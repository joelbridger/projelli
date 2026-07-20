#!/usr/bin/env node
/**
 * Renders the drain-shape table as markdown FROM the corpus.
 *
 * This script exists so that no report ever hand-writes a proof table again.
 * A previous round printed a 23-row table whose cells were paraphrases of the
 * probes the self-test actually ran — 21 of 23 probes silently carried an
 * `as any` the table did not print, and three cells were therefore FALSE as
 * printed: fed to the real `scanSource()` exactly as rendered, they produced
 * zero violations. Here the CHECKER column is computed by calling the real
 * `scanSource()` on the exact `source` string in the corpus, and the RUNTIME
 * columns are read from `bun scripts/drain-corpus-runtime.ts`, which executes
 * that same string. A cell cannot describe a different artifact than the one
 * under test, because there is only one artifact.
 *
 *   node scripts/render-drain-corpus.mjs            # checker column only
 *   node scripts/render-drain-corpus.mjs --runtime  # + measured runtime columns
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanSource } from './check-backend-body-readers.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const corpus = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/drain-shape-corpus.json'), 'utf8')).shapes;

let runtime = null;
if (process.argv.includes('--runtime')) {
  runtime = JSON.parse(execFileSync('bun', ['scripts/drain-corpus-runtime.ts'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}

const cell = (s) => `\`${String(s).replaceAll('\n', ' ⏎ ').replaceAll('|', '\\|')}\``;
const groups = [...new Set(corpus.map((s) => s.group))];

for (const group of groups) {
  console.log(`\n### ${group}\n`);
  const head = ['#', 'Shape — the exact source scanned AND run', 'Checker rules that fire'];
  if (runtime) head.push('Bytes recovered — raw Request (= merge base)', 'Bytes recovered — this branch');
  console.log(`| ${head.join(' | ')} |`);
  console.log(`|${head.map(() => '---').join('|')}|`);
  for (const shape of corpus.filter((s) => s.group === group)) {
    const fired = [...new Set(scanSource(shape.path, shape.source).map((v) => v.rule))].sort();
    const row = [shape.id, cell(shape.source), fired.length ? fired.map((r) => `\`${r}\``).join('<br>') : '*none*'];
    if (runtime) {
      const r = runtime[shape.id];
      if (!r || r.skipped) row.push('*type-only*', '*type-only*');
      else {
        row.push(r.raw.bytes > 0 ? `**${r.raw.bytes}**` : `0 — ${r.raw.threw ? 'threw' : 'no bytes'}`);
        row.push(r.envelope.bytes > 0 ? `**${r.envelope.bytes}**` : `0 — ${r.envelope.threw ? 'threw' : 'no bytes'}`);
      }
    }
    console.log(`| ${row.join(' | ')} |`);
  }
}

if (runtime) {
  const runnable = corpus.filter((s) => s.mode === 'handler');
  const drainRaw = runnable.filter((s) => runtime[s.id].raw.bytes > 0).length;
  const drainEnv = runnable.filter((s) => runtime[s.id].envelope.bytes > 0).length;
  const detected = corpus.filter((s) => s.expectRules.length > 0).length;
  console.log(`\n**${runnable.length} runnable shapes: ${drainRaw} recover bytes from a raw Request, ${drainEnv} from this branch's envelope. ${detected} of ${corpus.length} corpus shapes are also refused statically.**`);
}

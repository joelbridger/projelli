// scripts/robot/build-snapshot.mjs — ONE-TIME job: freeze a fully-indexed
// Northcrest workspace into a golden archive that reset({mode:'snapshot'})
// restores in seconds (instead of re-importing + re-embedding every run).
//
// Precondition (operator's job, once): the canonical workspace
//   C:\keepance-demo-northcrest\Northcrest Wealth Partners
// already contains the demo documents and the app (KeepanceDev) is running.
//
// What it does, in order:
//   1. open the Northcrest workspace (this kicks off auto-indexing)
//   2. WAIT until the RAG index is built + stable (poll rag_retrieve hit count)
//   3. PROVE the world is good: isolation (matter-scoped, no leaks) + a cited Ask
//   4. kill the app (release LanceDB/WebView2 file locks)
//   5. tar the workspace (+ its .keepance index/stores) -> golden archive
//   6. write the manifest next to the archive
//   7. restart the app so the bench is left usable
//
// Run (needs the SSH tunnel up — bench.ensureTunnel handles it):
//   node scripts/robot/build-snapshot.mjs [--version=N] [--skip-index-wait]
//
// Env:
//   BUILD_SNAPSHOT_INDEX_TIMEOUT_MS  index-wait budget (default 1_200_000 = 20m)
//
// SAFETY: this only WRITES the archive; it never deletes the live workspace.
// (The destructive restore lives in reset.mjs's snapshot mode, behind a guard.)
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  ensureTunnel,
  killApp,
  restartApp,
  waitForPorts,
  sshExec,
  scpTo,
  archiveWorkspace,
  buildManifest,
  snapshotStatus,
  WS_ROOT,
  WS_KEEPANCE_INDEX,
  SNAPSHOT_ARCHIVE,
  SNAPSHOT_MANIFEST,
} from './bench.mjs';
import { getPage, reconnect, disconnect } from './connection.mjs';
import { openWorkspace } from './verbs/workspace.mjs';
import { verifyIsolation } from './verbs/isolation.mjs';
import { askQuestion } from './verbs/ask.mjs';

const args = process.argv.slice(2);
const SKIP_INDEX_WAIT = args.includes('--skip-index-wait');
const VERSION = Number((args.find((a) => a.startsWith('--version=')) || '--version=1').split('=')[1]) || 1;
const INDEX_TIMEOUT_MS = Number(process.env.BUILD_SNAPSHOT_INDEX_TIMEOUT_MS || 1_200_000);

const log = (m) => console.log(`[build-snapshot] ${m}`);

/** Poll rag_retrieve until the hit count is non-zero and stable across polls. */
async function waitForIndex(page, { timeoutMs = INDEX_TIMEOUT_MS, stableNeeded = 3, pollMs = 8000 } = {}) {
  let last = -1;
  let stable = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page
      .evaluate(async () => {
        const inv = window.__TAURI__ && (window.__TAURI__.core?.invoke || window.__TAURI__.invoke);
        if (!inv) return -1;
        try {
          const hits = await inv('rag_retrieve', {
            query: 'portfolio retirement estate tax meeting statement goals trust holdings',
            topK: 50,
            scope: { kind: 'allMatters' },
            includePrivileged: false,
          });
          return Array.isArray(hits) ? hits.length : -1;
        } catch {
          return -1;
        }
      })
      .catch(() => -1);
    if (count > 0 && count === last) {
      stable += 1;
      log(`index poll: ${count} hits (stable ${stable}/${stableNeeded})`);
      if (stable >= stableNeeded) return { ok: true, count };
    } else {
      stable = 0;
      log(`index poll: ${count} hits (settling)`);
    }
    last = count;
    await sleep(pollMs);
  }
  return { ok: false, count: last, reason: 'index-wait timeout' };
}

/** Read the on-disk index schema version (proof the index actually wrote). */
function readIndexVersion() {
  try {
    const out = sshExec(
      `$p='${WS_KEEPANCE_INDEX}\\vectors\\.index_version'; if (Test-Path -LiteralPath $p) { Get-Content -LiteralPath $p -Raw } else { '' }`,
    );
    const n = parseInt(String(out).trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Local short git sha of the demo-data set used to populate the workspace. */
function readDemoDataCommit() {
  try {
    return execFileSync('git', ['-C', `${process.env.HOME}/keepance-demo-data`, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

async function main() {
  let proof = { steps: {} };
  await ensureTunnel();
  let page = await getPage();

  // 1. Open the workspace (auto-indexing starts on open).
  log('opening Northcrest workspace…');
  proof.steps.open = await openWorkspace(page, {});
  if (!proof.steps.open.ok) throw new Error(`open failed: ${JSON.stringify(proof.steps.open)}`);

  // 2. Wait for the index to be built + stable.
  if (SKIP_INDEX_WAIT) {
    log('--skip-index-wait: assuming the index is already complete');
    proof.steps.index = { ok: true, skipped: true };
  } else {
    log('waiting for the RAG index to finish building…');
    proof.steps.index = await waitForIndex(page);
    if (!proof.steps.index.ok) throw new Error(`index did not stabilize: ${JSON.stringify(proof.steps.index)}`);
    log(`index stable at ${proof.steps.index.count} hits`);
  }

  // 3. Prove the world is good BEFORE we freeze it.
  log('proving isolation (matter-scoped, no cross-client leaks)…');
  proof.steps.isolation = await verifyIsolation(page, {});
  if (!proof.steps.isolation.ok) throw new Error(`isolation failed — refusing to freeze a leaky world: ${JSON.stringify(proof.steps.isolation)}`);

  log('proving a cited Ask works (live model — provenance for the fixture later)…');
  proof.steps.ask = await askQuestion(page, { deterministic: false });
  if (!proof.steps.ask.ok) throw new Error(`ask failed — refusing to freeze a world that can't answer: ${JSON.stringify(proof.steps.ask)}`);

  const indexVersion = readIndexVersion();
  const demoDataCommit = readDemoDataCommit();

  // 4. Kill the app to release file locks before archiving.
  log('killing app to release LanceDB/WebView2 locks…');
  await disconnect();
  killApp();

  // 5. Archive the workspace (+ .keepance) into the golden tar.
  log(`archiving ${WS_ROOT} -> ${SNAPSHOT_ARCHIVE}…`);
  const archived = archiveWorkspace();
  proof.steps.archive = archived;
  if (!archived || archived.ok !== true) throw new Error(`archive failed: ${JSON.stringify(archived)}`);
  log(`archive: ${archived.archiveBytes} bytes, sha256=${archived.sha256}`);

  // 6. Write the manifest next to the archive.
  const manifest = buildManifest({
    version: VERSION,
    createdAt: new Date().toISOString(),
    archiveBytes: archived.archiveBytes,
    sha256: archived.sha256,
    indexVersion,
    mattersCount: 26,
    demoDataCommit,
  });
  const localManifest = join(tmpdir(), 'northcrest-golden.manifest.json');
  writeFileSync(localManifest, JSON.stringify(manifest, null, 2));
  scpTo(localManifest, SNAPSHOT_MANIFEST.replace(/\\/g, '/'));
  proof.steps.manifest = manifest;
  log('manifest written.');

  // 7. Confirm the snapshot is now visible to the restore path, then restart.
  const status = snapshotStatus();
  proof.steps.status = status;
  log(`snapshot status after build: ${JSON.stringify(status)}`);

  log('restarting app so the bench is left usable…');
  restartApp();
  await waitForPorts();
  await reconnect().catch(() => {});

  proof.ok = !!(status && status.ok && status.exists && status.archiveBytes > 0);
  return proof;
}

main()
  .then(async (proof) => {
    await disconnect().catch(() => {});
    console.log('\n=== BUILD-SNAPSHOT RESULT ===');
    console.log(JSON.stringify(proof, null, 2));
    console.log(proof.ok ? '\nSNAPSHOT BUILD: OK' : '\nSNAPSHOT BUILD: INCOMPLETE');
    process.exit(proof.ok ? 0 : 1);
  })
  .catch(async (e) => {
    await disconnect().catch(() => {});
    console.error('\nSNAPSHOT BUILD FAILED:', e.message);
    process.exit(1);
  });

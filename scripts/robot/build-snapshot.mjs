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
import { resolveMatterId } from './verbs/matters.mjs';

const args = process.argv.slice(2);
const SKIP_INDEX_WAIT = args.includes('--skip-index-wait');
// The live-ask proof needs a real AI provider key configured on the bench —
// it exists purely to give provenance for LATER recording a fresh fixture
// (record-ask-fixture.mjs), not to validate the archive itself. The smoke's
// own Ask replays a committed fixture deterministically and never calls a
// live provider, so a bench with no key configured can still freeze a
// perfectly valid archive; skip this proof rather than block on it.
const SKIP_LIVE_ASK = args.includes('--skip-live-ask');
const VERSION = Number((args.find((a) => a.startsWith('--version=')) || '--version=1').split('=')[1]) || 1;
const INDEX_TIMEOUT_MS = Number(process.env.BUILD_SNAPSHOT_INDEX_TIMEOUT_MS || 1_200_000);
// Floor so a STALLED/partial index can't look "stable" and get frozen. The
// Northcrest demo indexes hundreds of chunks; a healthy broad query returns the
// topK cap. Tune via env if the demo set changes.
const MIN_HITS = Number(process.env.BUILD_SNAPSHOT_MIN_HITS || 40);
const TOPK = 50;

const log = (m) => console.log(`[build-snapshot] ${m}`);

/**
 * Poll rag_retrieve until the hit count is >= MIN_HITS and stable across polls.
 * The floor guards against archiving a half-built index that briefly plateaus.
 */
async function waitForIndex(page, { timeoutMs = INDEX_TIMEOUT_MS, stableNeeded = 3, pollMs = 8000 } = {}) {
  let last = -1;
  let stable = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page
      .evaluate(async (topK) => {
        const inv = window.__TAURI__ && (window.__TAURI__.core?.invoke || window.__TAURI__.invoke);
        if (!inv) return -1;
        try {
          const hits = await inv('rag_retrieve', {
            query: 'portfolio retirement estate tax meeting statement goals trust holdings',
            topK,
            scope: { kind: 'allMatters' },
            includePrivileged: false,
          });
          return Array.isArray(hits) ? hits.length : -1;
        } catch {
          return -1;
        }
      }, TOPK)
      .catch(() => -1);
    // Only count toward "stable" once we're at/above the floor.
    if (count >= MIN_HITS && count === last) {
      stable += 1;
      log(`index poll: ${count} hits (>= floor ${MIN_HITS}; stable ${stable}/${stableNeeded})`);
      if (stable >= stableNeeded) return { ok: true, count, minHits: MIN_HITS };
    } else {
      stable = 0;
      log(`index poll: ${count} hits (need >= ${MIN_HITS} and stable; settling)`);
    }
    last = count;
    await sleep(pollMs);
  }
  return { ok: false, count: last, minHits: MIN_HITS, reason: `index-wait timeout (never reached >= ${MIN_HITS} stable)` };
}

// Retagging takes noticeably longer than the fast unassigned walk (every file
// is re-embedded), but is bounded by the same demo-set size — 10 minutes is
// generous headroom without eating deep into the overall 20-minute default.
const RETAG_TIMEOUT_MS = Number(process.env.BUILD_SNAPSHOT_RETAG_TIMEOUT_MS || 600_000);
const PDF_INDEX_TIMEOUT_MS = Number(process.env.BUILD_SNAPSHOT_PDF_TIMEOUT_MS || 600_000);

/**
 * Wait for the SEPARATE, slower PDF-indexing pass (indexWorkspacePdfs, ~301
 * files in the demo set) to finish — it runs independently of the main
 * DOCX/XLSX index+retag waitForIndex/waitForRetag already wait for. Several of
 * the demo's real citation sources are PDFs (e.g. Hollings Family's RightCapital
 * plan, the actual source for its portfolio-value answer); freezing the
 * snapshot or recording/replaying the Ask fixture before this finishes is
 * flaky — the answer text is right but the citation silently can't resolve
 * against a not-yet-indexed PDF, and the UI falls back to an uncited "general
 * guidance" answer with no error. Done = the progress banner disappears.
 */
async function waitForPdfIndexing(page, { timeoutMs = PDF_INDEX_TIMEOUT_MS, pollMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const progress = await page.locator('[data-testid="rag-pdf-progress"]').textContent().catch(() => null);
    if (!progress) return { ok: true };
    log(`pdf-index poll: ${progress.trim()}`);
    await sleep(pollMs);
  }
  return { ok: false, reason: 'pdf-index-wait timeout (rag-pdf-progress banner never cleared)' };
}

// The 3 clients isolation.mjs actually probes. Retagging runs progressively,
// one matter's folders at a time — Hollings can finish (and look "done") well
// before Webb/Voss do, so every probe matter used downstream must be checked,
// not just the first one to go green.
const RETAG_PROBE_MATTERS = ['Hollings Family', 'Webb, Marcus', 'Voss, Eleanor'];

async function scopedHitCount(page, matterId) {
  return page
    .evaluate(async (mid) => {
      const inv = window.__TAURI__ && (window.__TAURI__.core?.invoke || window.__TAURI__.invoke);
      if (!inv) return -1;
      try {
        const hits = await inv('rag_retrieve', {
          query: 'goals retirement estate trust portfolio holdings statement tax meeting',
          topK: 15,
          scope: { kind: 'matter', matterId: mid },
          includePrivileged: false,
        });
        return Array.isArray(hits) ? hits.length : -1;
      } catch {
        return -1;
      }
    }, matterId)
    .catch(() => -1);
}

/**
 * Poll MATTER-SCOPED retrieval (not the broad unscoped one waitForIndex uses)
 * for every probe matter until ALL return real hits, proving the async
 * per-file retag pass (fast-index-as-unassigned -> retagExistingMatterFolderPaths)
 * has actually finished — it runs one matter at a time, so an early matter
 * going green doesn't mean the whole pass is done. Resolves each matter's
 * CURRENT id itself since ids are fresh random UUIDs per CRM reseed (matters.mjs).
 */
async function waitForRetag(page, { names = RETAG_PROBE_MATTERS, timeoutMs = RETAG_TIMEOUT_MS, pollMs = 10_000 } = {}) {
  const ids = {};
  for (const name of names) {
    const id = await resolveMatterId(page, name);
    if (!id) return { ok: false, reason: `could not resolve a matter id for "${name}"` };
    ids[name] = id;
  }

  const deadline = Date.now() + timeoutMs;
  let last = {};
  while (Date.now() < deadline) {
    const counts = {};
    for (const name of names) counts[name] = await scopedHitCount(page, ids[name]);
    last = counts;
    const pending = names.filter((n) => counts[n] < 1);
    if (pending.length === 0) return { ok: true, counts, ids };
    log(`retag poll: ${JSON.stringify(counts)} (still pending: ${pending.join(', ')})`);
    await sleep(pollMs);
  }
  return { ok: false, counts: last, ids, reason: `retag-wait timeout — never resolved for: ${names.filter((n) => last[n] < 1).join(', ')}` };
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

  // 2b. Wait for the ASYNC RETAG pass, not just embedding completion.
  // MemoryService.indexWorkspace() does a fast full walk that tags every chunk
  // "unassigned" (see its own doc comment); a SEPARATE step
  // (retagExistingMatterFolderPaths, chained after indexWorkspace() resolves in
  // useMemoryWiring.ts's startFullIndex) then re-tags each file to its real
  // matter. That retag walk re-embeds every file again, so for ~300 demo files
  // it can take real additional minutes — well past the point the broad,
  // UNSCOPED hit-count above already looks "stable" (retagging updates rows in
  // place; it doesn't change the count). Poll a MATTER-SCOPED query until it
  // actually returns tagged hits before treating the world as ready to freeze.
  log('waiting for the per-file matter retag pass to finish…');
  proof.steps.retag = await waitForRetag(page);
  if (!proof.steps.retag.ok) throw new Error(`matter retagging never completed: ${JSON.stringify(proof.steps.retag)}`);
  log(`retag complete: ${JSON.stringify(proof.steps.retag.counts)}`);

  log('waiting for the separate PDF-indexing pass to finish…');
  proof.steps.pdfIndex = await waitForPdfIndexing(page);
  if (!proof.steps.pdfIndex.ok) throw new Error(`PDF indexing never completed: ${JSON.stringify(proof.steps.pdfIndex)}`);
  log('PDF indexing complete');

  // 3. Prove the world is good BEFORE we freeze it.
  log('proving isolation (matter-scoped, no cross-client leaks)…');
  proof.steps.isolation = await verifyIsolation(page, {});
  if (!proof.steps.isolation.ok) throw new Error(`isolation failed — refusing to freeze a leaky world: ${JSON.stringify(proof.steps.isolation)}`);

  if (SKIP_LIVE_ASK) {
    log('--skip-live-ask: skipping the live-model Ask proof (no provider key required)');
    proof.steps.ask = { ok: true, skipped: true };
  } else {
    log('proving a cited Ask works (live model — provenance for the fixture later)…');
    proof.steps.ask = await askQuestion(page, { deterministic: false });
    if (!proof.steps.ask.ok) throw new Error(`ask failed — refusing to freeze a world that can't answer: ${JSON.stringify(proof.steps.ask)}`);
  }

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

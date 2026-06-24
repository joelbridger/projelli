// scripts/robot/server.mjs — persistent control daemon for the test robot.
//
// Holds ONE live CDP connection to the Keepance desktop app on the Legion bench
// (over the SSH tunnel) and exposes high-level verbs over a tiny local HTTP API.
// Every request is serialized (the bench is a single, serial resource) and gets
// an evidence bundle written under scripts/robot/_artifacts/<ts>-<verb>/.
//
//   GET  /health        -> { ok, page }
//   POST /v/:verb        (JSON body = verb args) -> ProofPacket JSON
//
// Start:  ROBOT_PORT=7331 node scripts/robot/server.mjs
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureTunnel } from './bench.mjs';
import { getPage, reconnect } from './connection.mjs';
import { attachConsoleAndNetwork, captureBundle } from './artifacts.mjs';
import { runVerb } from './proof.mjs';
import { resetToSeed } from './verbs/reset.mjs';
import { openWorkspace } from './verbs/workspace.mjs';
import { runSurfaceSweep } from './verbs/sweep.mjs';
import { askQuestion } from './verbs/ask.mjs';
import { verifyIsolation } from './verbs/isolation.mjs';

const ROBOT_PORT = Number(process.env.ROBOT_PORT || 7331);
const VERB_TIMEOUT_MS = Number(process.env.ROBOT_VERB_TIMEOUT_MS || 180000);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_ROOT = path.join(ROOT, '_artifacts');

const VERBS = {
  reset: resetToSeed,
  open: openWorkspace,
  sweep: runSurfaceSweep,
  ask: askQuestion,
  isolation: verifyIsolation,
};

// Hard per-verb timeout so a hung page.evaluate / CDP call cannot wedge the
// serialized queue forever. The race rejects, freeing the queue; the caller then
// forces a reconnect before the next attempt.
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`verb timeout: ${label} exceeded ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// Track the current page + its console/network buffers. After a full reset the
// app restarts and connection.mjs reconnects to a NEW page; re-attach listeners
// whenever the page identity changes.
let _buffers = null;
let _lastPage = null;
async function currentPage() {
  const page = await getPage();
  if (page !== _lastPage) {
    _buffers = attachConsoleAndNetwork(page);
    _lastPage = page;
  }
  return page;
}

// Serialize all verb requests: one in-flight at a time.
let _chain = Promise.resolve();
function serialize(fn) {
  const run = _chain.then(fn, fn);
  _chain = run.catch(() => {});
  return run;
}

function tsLabel(verb) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${verb}`;
}

async function handleVerb(verb, args) {
  const fn = VERBS[verb];
  if (!fn) return { verb, ok: false, error: `unknown verb: ${verb}`, data: null, artifacts: [] };
  const label = tsLabel(verb);
  const dir = path.join(ARTIFACTS_ROOT, label);
  const packet = await runVerb(verb, async () => {
    let page = await currentPage();
    try {
      return await withTimeout(fn(page, args), VERB_TIMEOUT_MS, verb);
    } catch (e) {
      // On a closed/detached page OR a verb timeout: FORCE a fresh reconnect
      // (currentPage alone can hand back the same broken page if Playwright has
      // not yet marked it closed), then retry once.
      if (/closed|disconnected|Target page|Target closed|context was destroyed|verb timeout/i.test(String(e && e.message))) {
        await reconnect().catch(() => {});
        _lastPage = null; // force currentPage() to re-attach listeners to the fresh page
        page = await currentPage();
        return await withTimeout(fn(page, args), VERB_TIMEOUT_MS, verb);
      }
      throw e;
    }
  });
  // Best-effort evidence bundle.
  try {
    const page = await currentPage();
    packet.artifacts = await captureBundle(page, { dir, label, buffers: _buffers || undefined, extra: packet.data });
  } catch (e) {
    packet.artifactError = String(e && e.message);
  }
  return packet;
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      const page = await currentPage();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, page: page.url() }));
      return;
    }
    const m = req.url && req.url.match(/^\/v\/(\w+)/);
    if (req.method === 'POST' && m) {
      const raw = await readBody(req);
      let args = {};
      if (raw.trim()) { try { args = JSON.parse(raw); } catch { args = {}; } }
      const packet = await serialize(() => handleVerb(m[1], args));
      res.writeHead(packet.ok ? 200 : 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify(packet, null, 2));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e && e.message) }));
  }
});

await ensureTunnel();
await currentPage(); // connect + attach listeners on boot
server.listen(ROBOT_PORT, '127.0.0.1', () => {
  console.log(`[robot] daemon on http://127.0.0.1:${ROBOT_PORT} — verbs: ${Object.keys(VERBS).join(', ')}`);
});

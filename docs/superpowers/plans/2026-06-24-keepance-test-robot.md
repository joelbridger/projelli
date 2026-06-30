# Advisor Prep Hero Test Robot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate our scattered, run-by-hand Legion driving scripts into ONE persistent, deterministic "test robot" — a long-running service that holds a live connection to the real Windows app, exposes high-level verbs (reset, sweep, ask, verify-isolation), replays a fake AI for repeatable results, and returns a clean machine-readable pass/fail "proof packet" with an evidence bundle for every action.

**Architecture:** A Node service that runs **on the Linux server** and connects to the real Advisor Prep Hero desktop app on the Legion Windows bench over a **persistent SSH tunnel** to the WebView2 CDP port (server `:9444` → bench `:9223`), holding **one** Playwright `connectOverCDP` session (with auto-reconnect) instead of a fresh SSH round-trip per action. Each verb is a pure function `(page, args) -> ProofPacket`, ported from the existing `scripts/demo/legion-*.mjs` scripts. Deterministic AI is achieved with Playwright `page.route()` interception replaying recorded SSE fixtures (generalizing the existing `scripts/marketing-capture/lib/mock-ai.ts`) — this works cross-machine because interception runs in the server-side Node process, not the browser. Bench OS operations (full reset: kill/restart/delete-index, seed copy) shell out over SSH, reusing the logic already in `scripts/demo/legion-clean-reset.sh`.

**Tech Stack:** Node (ESM `.mjs`), Playwright (`connectOverCDP`), Node `http` for the control API and the SSE replay server, SSH/scp to the bench, Vitest for pure-logic unit tests.

## Global Constraints

- **`matter_id` is the security isolation key.** The isolation verb depends on the Rust `rag_retrieve` command hard-filtering by it. NEVER rename `matter` / `matter_id` / related keys. Cross-client leak in the isolation verb must be **0**.
- **Robust, not quick.** This is testing infrastructure for a core-app workflow; build it to be reliable and reused, not a throwaway. Reconnect on drop; fail loud with clear errors; never silently swallow a failed verb.
- **Reuse, don't reinvent.** Every verb is ported from an existing, working `scripts/demo/legion-*.mjs` script. The source script for each is named in its task. Preserve its proven selectors and logic; the work is consolidation + a stable interface + a proof packet, not new behavior.
- **The connection must never kill the app.** `connectOverCDP().close()` only detaches (see `scripts/desktop-drive.mjs:108`). Disconnect on shutdown must detach, never close the app's pages.
- **No new dependencies.** Playwright is already a dependency; use Node built-ins (`http`, `child_process`, `fs`) for everything else.
- **Internal tooling — no user-facing copy.** The light-theme / no-em-dash public-copy rules do not apply to this code. Keep comments and logs plain and clear.
- **Bench is a single serial resource.** The Legion runs ONE app session. The robot serializes verbs; never assume two verbs can drive the app at once.
- **Evidence before "done".** A verb is "passing" only when its live proof packet shows `ok: true` with the command shown and its output.

## Environment facts (verified 2026-06-24)

- Bench reachable: `ssh james@100.127.67.22` → `BENCH_OK`; CDP `:9223` and preview `:5173` both listening.
- The app runs in **preview mode** (built bundle + compiled debug binary); AI calls go to the provider directly (`api.openai.com` / `api.anthropic.com`), so `page.route()` on those hosts can replay fixtures.
- Demo workspace on bench: `C:/keepance-demo-northcrest/Northcrest Wealth Partners` (its `.keepance` folder is the on-disk vector index).
- App page is the one at `localhost:5173` (not `connector`/`account-window`).
- OpenAI key lives in the OS keychain and survives a localStorage wipe.

## File structure (all new, under `scripts/robot/`)

| File | Responsibility |
|---|---|
| `scripts/robot/connection.mjs` | Persistent CDP connection: `getPage()`, `reconnect()`, `disconnect()`. Holds one Playwright session; reconnects if the app restarts. Ported boilerplate from `desktop-drive.mjs` / `legion-*.mjs`. |
| `scripts/robot/proof.mjs` | `ProofPacket` shape + `runVerb(name, fn)` wrapper that times the verb, catches errors, and returns `{verb, ok, data, error, startedAt, durationMs, artifacts}`. Pure. |
| `scripts/robot/artifacts.mjs` | `attachConsoleAndNetwork(page)` listeners + `captureBundle(page, {dir, label})` → screenshot + DOM text + console log + network log (+ cited sources passed in). |
| `scripts/robot/fixtures/aiReplay.mjs` | `installAIReplay(page, replayName)` + `closeReplayServers()`. Generalized from `scripts/marketing-capture/lib/mock-ai.ts`; reads fixtures from `scripts/robot/fixtures/ai-replays/`. |
| `scripts/robot/bench.mjs` | SSH/scp helpers: `sshExec(cmd)`, `scpTo(local, remote)`, `ensureTunnel()`, `restartApp()`, `deleteIndex()` — wrap the bench OS ops from `legion-clean-reset.sh`. |
| `scripts/robot/verbs/reset.mjs` | `resetToSeed(page, {mode})`. `mode:'fast'` = purge residue + reseed + reload (no kill, no reindex). `mode:'full'` = SSH kill + delete `.keepance` + restart + reconnect + reseed. Ports `legion-purge-residue.mjs` + `legion-seed.mjs` + `legion-clean-reset.sh`. |
| `scripts/robot/verbs/sweep.mjs` | `runSurfaceSweep(page, {surfaces, dir})` → per-surface `{ok, textHead, shot}`. Ports `legion-sweep.mjs`. |
| `scripts/robot/verbs/ask.mjs` | `askQuestion(page, {question, deterministic})` → `{settled, citationChips, attestations, uncitedWarnings, lastAnswer}`. Ports `legion-askcheck.mjs`; when `deterministic`, installs AI replay first. |
| `scripts/robot/verbs/isolation.mjs` | `verifyIsolation(page, {cases})` → per-case `{count, leak, sample}` via `window.__TAURI__.invoke('rag_retrieve', …)`. Ports `legion-verify.mjs`. Leak must be 0. |
| `scripts/robot/server.mjs` | HTTP control daemon: `GET /health`, `POST /v/:verb` (JSON body = args) → ProofPacket JSON. Holds the persistent page; serializes requests. |
| `scripts/robot/cli.mjs` | Thin client: `node scripts/robot/cli.mjs <verb> [json-args]` → calls the daemon (or runs the verb directly if `--no-daemon`), pretty-prints the packet, exits non-zero if `ok:false`. |
| `scripts/robot/README.md` | How to start the tunnel + daemon and call verbs; the proof-packet shape; how to record an AI replay fixture. |
| `scripts/robot/__tests__/*.test.mjs` | Vitest unit tests for the pure pieces (proof wrapper, replay fixture, page-pick logic, residue-key completeness). |

> **Unit-tested vs bench-verified:** `proof.mjs`, `artifacts.mjs`, `fixtures/aiReplay.mjs`, the page-pick helper, and the residue-key list are pure/local and get Vitest tests. The four **verbs** drive the live app; their acceptance is a green live proof packet against the bench (commands given per task). This split is deliberate and honest — do not fabricate unit tests that pretend to drive the real app.

> **Vitest include note:** confirm `vitest.config.ts` `include` globs pick up `scripts/robot/__tests__/**`. If it restricts to `src/`/`tests/`, add `scripts/robot/**/__tests__/**/*.test.mjs` to `include` in the same task that adds the first test.

---

### Task 1: Persistent connection module + page-pick unit test

**Files:**
- Create: `scripts/robot/connection.mjs`
- Create: `scripts/robot/__tests__/connection.test.mjs`
- Modify (if needed): `vitest.config.ts` (add `scripts/robot/**/__tests__/**` to `include`)

**Interfaces:**
- Produces:
  - `export function pickPage(pages: {url:string}[]): {url:string} | null` — pure selector (extracted so it's testable).
  - `export async function getPage(opts?: {port?: string}): Promise<import('playwright').Page>` — connect over CDP (default port from `DESKTOP_CDP_PORT` || `9444`), return the app page; memoizes the browser+page; reconnects if the cached page is closed.
  - `export async function reconnect(opts?): Promise<import('playwright').Page>` — force a fresh connection (used after a full reset restarts the app).
  - `export async function disconnect(): Promise<void>` — detach only (never close pages).

- [ ] **Step 1: Write the failing test** for the pure page-pick logic (mirrors `desktop-drive.mjs:36-47`).

```js
// scripts/robot/__tests__/connection.test.mjs
import { describe, it, expect } from 'vitest';
import { pickPage } from '../connection.mjs';

describe('pickPage', () => {
  it('prefers the localhost:5173 app page over connector/account windows', () => {
    const pages = [
      { url: 'http://localhost:5173/connector' },
      { url: 'devtools://devtools/bundled/x.html' },
      { url: 'http://localhost:5173/' },
    ];
    expect(pickPage(pages)?.url).toBe('http://localhost:5173/');
  });
  it('falls back to the first non-devtools page when no 5173 page exists', () => {
    const pages = [
      { url: 'devtools://devtools/x' },
      { url: 'tauri://localhost/index.html' },
    ];
    expect(pickPage(pages)?.url).toBe('tauri://localhost/index.html');
  });
  it('returns null for an empty list', () => {
    expect(pickPage([])).toBe(null);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run scripts/robot/__tests__/connection.test.mjs`
Expected: FAIL (`pickPage` not found / module missing). If Vitest reports "no test files found", fix the `include` glob in `vitest.config.ts`, then re-run and expect the assertion-level failure.

- [ ] **Step 3: Implement `connection.mjs`** — extract `pickPage` as a pure function and build the memoized connect/reconnect/disconnect around it.

```js
// scripts/robot/connection.mjs
import { chromium } from 'playwright';

const DEFAULT_PORT = process.env.DESKTOP_CDP_PORT || '9444';

export function pickPage(pages) {
  return (
    pages.find((p) => /localhost:5173/.test(p.url) && !/connector|account-window/i.test(p.url)) ||
    pages.find((p) => /localhost:5173|index\.html|tauri/i.test(p.url)) ||
    pages.find((p) => !/devtools/i.test(p.url)) ||
    pages[0] ||
    null
  );
}

let _browser = null;
let _page = null;

async function connect(port) {
  const base = `http://localhost:${port}`;
  const info = await (await fetch(`${base}/json/version`)).json();
  const ws = info.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//, `ws://localhost:${port}/`);
  const browser = await chromium.connectOverCDP(ws);
  const pages = browser.contexts().flatMap((c) => c.pages());
  const picked = pickPage(pages.map((p) => ({ url: p.url(), _p: p })));
  const page = picked ? picked._p : null;
  if (!page) { await browser.close().catch(() => {}); throw new Error('No Advisor Prep Hero webview page found'); }
  return { browser, page };
}

export async function getPage(opts = {}) {
  const port = opts.port || DEFAULT_PORT;
  if (_page && !_page.isClosed()) return _page;
  ({ browser: _browser, page: _page } = await connect(port));
  return _page;
}

export async function reconnect(opts = {}) {
  await disconnect();
  return getPage(opts);
}

export async function disconnect() {
  if (_browser) { await _browser.close().catch(() => {}); } // close() only DETACHES over CDP
  _browser = null; _page = null;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run scripts/robot/__tests__/connection.test.mjs`
Expected: PASS (3 passed).

- [ ] **Step 5: Live sanity check against the bench** (tunnel must be up; see Task 8 for the tunnel command, or start it ad hoc).

Run:
```bash
ssh -fN -L 9444:localhost:9223 james@100.127.67.22 || true
node -e "import('./scripts/robot/connection.mjs').then(async m=>{const p=await m.getPage();console.log('PAGE',p.url());await m.disconnect();})"
```
Expected: prints `PAGE http://localhost:5173/...`. Confirms the persistent connection works through the tunnel and does not close the app.

- [ ] **Step 6: Commit**

```bash
git add scripts/robot/connection.mjs scripts/robot/__tests__/connection.test.mjs vitest.config.ts
git commit -m "feat(robot): persistent CDP connection module + page-pick test"
```

---

### Task 2: Proof-packet wrapper

**Files:**
- Create: `scripts/robot/proof.mjs`
- Create: `scripts/robot/__tests__/proof.test.mjs`

**Interfaces:**
- Produces:
  - `export async function runVerb(name: string, fn: () => Promise<any>): Promise<ProofPacket>` where `ProofPacket = { verb: string, ok: boolean, data: any, error: string|null, startedAt: string, durationMs: number, artifacts: string[] }`. `ok` is `false` iff `fn` throws OR returns `{ ok: false }`. `data` is the verb's return value; `artifacts` is `data.artifacts ?? []`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/robot/__tests__/proof.test.mjs
import { describe, it, expect } from 'vitest';
import { runVerb } from '../proof.mjs';

describe('runVerb', () => {
  it('wraps a success into ok:true with data and a duration', async () => {
    const p = await runVerb('demo', async () => ({ value: 42 }));
    expect(p.verb).toBe('demo');
    expect(p.ok).toBe(true);
    expect(p.data).toEqual({ value: 42 });
    expect(p.error).toBe(null);
    expect(typeof p.durationMs).toBe('number');
  });
  it('marks ok:false and captures the message when the verb throws', async () => {
    const p = await runVerb('boom', async () => { throw new Error('nope'); });
    expect(p.ok).toBe(false);
    expect(p.error).toContain('nope');
  });
  it('honors an explicit ok:false in the returned data', async () => {
    const p = await runVerb('soft', async () => ({ ok: false, leak: 3 }));
    expect(p.ok).toBe(false);
    expect(p.data.leak).toBe(3);
  });
});
```

- [ ] **Step 2: Run to confirm it fails** — `npx vitest run scripts/robot/__tests__/proof.test.mjs` → FAIL (module missing).

- [ ] **Step 3: Implement `proof.mjs`**

```js
// scripts/robot/proof.mjs
export async function runVerb(name, fn) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const data = await fn();
    const ok = !(data && typeof data === 'object' && data.ok === false);
    return { verb: name, ok, data, error: null, startedAt, durationMs: Date.now() - t0, artifacts: (data && data.artifacts) || [] };
  } catch (e) {
    return { verb: name, ok: false, data: null, error: String((e && e.message) || e), startedAt, durationMs: Date.now() - t0, artifacts: [] };
  }
}
```

- [ ] **Step 4: Run to confirm pass** — `npx vitest run scripts/robot/__tests__/proof.test.mjs` → PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add scripts/robot/proof.mjs scripts/robot/__tests__/proof.test.mjs
git commit -m "feat(robot): proof-packet wrapper (runVerb) + tests"
```

---

### Task 3: Generalized deterministic AI replay fixture

**Files:**
- Create: `scripts/robot/fixtures/aiReplay.mjs`
- Create: `scripts/robot/fixtures/ai-replays/.gitkeep`
- Create: `scripts/robot/__tests__/aiReplay.test.mjs`

**Interfaces:**
- Consumes: the proven `page.route()` → local SSE proxy pattern from `scripts/marketing-capture/lib/mock-ai.ts` (read it; reuse its structure verbatim where possible).
- Produces:
  - `export async function installAIReplay(page, replayName: string): Promise<number>` — intercepts the provider proxy + absolute provider hosts and replays the named fixture as a paced SSE stream; returns the proxy port.
  - `export function closeAllReplayServers(): void`.
  - Fixture format: `{ model: string, chunks: { delayMs: number, text: string }[] }` in `scripts/robot/fixtures/ai-replays/<name>.json`.

- [ ] **Step 1: Write the failing test** (drives a tiny local `http.Server` as a fake "browser-side" caller — no Playwright needed; verifies the SSE proxy emits the fixture chunks in order). Place a fixture at `scripts/robot/fixtures/ai-replays/hello.json` as part of this step.

```js
// scripts/robot/__tests__/aiReplay.test.mjs
import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _startSseProxyForTest, closeAllReplayServers } from '../fixtures/aiReplay.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/ai-replays');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'hello.json'), JSON.stringify({ model: 'test', chunks: [
  { delayMs: 0, text: 'Hello ' }, { delayMs: 5, text: 'world' },
] }));

afterAll(() => closeAllReplayServers());

describe('aiReplay SSE proxy', () => {
  it('streams the fixture chunks then message_stop', async () => {
    const port = await _startSseProxyForTest('hello');
    const res = await fetch(`http://127.0.0.1:${port}/stream`, { method: 'POST', body: '{}' });
    const body = await res.text();
    expect(body).toContain('Hello ');
    expect(body).toContain('world');
    expect(body).toContain('message_stop');
  });
});
```

- [ ] **Step 2: Run to confirm it fails** — `npx vitest run scripts/robot/__tests__/aiReplay.test.mjs` → FAIL (module missing).

- [ ] **Step 3: Implement `aiReplay.mjs`** by porting `scripts/marketing-capture/lib/mock-ai.ts` to ESM `.mjs`: keep `startSseProxy` (export a test alias `_startSseProxyForTest(name)` that loads the fixture and starts the proxy), the `installAIReplay(page, name)` route handler (intercepting `**/api/anthropic/**`, `**/api/openai/**`, `**/api/google/**`, `**/api.anthropic.com/**`, `**/api.openai.com/**`, `**/generativelanguage.googleapis.com/**`), and `closeAllReplayServers()`. Point `FIXTURES_DIR` at `scripts/robot/fixtures/ai-replays/`.

- [ ] **Step 4: Run to confirm pass** — `npx vitest run scripts/robot/__tests__/aiReplay.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/robot/fixtures scripts/robot/__tests__/aiReplay.test.mjs
git commit -m "feat(robot): generalized deterministic AI replay fixture (from mock-ai) + test"
```

---

### Task 4: Artifact bundle capture

**Files:**
- Create: `scripts/robot/artifacts.mjs`

**Interfaces:**
- Produces:
  - `export function attachConsoleAndNetwork(page): { console: string[], requests: string[] }` — registers `page.on('console')` and `page.on('requestfinished')` listeners, returns the live buffers (call once per connection).
  - `export async function captureBundle(page, { dir, label, buffers, extra }): Promise<string[]>` — writes `<label>.jpeg` (screenshot), `<label>.dom.txt` (`main` innerText), `<label>.console.log`, `<label>.network.log`, and `<label>.extra.json` (e.g. cited sources). Returns the list of written file paths. Creates `dir` if absent.

- [ ] **Step 1: Implement `artifacts.mjs`** (no unit test — pure I/O glue; validated live in Task 9).

```js
// scripts/robot/artifacts.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function attachConsoleAndNetwork(page) {
  const buffers = { console: [], requests: [] };
  page.on('console', (m) => buffers.console.push(`[${m.type()}] ${m.text()}`.slice(0, 500)));
  page.on('requestfinished', (r) => buffers.requests.push(`${r.method()} ${r.url()}`.slice(0, 300)));
  return buffers;
}

export async function captureBundle(page, { dir, label, buffers = { console: [], requests: [] }, extra = null }) {
  mkdirSync(dir, { recursive: true });
  const written = [];
  const shot = path.join(dir, `${label}.jpeg`);
  await page.screenshot({ path: shot, type: 'jpeg', quality: 80 }).then(() => written.push(shot)).catch(() => {});
  const dom = await page.evaluate(() => document.querySelector('main')?.innerText || document.body.innerText).catch(() => '');
  const domPath = path.join(dir, `${label}.dom.txt`); writeFileSync(domPath, dom.slice(0, 20000)); written.push(domPath);
  const cPath = path.join(dir, `${label}.console.log`); writeFileSync(cPath, buffers.console.slice(-200).join('\n')); written.push(cPath);
  const nPath = path.join(dir, `${label}.network.log`); writeFileSync(nPath, buffers.requests.slice(-200).join('\n')); written.push(nPath);
  if (extra) { const ePath = path.join(dir, `${label}.extra.json`); writeFileSync(ePath, JSON.stringify(extra, null, 2)); written.push(ePath); }
  return written;
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/robot/artifacts.mjs
git commit -m "feat(robot): evidence-bundle capture (screenshot/DOM/console/network/extra)"
```

---

### Task 5: Bench OS helpers

**Files:**
- Create: `scripts/robot/bench.mjs`

**Interfaces:**
- Produces (all use `child_process` + the constants below):
  - `export const LEGION = 'james@100.127.67.22';`
  - `export const WS_KEEPANCE_INDEX = 'C\\:\\\\keepance-demo-northcrest\\\\Northcrest Wealth Partners\\\\.keepance';` (the on-disk index path; escape for PowerShell as in `legion-clean-reset.sh:12`).
  - `export function sshExec(psCommand: string): string` — run a PowerShell command on the bench, return stdout (throws on non-zero).
  - `export function scpTo(localPath: string, remotePath: string): void`.
  - `export async function ensureTunnel(localPort=9444, benchPort=9223): Promise<void>` — start `ssh -fN -L` if `localPort` isn't already connectable; idempotent.
  - `export function killApp(): void` / `export function deleteIndex(): void` / `export function restartApp(): void` / `export async function waitForPorts(timeoutMs=90000): Promise<boolean>` — port-poll loop mirroring `legion-clean-reset.sh:28-34`.

- [ ] **Step 1: Implement `bench.mjs`** by lifting the exact SSH/scp/port-poll commands from `scripts/demo/legion-clean-reset.sh` into Node helpers. Use `execFileSync('ssh', ['-o','ConnectTimeout=10', LEGION, psCommand])`.

- [ ] **Step 2: Live sanity check**

Run: `node -e "import('./scripts/robot/bench.mjs').then(async m=>{console.log(m.sshExec('echo BENCH_OK')); await m.ensureTunnel(); console.log('tunnel ok');})"`
Expected: prints `BENCH_OK` and `tunnel ok`.

- [ ] **Step 3: Commit**

```bash
git add scripts/robot/bench.mjs
git commit -m "feat(robot): bench SSH/scp/tunnel/restart helpers (from legion-clean-reset)"
```

---

### Task 6: Verb — reset_to_seed (fast + full)

**Files:**
- Create: `scripts/robot/verbs/reset.mjs`
- Create: `scripts/robot/__tests__/reset.test.mjs` (unit test for the residue-key list ONLY)

**Interfaces:**
- Consumes: `getPage`/`reconnect` (Task 1), `bench.mjs` (Task 5).
- Produces:
  - `export const RESIDUE_KEYS` — the exact-kill set + prefix patterns from `legion-purge-residue.mjs:16-19` (`keepance:client-maps`, `ai-chat-storage`, `keepance:matter-ui-snapshots`, `keepance:client-map-templates`, `workspace_versions`, and `^workspace_(tabs|expanded)_`).
  - `export const SEED_MATTERS_PATH` (bench path `C:/northcrest_matters.json`) and the seed writer.
  - `export async function resetToSeed(page, { mode = 'fast' } = {}): Promise<{ ok, mode, removed, remaining, seeded }>`. `fast` = purge residue + apply seed in-page + `location.reload()` (no kill; from `legion-purge-residue.mjs` + `legion-seed.mjs`). `full` = `scpTo` matters → kill → `deleteIndex()` → `restartApp()` → `waitForPorts()` → `reconnect()` → apply seed (from `legion-clean-reset.sh`). Returns a packet-friendly object; `ok:false` if seed verification (advisor profession + 26 matters) fails.

- [ ] **Step 1: Write the failing test** for the residue-key completeness (guards against silent drift — the bug that caused the "128 fake duplicate facts" incident).

```js
// scripts/robot/__tests__/reset.test.mjs
import { describe, it, expect } from 'vitest';
import { RESIDUE_KEYS } from '../verbs/reset.mjs';

describe('RESIDUE_KEYS', () => {
  it('includes every known residue store that skewed past runs', () => {
    for (const k of ['keepance:client-maps','ai-chat-storage','keepance:matter-ui-snapshots','keepance:client-map-templates','workspace_versions']) {
      expect(RESIDUE_KEYS.exact).toContain(k);
    }
    expect(RESIDUE_KEYS.prefixes.some((re) => re.test('workspace_tabs_abc'))).toBe(true);
    expect(RESIDUE_KEYS.prefixes.some((re) => re.test('workspace_expanded_xyz'))).toBe(true);
  });
  it('never strips legit config keys', () => {
    for (const keep of ['apiKey_openai','keepance:matters','keepance:settings','keepance_profession']) {
      expect(RESIDUE_KEYS.exact).not.toContain(keep);
    }
  });
});
```

- [ ] **Step 2: Run to confirm it fails** — `npx vitest run scripts/robot/__tests__/reset.test.mjs` → FAIL (module missing).

- [ ] **Step 3: Implement `reset.mjs`** — port `legion-purge-residue.mjs` (the in-page purge + reload) and `legion-seed.mjs` (the in-page seed: profession, settings, 26 matters, recents — exact shapes from `legion-seed.mjs:48-74`) into `resetToSeed`. The `full` branch orchestrates `bench.mjs`. Read the 26 matters for `full` from the repo's `scripts/demo/northcrest_matters.json` (scp it up).

- [ ] **Step 4: Run to confirm the unit test passes** — `npx vitest run scripts/robot/__tests__/reset.test.mjs` → PASS.

- [ ] **Step 5: Live verify — fast reset**

Run: `node scripts/robot/cli.mjs reset '{"mode":"fast"}' --no-daemon` (after Task 9; until then call `resetToSeed` via a one-liner `node -e`).
Expected packet `ok:true`, with `seeded` showing `profession:'advisor'`, `mattersCount:26`, and the residue keys gone after reload.

- [ ] **Step 6: Commit**

```bash
git add scripts/robot/verbs/reset.mjs scripts/robot/__tests__/reset.test.mjs
git commit -m "feat(robot): reset_to_seed verb (fast purge+reseed / full kill+reindex+reseed)"
```

---

### Task 7: Verbs — surface sweep, ask (deterministic), verify isolation

**Files:**
- Create: `scripts/robot/verbs/sweep.mjs`
- Create: `scripts/robot/verbs/ask.mjs`
- Create: `scripts/robot/verbs/isolation.mjs`

**Interfaces:**
- Consumes: `getPage` (Task 1), `installAIReplay` (Task 3), `captureBundle`/`attachConsoleAndNetwork` (Task 4).
- Produces:
  - `export async function runSurfaceSweep(page, { surfaces?, dir }): Promise<{ ok, surfaces: Record<string,{ok,textHead?,err?,shot?}> }>` — default surfaces from `legion-sweep.mjs:11-18` (settings, privacy, audit, workflows, email, files). `ok` = every surface `ok:true`.
  - `export async function askQuestion(page, { question, deterministic = true, replay = 'ask-portfolio' }): Promise<{ ok, settled, citationChips, attestations, uncitedWarnings, lastAnswer }>` — selectors + settle loop from `legion-askcheck.mjs`. When `deterministic`, call `installAIReplay(page, replay)` first. `ok` = `settled && (attestations > uncitedWarnings)`.
  - `export async function verifyIsolation(page, { cases? }): Promise<{ ok, results }>` — calls `window.__TAURI__.invoke('rag_retrieve', {query, topK, scope, includePrivileged:false})` per `legion-verify.mjs`; default cases include the Hollings-scoped-to-Webb leak check. `ok` = every leak-check case has `leak === 0`.

- [ ] **Step 1: Implement the three verb files**, porting each from its named source script. Keep the proven `data-testid` selectors verbatim (`ask-composer-input`, `hub-ask-input`, `ask-cited-attestation`, `ask-uncited-warning`, `ask-citation-chip-*`).

- [ ] **Step 2: Live verify — sweep**

Run: `node scripts/robot/cli.mjs sweep --no-daemon` (or `node -e` until Task 9).
Expected: packet `ok:true`, every surface `ok:true`, screenshots written.

- [ ] **Step 3: Live verify — ask (deterministic)** — record one fixture first by asking live once and capturing the SSE (document the capture in the README in Task 9), save as `scripts/robot/fixtures/ai-replays/ask-portfolio.json`.

Run: `node scripts/robot/cli.mjs ask '{"question":"What is the total portfolio value for this household?","deterministic":true}' --no-daemon`
Expected: packet `ok:true`, `settled:true`, `attestations >= 1`, identical `lastAnswer` across two consecutive runs (proves determinism).

- [ ] **Step 4: Live verify — isolation**

Run: `node scripts/robot/cli.mjs isolation --no-daemon`
Expected: packet `ok:true`, every leak-check case `leak:0`. (If non-zero, that is a REAL product isolation bug — stop and report, do not weaken the test.)

- [ ] **Step 5: Commit**

```bash
git add scripts/robot/verbs/sweep.mjs scripts/robot/verbs/ask.mjs scripts/robot/verbs/isolation.mjs scripts/robot/fixtures/ai-replays/ask-portfolio.json
git commit -m "feat(robot): sweep / ask(deterministic) / verify-isolation verbs"
```

---

### Task 8: Control daemon + CLI client

**Files:**
- Create: `scripts/robot/server.mjs`
- Create: `scripts/robot/cli.mjs`

**Interfaces:**
- Consumes: all verbs, `runVerb` (Task 2), `getPage`/`reconnect` (Task 1), `attachConsoleAndNetwork`/`captureBundle` (Task 4), `ensureTunnel` (Task 5).
- Produces:
  - `server.mjs`: on boot, `ensureTunnel()` → `getPage()` → `attachConsoleAndNetwork(page)`. `GET /health` → `{ ok:true, page:url }`. `POST /v/:verb` with JSON args → look up the verb, run it inside `runVerb`, attach an evidence bundle under `scripts/robot/_artifacts/<ts>-<verb>/`, return the ProofPacket JSON. A single in-process queue serializes requests. Reconnect-and-retry once on a closed-page error. Listens on `ROBOT_PORT` (default `7331`).
  - `cli.mjs`: `node scripts/robot/cli.mjs <verb> [json] [--no-daemon] [--port N]` → POST to the daemon (default), or with `--no-daemon` import+run the verb directly; pretty-print the packet; `process.exit(packet.ok ? 0 : 1)`.

- [ ] **Step 1: Implement `server.mjs` and `cli.mjs`.** Verb registry maps `reset|sweep|ask|isolation` to their functions.

- [ ] **Step 2: Live verify the daemon path**

Run:
```bash
ROBOT_PORT=7331 node scripts/robot/server.mjs & sleep 3
curl -s localhost:7331/health
node scripts/robot/cli.mjs sweep
kill %1
```
Expected: `/health` returns the app URL; `sweep` returns `ok:true` via the daemon with an artifacts folder path in the packet.

- [ ] **Step 3: Commit**

```bash
git add scripts/robot/server.mjs scripts/robot/cli.mjs
git commit -m "feat(robot): persistent control daemon + CLI client (serialized verbs, proof packets, evidence bundles)"
```

---

### Task 9: End-to-end live smoke + README

**Files:**
- Create: `scripts/robot/smoke.mjs`
- Create: `scripts/robot/README.md`
- Modify: `package.json` (add `"robot:smoke": "node scripts/robot/smoke.mjs"`)

**Interfaces:**
- Consumes: the daemon + all verbs.
- Produces: `smoke.mjs` runs the full chain against the live bench and prints one combined pass/fail summary: `reset(full)` → `sweep` → `ask(deterministic)` → `isolation`, asserting every packet `ok:true`, and writes a combined evidence folder. Exits non-zero on any failure.

- [ ] **Step 1: Implement `smoke.mjs`** (sequential; reuses the daemon if running, else `--no-daemon`).

- [ ] **Step 2: Write `README.md`** — the tunnel command, `npm run robot:smoke`, the proof-packet shape, the verb list, the artifacts location, and **how to record a new AI replay fixture** (ask live once with network logging on, save the SSE chunks to `fixtures/ai-replays/<name>.json`).

- [ ] **Step 3: Live verify the whole loop**

Run: `npm run robot:smoke`
Expected: a clean summary with all four verbs `ok:true`, total wall-clock printed, and an `_artifacts/<ts>/` folder containing the evidence bundle. **This green run is the definition of done for the MVP.**

- [ ] **Step 4: Commit**

```bash
git add scripts/robot/smoke.mjs scripts/robot/README.md package.json
git commit -m "feat(robot): end-to-end live smoke (reset->sweep->ask->isolation) + README"
```

---

## Self-review (completed)

- **Spec coverage:** persistent connection (T1), proof packets (T2), deterministic AI (T3), evidence bundles (T4), bench ops (T5), robust reset (T6), the core verbs (T7), the persistent daemon + clean pass/fail (T8), end-to-end proof (T9). All map to the report's "test robot" centerpiece.
- **Interfaces:** `getPage/reconnect/disconnect`, `runVerb`, `installAIReplay/closeAllReplayServers`, `captureBundle/attachConsoleAndNetwork`, `resetToSeed`, `runSurfaceSweep/askQuestion/verifyIsolation`, server `POST /v/:verb`, CLI — names are consistent across tasks.
- **Honesty:** pure pieces are unit-tested; the four live verbs are bench-verified with explicit commands. No fabricated unit tests pretend to drive the real app.
- **Reuse:** every verb cites its source `legion-*.mjs`; nothing is invented.

## Follow-on plans (NOT in this doc — separate plans after the robot lands)

1. **Push it down to the gate:** move the generalized AI replay (Task 3) into shared test support and wire the existing ~254-test Playwright browser suite into CI as a PR gate (with replay = stable + fast), so UI regressions are caught before the bench. *(Report §6-C.)*
2. **"Catch it once" protocol:** a lightweight rule + helper so every bench bug becomes a permanent automatic test the same day. *(Report §6-A.)*
3. **Pre-built world snapshot:** ship a ready-built workspace + `.keepance` index so `reset(full)` clones a known-good world instead of re-indexing 374 files. *(Report §6-D.)*
4. **Unattended cloud Windows smoke:** run the robot's smoke on a rented cloud Windows runner (interactive session) on every meaningful change, synthetic data only. *(Report §6-E.)*

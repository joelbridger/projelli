#!/usr/bin/env bun
/**
 * Runs the parity manifest against a real Tauri process. It deliberately does
 * not use React test doubles or browser storage: every write goes through the
 * desktop bridge, and every passing assertion must restart the native app.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  FEATURES,
  SKIPPED_FEATURES,
  type ParityApp,
  type ParityFeature,
} from './manifest';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
function stableWorktreePort(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return 15_000 + ((hash >>> 0) % 10_000);
}
// A parity run owns both ports. Fixed defaults let two simultaneous runs talk
// to the wrong app, which turns a setup problem into a fake score.
const port = process.env['PARITY_BRIDGE_PORT']
  ? Number(process.env['PARITY_BRIDGE_PORT'])
  : await freePort();
// Each worktree gets a stable private Vite port. The exact same value is baked
// into the debug binary and its build receipt below, so the renderer can never
// silently connect to a sibling worktree's server.
const vitePort = process.env['PARITY_VITE_PORT']
  ? Number(process.env['PARITY_VITE_PORT'])
  : stableWorktreePort(root);
const workspaceRoot =
  process.env['PARITY_WORKSPACE'] ?? `/tmp/lantern-parity-${process.pid}`;
const preflight =
  process.argv.includes('--preflight') ||
  process.env['npm_config_preflight'] === 'true';
const featureFilter = process.env['PARITY_FEATURE'];
const reportPath = featureFilter
  ? `/tmp/lantern-parity-${featureFilter}-report.json`
  : resolve(root, 'tests/parity/parity-report.json');
const base = `http://127.0.0.1:${port}`;
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
let migrationBaseUrl: string | undefined;

const modelCache =
  process.env['PARITY_MODEL_CACHE'] ??
  resolve(homedir(), '.local/share/lantern/models/e5-small');
const cargoTarget =
  process.env['PARITY_CARGO_TARGET_DIR'] ??
  '/mnt/devcache/cargo-target-crm-hermetic2';
const binaryPath = resolve(cargoTarget, 'debug/lantern');
const buildReceiptPath = resolve(
  cargoTarget,
  'debug/.lantern-parity-build.json'
);
const viteLeaseDir = `/tmp/lantern-parity-vite-${vitePort}.lock`;
const xvfbDisplay = `:${30_000 + (process.pid % 20_000)}`;

function shareMachineModelCache(): void {
  // A fresh parity data folder should isolate records and settings, not
  // re-download the same 465 MB read-only search model for every feature run.
  // Real Windows already has this machine-level model. Point the Linux run at
  // its known-good machine cache while keeping all writable app data private.
  const source = modelCache;
  if (!existsSync(source)) return;
  const target = resolve(workspaceRoot, '.data/lantern/models/e5-small');
  if (existsSync(target)) return;
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(source, target, 'dir');
}

function directoryBytes(path: string): number {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) total += directoryBytes(child);
    else if (entry.isFile()) total += statSync(child).size;
  }
  return total;
}

function verifyModelCache(): void {
  if (!existsSync(modelCache)) {
    throw new InfrastructureError(
      `Machine model cache is missing at ${modelCache}; parity will not download the 465 MB model.`
    );
  }
  const bytes = directoryBytes(modelCache);
  if (bytes < 400_000_000) {
    throw new InfrastructureError(
      `Machine model cache at ${modelCache} is incomplete (${bytes} bytes; expected the cached 465 MB model).`
    );
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Could not reserve a simulator port'));
      });
    });
  });
}
// The desktop bridge accepts a timeout per request. Use the same generous
// ceiling as the launch harness so a cold encrypted store is not confused
// with a failing feature.
const bridgeTimeoutMs = process.env['LANTERN_DEV_BRIDGE_TIMEOUT_MS'] ?? '60000';

type Result = {
  id: string;
  name: string;
  area: string;
  verdict: string;
  status: 'BUILT' | 'FAILING' | 'PENDING';
  detail: string;
};

function fail(message: string): never {
  throw new Error(message);
}

class InfrastructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InfrastructureError';
  }
}

async function http(
  path: string,
  query: Record<string, string> = {}
): Promise<unknown> {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, value);
  if (path !== '/health' && !url.searchParams.has('timeout_ms'))
    url.searchParams.set('timeout_ms', bridgeTimeoutMs);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new InfrastructureError(
      `Cannot reach the desktop bridge at ${base}${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  let body: { ok?: boolean; result?: unknown; error?: string };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new InfrastructureError(
      `Desktop bridge returned an invalid response for ${path}`
    );
  }
  if (!response.ok || !body.ok) {
    if (
      path === '/health' ||
      /timed out|renderer.*unavailable|bridge.*closed/i.test(body.error ?? '')
    ) {
      throw new InfrastructureError(body.error ?? `${path} failed`);
    }
    fail(body.error ?? `${path} failed`);
  }
  return body.result;
}

async function waitForBridge(seconds = 30): Promise<void> {
  const end = Date.now() + seconds * 1_000;
  let last = 'not started';
  while (Date.now() < end) {
    try {
      await http('/health');
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(150);
  }
  throw new InfrastructureError(`Desktop bridge did not start: ${last}`);
}

async function portReady(target: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${target}`)).ok;
  } catch {
    return false;
  }
}

function start(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): ChildProcess {
  return spawn(command, args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Each helper owns a process group, so cleanup also reaches Vite's child
    // process instead of leaving :5174 occupied for the next parity run.
    detached: true,
  });
}

function stop(child: ChildProcess | undefined): void {
  if (!child?.pid || child.killed) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.stack || error.name;
  const rendered = String(error);
  return rendered || '(empty error value)';
}

function currentHead(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    throw new InfrastructureError(
      `Cannot read the current Git commit: ${errorText(error)}`
    );
  }
}

async function waitForExit(
  child: ChildProcess,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (child.exitCode === null && child.signalCode === null) {
    if (Date.now() >= deadline) {
      stop(child);
      throw new InfrastructureError(
        `Process ${String(child.pid)} did not stop within ${timeoutMs} ms.`
      );
    }
    await delay(100);
  }
}

async function runBuild(head: string): Promise<void> {
  mkdirSync(cargoTarget, { recursive: true });
  let output = '';
  const child = spawn(
    'cargo',
    ['build', '--manifest-path', 'src-tauri/Cargo.toml', '--locked'],
    {
      cwd: root,
      env: {
        ...process.env,
        CARGO_TARGET_DIR: cargoTarget,
        // Parity exercises the CRM desktop and never launches the optional
        // Piper/llama sidecars. Fresh worktrees intentionally do not contain
        // those large gitignored packaging files, so remove only externalBin
        // from Tauri's debug-build config instead of borrowing another tree's
        // files or failing a CRM measurement for an unused package asset.
        TAURI_CONFIG: JSON.stringify({
          build: { devUrl: `http://127.0.0.1:${vitePort}` },
          bundle: { externalBin: [] },
        }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const capture = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-8_000);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const code = await new Promise<number>((resolveCode, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode) => resolveCode(exitCode ?? 1));
  }).catch((error: unknown) => {
    throw new InfrastructureError(
      `Could not start the current-HEAD debug build: ${errorText(error)}`
    );
  });
  if (code !== 0 || !existsSync(binaryPath)) {
    throw new InfrastructureError(
      `Could not build the debug binary for current HEAD ${head.slice(0, 12)} (exit ${code})${output ? `: ${output.trim()}` : '.'}`
    );
  }
  writeFileSync(
    buildReceiptPath,
    `${JSON.stringify({ head, binaryPath, vitePort, builtAt: new Date().toISOString() }, null, 2)}\n`
  );
}

async function ensureCurrentBinary(): Promise<'verified' | 'rebuilt'> {
  const head = currentHead();
  if (existsSync(binaryPath) && existsSync(buildReceiptPath)) {
    try {
      const receipt = JSON.parse(readFileSync(buildReceiptPath, 'utf8')) as {
        head?: string;
        binaryPath?: string;
        vitePort?: number;
      };
      if (
        receipt.head === head &&
        receipt.binaryPath === binaryPath &&
        receipt.vitePort === vitePort
      )
        return 'verified';
    } catch {
      // A broken receipt is the same as no receipt: rebuild, then write a good one.
    }
  }
  await runBuild(head);
  return 'rebuilt';
}

async function acquireViteLease(): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      mkdirSync(viteLeaseDir);
      writeFileSync(resolve(viteLeaseDir, 'owner'), `${process.pid}\n`);
      return;
    } catch {
      try {
        const owner = Number(
          readFileSync(resolve(viteLeaseDir, 'owner'), 'utf8').trim()
        );
        if (!Number.isFinite(owner)) throw new Error('invalid owner');
        process.kill(owner, 0);
      } catch {
        rmSync(viteLeaseDir, { recursive: true, force: true });
      }
      await delay(200);
    }
  }
  throw new InfrastructureError(
    `Could not acquire the parity Vite lease at ${viteLeaseDir} within 120 seconds.`
  );
}

function releaseViteLease(): void {
  try {
    const owner = readFileSync(resolve(viteLeaseDir, 'owner'), 'utf8').trim();
    if (owner === String(process.pid))
      rmSync(viteLeaseDir, { recursive: true, force: true });
  } catch {
    // It was never acquired, or a killed process already had its stale lease reclaimed.
  }
}

function viteListenerRoot(): string | undefined {
  try {
    const output = execFileSync(
      'lsof',
      ['-nP', `-iTCP:${vitePort}`, '-sTCP:LISTEN', '-t'],
      { encoding: 'utf8' }
    ).trim();
    const pid = output.split(/\s+/).find(Boolean);
    return pid
      ? execFileSync('readlink', ['-f', `/proc/${pid}/cwd`], {
          encoding: 'utf8',
        }).trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function viteExecutable(): string {
  try {
    const packagePath = execFileSync(
      'node',
      ['-e', "process.stdout.write(require.resolve('vite/package.json'))"],
      { cwd: root, encoding: 'utf8' }
    ).trim();
    const executable = resolve(dirname(packagePath), 'bin/vite.js');
    if (!existsSync(executable)) throw new Error(`missing ${executable}`);
    return executable;
  } catch (error) {
    throw new InfrastructureError(
      `The locked Vite dependency cache is missing; install this worktree's npm dependencies (${errorText(error)}).`
    );
  }
}

async function assertViteHealthy(): Promise<void> {
  if (!(await portReady(vitePort))) {
    throw new InfrastructureError(
      `Vite is not serving on the binary's compiled port ${vitePort}.`
    );
  }
  const listenerRoot = viteListenerRoot();
  if (!listenerRoot) {
    throw new InfrastructureError(
      `Vite answers on port ${vitePort}, but its owning process cannot be identified.`
    );
  }
  if (resolve(listenerRoot) !== root) {
    throw new InfrastructureError(
      `Port ${vitePort} is serving a different worktree (${listenerRoot}); expected ${root}.`
    );
  }
}

async function ensureVite(): Promise<'verified' | 'started'> {
  if (await portReady(vitePort)) {
    await assertViteHealthy();
    return 'verified';
  }
  vite = start(
    'node',
    [
      viteExecutable(),
      '--host',
      '127.0.0.1',
      '--port',
      String(vitePort),
      '--strictPort',
    ],
    process.env
  );
  vite.stdout?.on('data', (chunk: Buffer) => {
    viteOutput = `${viteOutput}${chunk.toString()}`.slice(-4_000);
  });
  vite.stderr?.on('data', (chunk: Buffer) => {
    viteOutput = `${viteOutput}${chunk.toString()}`.slice(-4_000);
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await portReady(vitePort)) {
      await assertViteHealthy();
      return 'started';
    }
    if (vite.exitCode !== null || vite.signalCode !== null) break;
    await delay(200);
  }
  throw new InfrastructureError(
    `Vite did not start on port ${vitePort}${viteOutput ? `: ${viteOutput.trim()}` : '.'}`
  );
}

function matrixInventory(): { active: string[]; skipped: string[] } {
  const active: string[] = [];
  const skipped: string[] = [];
  for (const line of readFileSync(
    resolve(root, 'design/01-wealthbox-feature-matrix.md'),
    'utf8'
  ).split('\n')) {
    if (!line.startsWith('|')) continue;
    const columns = line.split('|').map((value) => value.trim());
    const verdict = columns.at(-2) ?? '';
    if (!/^(REPLICATE|IMPROVE|SKIP)/.test(verdict)) continue;
    (verdict.startsWith('SKIP') ? skipped : active).push(columns[1] ?? '');
  }
  return { active, skipped };
}

function sameMultiset(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  return (
    [...actual].sort().join('\u0000') === [...expected].sort().join('\u0000')
  );
}

function validateManifest(): void {
  const matrix = matrixInventory();
  const active = FEATURES.map((feature) => feature.matrixFeature);
  const skipped = SKIPPED_FEATURES.map((feature) => feature.matrixFeature);
  if (!sameMultiset(active, matrix.active))
    fail(
      `Manifest does not match every REPLICATE/IMPROVE matrix row. Manifest=${active.length}, matrix=${matrix.active.length}`
    );
  if (!sameMultiset(skipped, matrix.skipped))
    fail(
      `Skipped feature list does not match every SKIP matrix row. Manifest=${skipped.length}, matrix=${matrix.skipped.length}`
    );
  for (const feature of FEATURES) {
    if (!feature.assert && !feature.pending)
      fail(`${feature.id} has neither an assertion nor a pending reason`);
    if (feature.assert && feature.pending)
      fail(`${feature.id} cannot be both live and pending`);
  }
}

class DesktopParityApp implements ParityApp {
  restarts = 0;
  private sequence = 0;
  private activeWorkspacePath = workspaceRoot;

  constructor(private readonly restartDesktopProcess: () => Promise<void>) {}

  private async eval(js: string): Promise<unknown> {
    const end = Date.now() + 15_000;
    while (true) {
      try {
        return await http('/eval', { js });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // WebKit uses this empty-stack shape when a page or CRM surface swaps
        // underneath an evaluation. Retry only that known handoff; real app
        // errors keep their message and still fail immediately.
        const emptyWebKitHandoff =
          /^@\s*eval code@/s.test(message) ||
          /^(?:@\s*)?eval code@[\s\S]*eval@\[native code\]/.test(message);
        if (!emptyWebKitHandoff || Date.now() >= end) throw error;
        await delay(50);
      }
    }
  }
  private async exists(testid: string): Promise<boolean> {
    return Boolean(
      await this.eval(
        `Boolean(document.querySelector('[data-testid="${testid}"]'))`
      )
    );
  }
  private async require(testid: string): Promise<void> {
    this.lastStep = `require(${JSON.stringify(arguments[0])})`;
    if (!(await this.exists(testid)))
      fail(`Missing required control: ${testid}`);
  }
  private async click(testid: string): Promise<void> {
    this.lastStep = `click(${JSON.stringify(arguments[0])})`;
    await this.require(testid);
    await http('/click', { testid });
  }

  /**
   * A real desktop can keep its spine expanded or fold it into its compact
   * icon rail. Both controls are the same navigation action, but they have
   * distinct stable handles because only one is mounted at a time. Acceptance
   * checks must drive the visible control instead of mistaking a saved layout
   * preference for a missing product feature.
   */
  private async clickSpineTab(tab: 'home' | 'matters'): Promise<void> {
    const expanded = `spine-nav-${tab}`;
    const collapsed = `spine-nav-collapsed-${tab}`;
    if (await this.exists(expanded)) {
      await this.click(expanded);
      return;
    }
    if (await this.exists(collapsed)) {
      await this.click(collapsed);
      return;
    }
    this.lastStep = `require(${JSON.stringify(expanded)} or ${JSON.stringify(collapsed)})`;
    fail(
      `Missing required spine navigation control: ${expanded} or ${collapsed}`
    );
  }
  private async fill(testid: string, value: string): Promise<void> {
    this.lastStep = `fill(${JSON.stringify(arguments[0])})`;
    await this.require(testid);
    await http('/fill', { testid, text: value });
    // The Linux bridge returns as soon as it dispatches the input event. React
    // applies the controlled value on its next paint; clicking Submit before
    // that paint sends the form's old empty value. Windows' Playwright drive
    // naturally waits across this boundary, so explicitly match it here.
    await this.eval(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`
    );
  }
  private async select(testid: string, value: string): Promise<void> {
    await this.require(testid);
    await this.eval(
      `(() => { const element = document.querySelector('[data-testid="${testid}"]'); if (!(element instanceof HTMLSelectElement)) throw new Error('Not a select: ${testid}'); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('change', { bubbles: true })); return element.value; })()`
    );
  }
  /** Public so a failure can report what the user would actually be looking at. */
  async text(): Promise<string> {
    return String(await this.eval('document.body.innerText'));
  }
  /**
   * Require text to become visible to a real user.
   *
   * This used to check exactly ONCE, instantly after the click that saves a
   * record — so a record that saved correctly and rendered a moment later was
   * reported as a product failure. That single line reported the whole Clients
   * front door as 0/15 while the product actually worked. It now polls, exactly
   * like `waitForText`: it still demands the user SEES the record (the front
   * door's real promise), it just stops confusing "not yet painted" with "broken".
   */
  /** The last action attempted — reported verbatim when a feature fails. */
  lastStep = '(no step attempted)';

  private async requireText(value: string): Promise<void> {
    this.lastStep = `requireText(${value})`;
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      try {
        if ((await this.text()).includes(value)) return;
      } catch {
        // Saving swaps the visible CRM surface. WebKit may cancel one screen
        // read during that swap; the required text must still appear before
        // the unchanged deadline.
      }
      await delay(150);
    }
    fail(`Expected visible text: ${value}`);
  }
  private async waitForText(value: string): Promise<void> {
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      try {
        if ((await this.text()).includes(value)) return;
      } catch {
        // Keep polling across a real renderer handoff.
      }
      await delay(150);
    }
    fail(`Expected visible text: ${value}`);
  }
  private async waitForControl(testid: string): Promise<void> {
    this.lastStep = `waitForControl(${JSON.stringify(arguments[0])})`;
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      try {
        if (await this.exists(testid)) return;
      } catch {
        // A renderer handoff can cancel one bridge evaluation. The control is
        // still required before the same ten-second deadline.
      }
      await delay(150);
    }
    fail(`Missing required control: ${testid}`);
  }
  private token(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${Date.now()}-${this.sequence}`;
  }

  private async waitForStableShell(
    timeoutMs: number,
    oldDocumentMarker?: string
  ): Promise<void> {
    this.lastStep = 'wait for workspace auto-resume to settle';
    const deadline = Date.now() + timeoutMs;
    let stableSince = 0;
    while (Date.now() < deadline) {
      try {
        const state = (await this.eval(`(() => ({
          isFresh: ${oldDocumentMarker === undefined ? 'true' : `window.__lanternParityDocumentMarker !== ${JSON.stringify(oldDocumentMarker)}`},
          hasShell: Boolean(document.querySelector('[data-testid="spine-nav"]')),
          isResuming: Boolean(document.querySelector('[data-testid="workspace-auto-resume-loading"]')),
          hasPicker: Boolean(document.querySelector('[data-testid="workspace-selector-dialog"]')),
        }))()`)) as {
          isFresh?: boolean;
          hasShell?: boolean;
          isResuming?: boolean;
          hasPicker?: boolean;
        };
        const ready =
          state.isFresh &&
          state.hasShell &&
          !state.isResuming &&
          !state.hasPicker;
        if (ready) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= 750) return;
        } else {
          stableSince = 0;
        }
      } catch {
        stableSince = 0;
      }
      await delay(150);
    }
    throw new InfrastructureError(
      'The desktop workspace did not finish its normal auto-resume'
    );
  }

  private async waitForCrmReady(path: string): Promise<void> {
    this.lastStep = 'wait for the CRM store to finish opening';
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const records = await http('/eval', {
          js: `(async () => {
            const invoke = window.__TAURI_INTERNALS__?.invoke;
            if (!invoke) throw new Error('Tauri invoke is unavailable');
            const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
            if (useWorkspaceStore.getState().rootPath !== ${JSON.stringify(path)})
              useWorkspaceStore.getState().setRootPath(${JSON.stringify(path)});
            await invoke('crm_set_workspace', { path: ${JSON.stringify(path)} });
            return invoke('crm_live_list');
          })()`,
          timeout_ms: '15000',
        });
        if (Array.isArray(records)) return;
      } catch {
        // The ordinary workspace lifecycle may still hold its short open lock.
      }
      await delay(150);
    }
    throw new InfrastructureError('The CRM store did not finish opening');
  }

  async ready(): Promise<void> {
    // Open the first workspace through the same normal auto-resume path an
    // advisor uses.  Setting only Zustand's rootPath leaves the picker open,
    // because that skips the lifecycle commit which dismisses it.  The old
    // shortcut therefore made every parity feature fail before a CRM screen
    // could mount.
    const firstRendererDeadline = Date.now() + 30_000;
    let rendererReady = false;
    while (Date.now() < firstRendererDeadline) {
      try {
        await this.eval('document.readyState');
        rendererReady = true;
        break;
      } catch {
        // The desktop bridge comes up before the WebView has its first page.
        // Polling the real renderer prevents a slow cold start from becoming
        // a fictional feature failure.
        await delay(150);
      }
    }
    if (!rendererReady)
      throw new InfrastructureError(
        'The desktop renderer did not become ready'
      );
    const oldDocumentMarker = this.token('bootstrap-document');
    await http('/eval', {
      js: `(() => {
      window.__lanternParityDocumentMarker = ${JSON.stringify(oldDocumentMarker)};
      localStorage.setItem('lantern_onboarding_complete', 'true');
      localStorage.setItem('keepance_feature_tour_dismissed', 'true');
      localStorage.setItem('keepance_feature_tour_completed', 'true');
      localStorage.setItem('lantern:settings', JSON.stringify({ state: { featuresTourCompleted: true, _migrated: true }, version: 0 }));
      localStorage.setItem('lantern_recent_workspaces', JSON.stringify([{
        path: ${JSON.stringify(workspaceRoot)},
        name: 'Parity verification firm',
        lastOpened: new Date().toISOString(),
      }]));
      // Returning from an in-page evaluation after calling reload directly is
      // racy: WebKit tears down the evaluation before the dev bridge can send
      // its success response. Schedule the normal reload for the next turn so
      // this is still a real fresh renderer, but the driver can observe it.
      setTimeout(() => location.reload(), 50);
      return true;
    })()`,
    });
    await this.waitForStableShell(60_000, oldDocumentMarker);
    // The normal recent-workspace route above already opened a real workspace.
    // Do not race that reload by switching CRM stores during startup.
    await this.openHome();
  }

  private async setWorkspace(
    name: string
  ): Promise<{ path: string; householdId: string }> {
    const path = `${workspaceRoot}/${name}`;
    this.activeWorkspacePath = path;
    const householdId = `parity-household-${this.token(name)}`;
    await this.eval(`(async () => {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (!invoke) throw new Error('Tauri invoke is unavailable');
      await invoke('crm_set_workspace', { path: ${JSON.stringify(path)} });
      const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
      useWorkspaceStore.getState().setRootPath(${JSON.stringify(path)});
      localStorage.setItem('lantern_recent_workspaces', JSON.stringify([{
        path: ${JSON.stringify(path)},
        name: 'Parity feature workspace',
        lastOpened: new Date().toISOString(),
      }]));
      await invoke('crm_live_upsert', { record: { id: ${JSON.stringify(householdId)}, kind: 'household', matterId: ${JSON.stringify(householdId)}, name: 'Parity household', status: 'active' } });
      await invoke('crm_live_upsert', { record: { id: 'parity-firm-member', kind: 'firmDirectoryEntry', matterId: 'firm_home', userId: 'parity-user', displayName: 'Parity teammate', title: 'Owner', teamLabels: ['Client service'], active: true } });
      await invoke('crm_live_upsert', { record: { id: 'parity-meeting', kind: 'activityEvent', matterId: 'firm_home', verb: 'meeting.captured', summary: 'Parity review meeting', at: new Date().toISOString() } });
      return true;
    })()`);
    // Switching the live CRM store also remounts the app surface. Let that
    // visible transition settle before asking the newly mounted Home rail for
    // a control. A short quarter-second wait observed the old surface and
    // produced a false "missing control" verdict.
    await delay(1_000);
    return { path, householdId };
  }

  private async records(): Promise<Array<Record<string, unknown>>> {
    const result = await this.eval(
      `window.__TAURI_INTERNALS__.invoke('crm_live_list')`
    );
    if (!Array.isArray(result)) fail('CRM record store did not return a list');
    return result as Array<Record<string, unknown>>;
  }

  /**
   * Open the top-level space a feature actually lives in.
   *
   * Contacts/Clients features render in the CLIENTS space (`spine-nav-matters`),
   * not Home. The driver used to always open Home, so every Clients-routed
   * assertion looked for a control that could not be on screen and failed —
   * reporting 0/15 for features that genuinely worked. A scoreboard that blames
   * the product for its own navigation bug is worse than no scoreboard.
   */
  private async openSpace(route?: string): Promise<void> {
    const clientsRoutes = ['clients', 'crm-directory', 'crm-clients'];
    const wantsClients =
      !!route && clientsRoutes.some((prefix) => route.startsWith(prefix));
    if (wantsClients) {
      if (await this.exists('crm-directory-surface')) return;
      await this.clickSpineTab('matters');
      const end = Date.now() + 10_000;
      while (Date.now() < end) {
        if (await this.exists('crm-directory-surface')) return;
        await delay(150);
      }
      fail('The desktop app did not show the Clients directory');
    }
    if (await this.exists('crm-home-nav-tasks')) return;
    await this.clickSpineTab('home');
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      if (await this.exists('crm-home-nav-tasks')) return;
      await delay(150);
    }
    fail('The desktop app did not show Home work surfaces');
  }

  private async openHome(route?: string): Promise<void> {
    await this.openSpace(route);
  }

  private async openClientsDirectory(): Promise<void> {
    await this.clickSpineTab('matters');
    const deadline = Date.now() + 10_000;
    let stableSince = 0;
    while (Date.now() < deadline) {
      if (await this.exists('crm-household-record')) {
        stableSince = 0;
        await this.click('crm-household-back');
      } else if (await this.exists('crm-directory-surface')) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 750) return;
      } else {
        stableSince = 0;
      }
      await delay(150);
    }
    fail('The desktop app did not show the Clients directory');
  }

  async restart(): Promise<void> {
    // Restart the whole desktop process through the Linux launcher. Letting
    // Tauri relaunch itself makes the launcher tear down the Xvfb screen that
    // the new process still needs, so a healthy app becomes unreachable.
    const oldRendererTimeOrigin = Number(
      await this.eval('performance.timeOrigin')
    );
    await this.restartDesktopProcess();
    const rendererDeadline = Date.now() + 30_000;
    let freshRenderer = false;
    while (Date.now() < rendererDeadline) {
      try {
        const currentTimeOrigin = Number(
          await http('/eval', {
            js: 'performance.timeOrigin',
            timeout_ms: '1000',
          })
        );
        if (currentTimeOrigin !== oldRendererTimeOrigin) {
          freshRenderer = true;
          break;
        }
      } catch {
        // The bridge is expected to disappear between the two real processes.
      }
      await delay(150);
    }
    if (!freshRenderer)
      throw new InfrastructureError(
        'The desktop app did not provide a fresh renderer after restart'
      );
    this.restarts += 1;
    await this.waitForStableShell(60_000);
    await this.waitForCrmReady(this.activeWorkspacePath);
    await this.openHome();
  }

  async task(options: {
    recurrence?: boolean;
    priority?: boolean;
    assignee?: boolean;
    activity?: boolean;
    unified?: boolean;
    triage?: boolean;
  }): Promise<void> {
    const { householdId } = await this.setWorkspace('tasks');
    await this.openHome();
    const title = this.token('Parity task');
    await this.click('crm-home-nav-tasks');
    await this.click('crm-task-new');
    await this.fill('crm-task-title-input', title);
    await this.fill('crm-task-body', 'Created by the parity acceptance check.');
    await this.select('crm-task-household', householdId);
    if (options.assignee) await this.select('crm-task-assignee', 'parity-user');
    if (options.priority) await this.select('crm-task-priority', 'high');
    if (options.recurrence) await this.select('crm-task-recurrence', 'weekly');
    await this.click('crm-task-save');
    await this.waitForText(title);
    const beforeRestart = await this.records();
    const saved = beforeRestart.find(
      (record) => record.kind === 'task' && record.title === title
    );
    if (!saved) fail('Saving the task did not create a CRM task record');
    if (options.assignee && saved.assigneeUserId !== 'parity-user')
      fail('Task assignee did not save');
    if (options.priority && saved.priority !== 'high')
      fail('Task priority did not save');
    if (
      options.recurrence &&
      (saved.recurrence as { freq?: unknown } | undefined)?.freq !== 'weekly'
    )
      fail('Task recurrence did not save');
    if (options.recurrence) {
      await this.click(`crm-task-complete-${String(saved.id)}`);
      const end = Date.now() + 10_000;
      let nextCreated = false;
      while (Date.now() < end) {
        const afterCompletion = await this.records();
        nextCreated = afterCompletion.some(
          (record) =>
            record.kind === 'task' &&
            record.title === title &&
            record.id !== saved.id &&
            record.status !== 'done'
        );
        if (nextCreated) break;
        await delay(150);
      }
      if (!nextCreated)
        fail(
          'Completing a recurring task did not create its next open instance'
        );
    }
    if (
      options.activity &&
      !beforeRestart.some((record) => record.kind === 'activityEvent')
    )
      fail('Task creation did not add a real activity event');
    if (options.unified) {
      await this.click('crm-home-nav-workflows');
      await this.click('crm-live-workflow-new-template');
      await this.fill(
        'crm-live-workflow-name',
        this.token('Parity unified workflow')
      );
      await this.fill(
        'crm-live-workflow-step-title-1',
        'A workflow step in the shared list'
      );
      await this.click('crm-live-workflow-create-template');
      await this.waitForControl('crm-live-workflow-start');
      await this.click('crm-live-workflow-start');
      await this.openHome();
      await this.click('crm-home-nav-tasks');
      const sharedWork = await this.eval(
        `Boolean(document.querySelector('[data-testid^="crm-workflow-work-"]'))`
      );
      if (!sharedWork)
        fail('A real workflow step did not appear in the shared work list');
    }
    await this.restart();
    const afterRestart = await this.records();
    if (
      !afterRestart.some(
        (record) => record.kind === 'task' && record.title === title
      )
    )
      fail('Saved task disappeared after native restart');
    if (options.triage) {
      await this.openHome();
      await this.click('crm-home-nav-today');
      await this.requireText(title);
    }
  }

  async contact(options: {
    person?: boolean;
    household?: boolean;
    relationship?: boolean;
    roles?: boolean;
    ownership?: boolean;
    tags?: boolean;
    notes?: boolean;
    internal?: boolean;
    account?: boolean;
    addresses?: boolean;
    facts?: boolean;
    timeline?: boolean;
  }): Promise<void> {
    // Every Clients assertion gets an empty store. Reusing the root store made
    // the next feature inherit the prior feature's selected household, so a
    // restart could honestly show a real record but the wrong test record.
    const path = `${workspaceRoot}/contacts-${this.token('workspace')}`;
    this.activeWorkspacePath = path;
    await this.eval(`(async () => {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (!invoke) throw new Error('Tauri invoke is unavailable');
      await invoke('crm_set_workspace', { path: ${JSON.stringify(path)} });
      const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
      useWorkspaceStore.getState().setRootPath(${JSON.stringify(path)});
      localStorage.setItem('lantern_recent_workspaces', JSON.stringify([{
        path: ${JSON.stringify(path)},
        name: 'Parity Clients workspace',
        lastOpened: new Date().toISOString(),
      }]));
      return true;
    })()`);
    await this.waitForCrmReady(path);
    const household = this.token('Parity household');
    const person = this.token('Parity person');
    await this.openClientsDirectory();
    await this.click('crm-directory-add');
    await this.fill('crm-household-name', household);
    await this.click('crm-household-save');
    // Saving goes through SQLCipher and remounts Clients as the household
    // record.  Seeing the name in the directory is not enough: wait for the
    // actual record surface before trying its contact controls.
    await this.waitForControl('crm-household-record');
    await this.requireText(household);
    if (options.ownership) {
      await this.click('crm-household-edit');
      await this.fill('crm-household-edit-tier', 'Platinum');
      await this.fill('crm-household-edit-advisor', 'Parity advisor');
      await this.click('crm-household-edit-save');
    }
    if (options.person) {
      await this.click('crm-household-add');
      await this.click('crm-household-add-person');
      await this.fill('crm-person-name', person);
      if (options.roles) await this.fill('crm-person-roles', 'CPA');
      if (options.relationship)
        await this.fill('crm-person-relationship', 'Spouse');
      if (options.addresses) {
        await this.require('crm-person-email-add');
        await this.click('crm-person-email-add');
      }
      await this.click('crm-person-save');
      await this.requireText(person);
    }
    if (options.account) {
      await this.click('crm-household-add');
      await this.click('crm-household-add-account');
      await this.fill('crm-account-custodian', 'Parity custody');
      await this.fill('crm-account-type', 'Investment');
      await this.fill('crm-account-purpose', 'Parity purpose');
      await this.fill('crm-account-last-four', '1234');
      await this.click('crm-account-save');
    }
    if (options.notes) {
      await this.click('crm-household-add');
      await this.click('crm-household-add-note');
      await this.fill('crm-note-body', 'Parity note');
      if (options.internal) {
        await this.require('crm-note-audience-internal');
        await this.click('crm-note-audience-internal');
      }
      await this.click('crm-note-save');
    }
    if (options.tags) {
      await this.click('crm-household-metadata');
      await this.fill('crm-tag-input', 'parity-tag');
      await this.eval(
        `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Add tag')?.click()`
      );
      await this.click('crm-save-metadata');
    }
    if (options.facts) {
      await this.require('crm-household-add-fact');
      await this.click('crm-household-add-fact');
      await this.fill('crm-fact-label', 'Parity remembered fact');
      await this.fill('crm-fact-value', 'October');
      await this.fill('crm-fact-source', 'Parity review meeting');
      await this.click('crm-fact-save');
    }
    if (options.timeline) {
      await this.click('crm-household-tab-timeline');
      await this.require('crm-household-timeline');
      if (options.notes) await this.requireText('Parity note');
    }
    await this.restart();
    await this.waitForCrmReady(path);
    // Clients remembers the open household across restart. Return through its
    // visible Directory control before checking the People directory.
    await this.openClientsDirectory();
    await this.requireText(household);
    if (options.person) {
      // A person belongs in the People directory, not in the default
      // Households view.  Prove the front door end to end: deliberately open
      // that view, search for the newly-created person, and require their
      // actual directory row after the native restart.  Do not let a person
      // merely surviving inside its household record count as a visible
      // client.
      await this.eval(`(() => {
        const people = Array.from(document.querySelectorAll('button')).find(
          (button) => button.textContent?.trim() === 'People'
        );
        if (!(people instanceof HTMLButtonElement))
          throw new Error('The Clients directory has no People view');
        people.click();
        return true;
      })()`);
      await this.fill('crm-directory-search', person);
      const listedDeadline = Date.now() + 10_000;
      let listed = false;
      while (Date.now() < listedDeadline) {
        listed = Boolean(
          await this.eval(
            `Array.from(document.querySelectorAll('[data-testid^="crm-directory-person-"]')).some((row) => row.textContent?.includes(${JSON.stringify(person)}))`
          )
        );
        if (listed) break;
        await delay(150);
      }
      if (!listed)
        fail(
          'Saved person is missing from the Clients People directory after native restart'
        );
    }
    if (options.ownership) {
      await this.requireText('Platinum');
      await this.requireText('Parity advisor');
    }
    if (options.tags) await this.requireText('parity-tag');
    if (options.notes) await this.requireText('Parity note');
  }

  async workflow(options: {
    template?: boolean;
    instance?: boolean;
    schedule?: boolean;
    outcomes?: boolean;
    comments?: boolean;
    library?: boolean;
    meetingProposal?: boolean;
  }): Promise<void> {
    const { path, householdId } = await this.setWorkspace(
      `workflows-${this.token('workspace')}`
    );
    await this.openHome();
    await this.waitForControl('crm-home-nav-workflows');
    await this.click('crm-home-nav-workflows');
    if (options.library) await this.require('crm-live-workflow-library');
    if (!(await this.exists('crm-live-workflow-name'))) {
      await this.click('crm-live-workflow-new-template');
    }
    const controls = [
      'crm-live-workflow-name',
      'crm-live-workflow-step-title-1',
      'crm-live-workflow-create-template',
    ];
    for (const control of controls) await this.require(control);
    const title = this.token('Parity workflow');
    await this.fill('crm-live-workflow-name', title);
    await this.fill(
      'crm-live-workflow-step-title-1',
      'Prove restart persistence'
    );
    await this.click('crm-live-workflow-create-template');
    await this.waitForControl('crm-live-workflow-start');
    if (options.schedule || options.outcomes) {
      await this.waitForControl('crm-live-workflow-edit-template');
      await this.click('crm-live-workflow-edit-template');
      if (options.schedule)
        await this.waitForControl('crm-live-workflow-schedule');
      if (options.outcomes)
        await this.waitForControl('crm-live-workflow-outcome-add');
    }
    if (options.meetingProposal) {
      await this.waitForControl('crm-live-workflow-meeting-proposal');
      await this.select('crm-live-meeting-select', 'parity-meeting');
      await this.select('crm-live-meeting-household', householdId);
      await this.click('crm-live-meeting-propose-workflow');
      if (
        !(await this.records()).some(
          (record) =>
            record.kind === 'proposalRecord' &&
            record.proposalKind === 'workflow_launch'
        )
      )
        fail('Meeting did not create an approval-visible workflow proposal');
    }
    if (options.instance) {
      await this.click('crm-live-workflow-start');
      await delay(200);
      if (
        !(await this.records()).some(
          (record) => record.kind === 'crm_workflow_instance'
        )
      )
        fail('Starting a workflow did not create an open household workflow');
      if (options.comments)
        await this.waitForControl('crm-live-workflow-step-comment');
    }
    await this.restart();
    await this.eval(
      `(async () => { const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(path)}); return true; })()`
    );
    await this.openHome();
    await this.click('crm-home-nav-workflows');
    await this.waitForText(title);
  }

  async jumpMeeting(): Promise<void> {
    const { path, householdId } = await this.setWorkspace(
      `jump-meeting-${this.token('workspace')}`
    );
    await this.openHome();
    await this.waitForControl('crm-home-nav-workflows');
    await this.click('crm-home-nav-workflows');
    await this.click('crm-live-workflow-new-template');
    const title = this.token('Parity meeting follow-up');
    await this.fill('crm-live-workflow-name', title);
    await this.fill('crm-live-workflow-step-title-1', 'Review meeting notes');
    await this.click('crm-live-workflow-create-template');
    await this.waitForControl('crm-live-workflow-meeting-proposal');
    await this.require('crm-jump-meeting-fixture');
    await this.select('crm-live-meeting-select', 'parity-meeting');
    await this.select('crm-live-meeting-household', householdId);
    await this.click('crm-live-meeting-propose-workflow');
    const beforeRestart = await this.records();
    const proposal = beforeRestart.find(
      (record) =>
        record.kind === 'proposalRecord' &&
        record.proposalKind === 'workflow_launch' &&
        record.title === `Review proposed ${title} workflow`
    );
    if (!proposal)
      fail(
        'Meeting fixture did not create an approval-visible workflow proposal'
      );
    await this.restart();
    await this.waitForCrmReady(path);
    const afterRestart = await this.records();
    if (!afterRestart.some((record) => record.id === proposal.id))
      fail('Meeting workflow proposal disappeared after native restart');
  }

  async approvedPlaybook(): Promise<void> {
    const { path } = await this.setWorkspace(
      `approved-playbook-${this.token('workspace')}`
    );
    await this.openHome();
    await this.waitForControl('crm-home-nav-workflows');
    await this.click('crm-home-nav-workflows');
    await this.require('crm-approved-playbook-fixture');
    await this.click('crm-starter-workflow-annual-review');
    await this.waitForControl('crm-live-workflow-template-form');
    await this.click('crm-live-workflow-create-template');
    await this.waitForControl('crm-live-workflow-template');
    const beforeRestart = await this.records();
    const playbook = beforeRestart.find(
      (record) =>
        record.kind === 'crm_workflow_template' &&
        record.name === 'Annual review'
    );
    if (!playbook)
      fail(
        'Approved playbook fixture did not create a saved workflow template'
      );
    await this.restart();
    await this.waitForCrmReady(path);
    const afterRestart = await this.records();
    if (!afterRestart.some((record) => record.id === playbook.id))
      fail('Approved playbook disappeared after native restart');
  }

  async pipeline(options: {
    opportunity?: boolean;
    pipeline?: boolean;
    stage?: boolean;
    workflowTrigger?: boolean;
  }): Promise<void> {
    const { householdId } = await this.setWorkspace(
      `pipeline-${this.token('setup')}`
    );
    await this.openHome();
    const pipelineName = this.token('Parity pipeline');
    const stageName = this.token('Parity stage');
    const templateId = `parity-workflow-template-${this.token('pipeline')}`;
    if (options.workflowTrigger) {
      await this.eval(
        `window.__TAURI_INTERNALS__.invoke('crm_live_upsert', { record: { id: ${JSON.stringify(templateId)}, kind: 'workflowTemplate', matterId: 'firm_home', name: 'Parity workflow template' } })`
      );
    }
    await this.click('crm-home-nav-pipeline');
    await this.click('crm-pipeline-settings');
    await this.fill('crm-pipeline-name', pipelineName);
    await this.click('crm-pipeline-save');
    await delay(200);
    const pipeline = (await this.records()).find(
      (record) => record.kind === 'pipelineDef' && record.name === pipelineName
    );
    if (!pipeline || typeof pipeline.id !== 'string')
      fail('Saving a pipeline did not create a pipeline record');
    await this.fill(`crm-stage-name-${pipeline.id}`, stageName);
    await this.click(`crm-stage-save-${pipeline.id}`);
    await delay(200);
    const stage = (await this.records()).find(
      (record) =>
        record.kind === 'stageDef' &&
        record.pipelineId === pipeline.id &&
        record.name === stageName
    );
    if (!stage || typeof stage.id !== 'string')
      fail('Saving a stage did not create a stage record');
    if (options.workflowTrigger) {
      await this.select(`crm-stage-workflow-${stage.id}`, templateId);
      await this.click(`crm-stage-trigger-${stage.id}`);
      await this.click(`crm-stage-trigger-save-${stage.id}`);
      await delay(200);
      const storedStage = (await this.records()).find(
        (record) => record.id === stage.id
      );
      const hasTrigger =
        Array.isArray(storedStage?.triggerRules) &&
        storedStage.triggerRules.some(
          (rule: unknown) =>
            typeof rule === 'object' &&
            rule !== null &&
            (rule as { enabled?: unknown; workflowTemplateId?: unknown })
              .enabled === true &&
            (rule as { workflowTemplateId?: unknown }).workflowTemplateId ===
              templateId
        );
      if (!hasTrigger)
        fail(
          'Saving the workflow suggestion did not persist the stage trigger'
        );
    }
    if (options.opportunity) {
      await this.click('crm-pipeline-back');
      await this.click('crm-pipeline-new');
      const opportunityName = this.token('Parity opportunity');
      await this.fill('crm-opportunity-name', opportunityName);
      await this.select('crm-opportunity-household', householdId);
      await this.click('crm-opportunity-save');
      await delay(200);
      if (
        !(await this.records()).some(
          (record) =>
            record.kind === 'opportunity' &&
            record.name === opportunityName &&
            record.pipelineId === pipeline.id
        )
      )
        fail('Saving the opportunity did not create an opportunity record');
    }
    await this.restart();
    const afterRestart = await this.records();
    if (
      !afterRestart.some(
        (record) => record.id === pipeline.id && record.kind === 'pipelineDef'
      )
    )
      fail('Pipeline disappeared after native restart');
    if (
      !afterRestart.some(
        (record) => record.id === stage.id && record.kind === 'stageDef'
      )
    )
      fail('Stage disappeared after native restart');
  }

  async report(options: {
    kind: 'no_contact_6mo' | 'attention_vs_fee' | 'custom' | 'ai';
  }): Promise<void> {
    const { householdId } = await this.setWorkspace(
      `report-${this.token('setup')}`
    );
    await this.openHome();
    await this.eval(
      `window.__TAURI_INTERNALS__.invoke('crm_live_upsert', { record: { id: ${JSON.stringify(householdId)}, kind: 'household', matterId: ${JSON.stringify(householdId)}, name: 'Parity reporting household', status: 'active', annualFee: { value: 1200, currency: 'USD' } } })`
    );
    await this.click('crm-home-nav-reports');
    if (options.kind === 'ai') {
      await this.fill('crm-report-ai-prompt', 'Which clients need attention?');
      await this.click('crm-report-ai-run');
      await this.click('crm-report-ai-use-proposal');
    } else if (options.kind === 'attention_vs_fee') {
      await this.click('crm-report-attention-vs-fee');
    } else if (options.kind === 'custom') {
      await this.click('crm-report-builder');
    } else {
      await this.click('crm-report-no-contact-in-6-months');
    }
    await this.click('crm-report-run');
    await this.requireText('Computed just now');
    await delay(200);
    if (!(await this.records()).some((record) => record.kind === 'reportRun'))
      fail('Running the report did not create a report-run record');
    let savedReportName: string | undefined;
    if (options.kind === 'custom') {
      savedReportName = this.token('Parity saved report');
      await this.click('crm-report-save');
      await this.fill('crm-report-save-name', savedReportName);
      await this.click('crm-report-save-confirm');
      await delay(200);
      if (
        !(await this.records()).some(
          (record) =>
            record.kind === 'savedReport' && record.name === savedReportName
        )
      )
        fail('Saving the report recipe did not create a saved report');
    }
    await this.restart();
    const afterRestart = await this.records();
    if (!afterRestart.some((record) => record.kind === 'reportRun'))
      fail('Report-run record disappeared after native restart');
    if (
      savedReportName &&
      !afterRestart.some(
        (record) =>
          record.kind === 'savedReport' && record.name === savedReportName
      )
    )
      fail('Saved report disappeared after native restart');
  }

  private async openFirm(
    tab: 'setup' | 'fields' | 'tags' | 'values' = 'setup'
  ): Promise<void> {
    await this.openHome();
    await this.click('crm-home-nav-firm-setup');
    await this.waitForControl('crm-firm-surface');
    await this.click(`crm-firm-tab-${tab}`);
    await delay(150);
  }

  private async waitForRecord(
    predicate: (record: Record<string, unknown>) => boolean,
    message: string
  ): Promise<Record<string, unknown>> {
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      const record = (await this.records()).find(predicate);
      if (record) return record;
      await delay(150);
    }
    fail(message);
  }

  async firmDirectory(): Promise<void> {
    await this.setWorkspace(`firm-directory-${this.token('setup')}`);
    await this.openFirm();
    for (const control of [
      'crm-firm-directory',
      'crm-firm-access-read-model',
      'crm-firm-visibility-read-model',
      'crm-firm-permissions-read-model',
      'crm-firm-open-admin',
    ])
      await this.require(control);
    for (const text of ['Parity teammate', 'Owner', 'Client service'])
      await this.requireText(text);
    if (
      !(await this.records()).some(
        (record) => record.kind === 'firmDirectoryEntry'
      )
    )
      fail(
        'The existing firm-admin directory did not provide a member read-model'
      );
    await this.restart();
    await this.openFirm();
    for (const text of ['Parity teammate', 'Owner', 'Client service'])
      await this.requireText(text);
    if (
      !(await this.records()).some(
        (record) => record.kind === 'firmDirectoryEntry'
      )
    )
      fail('The firm-admin member read-model disappeared after native restart');
  }

  async firmSetup(): Promise<void> {
    const { householdId } = await this.setWorkspace(
      `firm-setup-${this.token('setup')}`
    );
    const fieldLabel = this.token('Parity custom field');
    const fieldKey = `parity_${this.sequence}`;
    const tagName = this.token('Parity tag');

    await this.openFirm('fields');
    await this.click('crm-field-create');
    await this.fill('crm-field-label', fieldLabel);
    await this.fill('crm-field-key', fieldKey);
    await this.click('crm-field-save');
    await this.waitForText(fieldLabel);
    const field = await this.waitForRecord(
      (record) =>
        record.kind === 'customFieldDef' && record.label === fieldLabel,
      'Saving a custom field did not create a field definition'
    );

    await this.openFirm('tags');
    await this.click('crm-tag-create');
    await this.fill('crm-tag-name', tagName);
    await this.click('crm-tag-save');
    await this.waitForText(tagName);
    const tag = await this.waitForRecord(
      (record) => record.kind === 'tag' && record.name === tagName,
      'Saving a tag did not create a tag record'
    );

    await this.openFirm('values');
    await this.select('crm-record-values-select', householdId);
    await this.waitForControl(`crm-record-value-${fieldKey}`);
    await this.fill(`crm-record-value-${fieldKey}`, 'North');
    await this.click(`crm-record-tag-${String(tag.id)}`);
    await this.click('crm-record-values-save');
    await this.waitForRecord(
      (record) =>
        record.id === householdId &&
        (
          record.customFields as Record<string, { value?: unknown }> | undefined
        )?.[fieldKey]?.value === 'North' &&
        Array.isArray(record.tagIds) &&
        record.tagIds.includes(tag.id),
      'Saving a custom-field value and tag did not update the selected record'
    );

    await this.restart();
    await this.openFirm('fields');
    await this.requireText(fieldLabel);
    await this.openFirm('tags');
    await this.requireText(tagName);
    await this.openFirm('values');
    await this.select('crm-record-values-select', householdId);
    let value: unknown;
    let appliedTag: unknown;
    const restoredValueDeadline = Date.now() + 10_000;
    do {
      value = await this.eval(
        `document.querySelector('[data-testid="crm-record-value-${fieldKey}"]')?.value`
      );
      appliedTag = await this.eval(
        `Boolean(document.querySelector('[data-testid="crm-record-tag-${String(tag.id)}"]:checked'))`
      );
      if (value === 'North' && appliedTag) break;
      await delay(150);
    } while (Date.now() < restoredValueDeadline);
    if (value !== 'North' || !appliedTag)
      fail('The custom-field value or tag disappeared after native restart');
    await this.waitForRecord(
      (record) =>
        record.id === householdId &&
        (
          record.customFields as Record<string, { value?: unknown }> | undefined
        )?.[fieldKey]?.value === 'North' &&
        Array.isArray(record.tagIds) &&
        record.tagIds.includes(tag.id),
      'The saved custom-field value or tag record disappeared after native restart'
    );
    if (field.kind !== 'customFieldDef')
      fail('Custom field definition changed kind unexpectedly');
  }

  async durableFeature(options: {
    route: string;
    controls: string[];
    action?: string;
    result?: string;
    recordKind?: string;
  }): Promise<void> {
    await this.setWorkspace(`feature-${this.token('route')}`);
    await this.openHome(options.route);
    if (
      !options.route.startsWith('clients') &&
      !options.route.startsWith('crm-directory')
    )
      await this.click(options.route);
    for (const control of options.controls) await this.require(control);
    if (options.action) await this.click(options.action);
    if (options.result) await this.requireText(options.result);
    if (
      options.recordKind &&
      !(await this.records()).some(
        (record) => record.kind === options.recordKind
      )
    )
      fail(`Action did not create a ${options.recordKind} record`);
    await this.restart();
    await this.click(options.route);
    for (const control of options.controls) await this.require(control);
    if (
      options.recordKind &&
      !(await this.records()).some(
        (record) => record.kind === options.recordKind
      )
    )
      fail(`${options.recordKind} record disappeared after native restart`);
  }

  async migration(options: {
    action:
      | 'crm-migration-run-import'
      | 'crm-redtail-import'
      | 'crm-salesforce-import';
    externalId?: boolean;
    exportFile?: boolean;
    fullReview?: boolean;
  }): Promise<void> {
    if (!migrationBaseUrl) fail('Migration simulator was not started');
    await this.setWorkspace(`migration-${this.token('workspace')}`);
    await this.openHome();
    await this.click('crm-home-nav-firm-setup');
    await this.click('crm-firm-route-migration');
    for (const control of [
      'crm-migration-base-url',
      'crm-migration-source-id-map',
      options.action,
      'crm-migration-fidelity',
    ])
      await this.require(control);
    await this.fill('crm-migration-base-url', migrationBaseUrl);
    if (options.externalId) {
      await this.fill('crm-migration-source-id-map', 'wealthbox_external_id');
      if (
        (await this.eval(
          `document.querySelector('[data-testid="crm-migration-source-id-map"]')?.value`
        )) !== 'wealthbox_external_id'
      )
        fail('The outside-ID mapping field did not retain its value');
    }
    await this.click(options.action);
    await this.waitForText('Import finished');
    const imported = await this.records();
    for (const kind of ['household', 'note', 'task', 'migration_report'])
      if (!imported.some((record) => record.kind === kind))
        fail(`Migration did not create a real ${kind} record`);
    const sourceProvider =
      options.action === 'crm-redtail-import'
        ? 'redtail'
        : options.action === 'crm-salesforce-import'
          ? 'salesforce'
          : 'wealthbox';
    const report = imported.find(
      (record) =>
        record.kind === 'migration_report' &&
        record.sourceProvider === sourceProvider
    );
    if (!report)
      fail(`The ${sourceProvider} sample did not keep its source provenance`);
    if (
      options.externalId &&
      (report.externalIdField !== 'wealthbox_external_id' ||
        !imported.some(
          (record) =>
            record.kind === 'household' &&
            record.externalIdField === 'wealthbox_external_id' &&
            typeof record.externalId === 'string'
        ))
    )
      fail('The selected outside-ID field did not persist on imported records');

    await this.click('crm-migration-fidelity');
    await this.require('crm-migration-fidelity-report');
    await this.requireText('0% via API');
    const fidelityRows = Number(
      await this.eval(
        `document.querySelectorAll('[data-testid^="crm-fidelity-row-"]').length`
      )
    );
    if (fidelityRows < 15)
      fail(
        `The fidelity report hid rows: expected every source type, saw ${String(fidelityRows)}`
      );

    if (options.fullReview) {
      await this.click('crm-migration-workflow-fallback');
      const workflowFallbacks = Number(
        await this.eval(
          `document.querySelectorAll('[data-testid^="crm-workflow-record-"]').length`
        )
      );
      if (!workflowFallbacks)
        fail('The open-workflow fallback did not present a saved checklist');
      await this.click('crm-home-nav-firm-setup');
      await this.click('crm-firm-route-migration');
      await this.click('crm-migration-fidelity');
      await this.click('crm-migration-attachment-fallback');
      const attachmentFallbacks = Number(
        await this.eval(
          `document.querySelectorAll('[data-testid^="crm-attachment-record-save-"]').length`
        )
      );
      if (!attachmentFallbacks)
        fail(
          'The attachment fallback did not present a saved accounting record'
        );
    }

    if (options.exportFile) {
      await this.click('crm-home-nav-firm-setup');
      await this.click('crm-firm-route-migration');
      await this.click('crm-migration-archive');
      await this.click('crm-export-create');
      await this.waitForText('Exported archive file.');
      const archive = (await this.records()).find(
        (record) =>
          record.kind === 'migration_export' && record.exportKind === 'archive'
      );
      if (
        typeof archive?.filePath !== 'string' ||
        !existsSync(archive.filePath)
      )
        fail('Archive export reported success but did not create a real file');
    }

    await this.restart();
    await this.click('crm-home-nav-firm-setup');
    await this.click('crm-firm-route-migration');
    await this.require('crm-migration-run-import');
    if (
      !(await this.records()).some(
        (record) => record.kind === 'migration_report'
      )
    )
      fail('Migration report disappeared after native restart');
  }
}

function printScoreboard(results: readonly Result[]): void {
  const built = results.filter((result) => result.status === 'BUILT');
  const failing = results.filter((result) => result.status === 'FAILING');
  const pending = results.filter((result) => result.status === 'PENDING');
  const percent =
    results.length === 0
      ? 0
      : Math.round((built.length / results.length) * 100);
  const names = (items: readonly Result[]) =>
    items.length ? items.map((item) => item.id).join(', ') : 'none';
  console.log(
    `PARITY: ${built.length}/${results.length} features verified (${percent}%) — BUILT: ${names(built)} | FAILING: ${names(failing)} | PENDING: ${names(pending)}`
  );
}

let vite: ChildProcess | undefined;
let desktop: ChildProcess | undefined;
let wbsim: ChildProcess | undefined;
let viteOutput = '';
let desktopOutput = '';
const results: Result[] = [];
let runFeatures: readonly ParityFeature[] = FEATURES;
let infrastructureError: string | undefined;
let currentPreflightCheck = 'runner startup';
let viteLeaseHeld = false;

function green(label: string, detail: string): void {
  if (preflight) console.log(`✅ ${label}: ${detail}`);
}

function startDesktop(): ChildProcess {
  const child = start(
    'bash',
    ['scripts/crm-loop/launch-app.sh', String(port), workspaceRoot],
    {
      ...process.env,
      LANTERN_APP_BINARY: binaryPath,
      LANTERN_DEV_BRIDGE_PORT: String(port),
      LANTERN_VITE_PORT: String(vitePort),
      LANTERN_XVFB_DISPLAY: xvfbDisplay,
    }
  );
  const capture = (chunk: Buffer) => {
    desktopOutput = `${desktopOutput}${chunk.toString()}`.slice(-6_000);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  return child;
}

async function assertInfrastructureLive(): Promise<void> {
  await assertViteHealthy();
  if (!desktop || desktop.exitCode !== null || desktop.signalCode !== null) {
    throw new InfrastructureError(
      `The parity-owned desktop app exited unexpectedly${desktopOutput ? `: ${desktopOutput.trim()}` : '.'}`
    );
  }
  await http('/health');
}

try {
  currentPreflightCheck = 'manifest';
  validateManifest();
  green(
    'Manifest',
    'every required feature has an acceptance check or an explicit pending reason'
  );
  if (featureFilter) {
    runFeatures = FEATURES.filter((feature) => feature.id === featureFilter);
    if (runFeatures.length !== 1) {
      throw new InfrastructureError(
        `Unknown PARITY_FEATURE=${featureFilter}. Choose one manifest feature id.`
      );
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new InfrastructureError(
      `PARITY_BRIDGE_PORT must be a valid TCP port; received ${String(port)}.`
    );
  }
  if (!Number.isInteger(vitePort) || vitePort < 1 || vitePort > 65_535) {
    throw new InfrastructureError(
      `PARITY_VITE_PORT must be a valid TCP port; received ${String(vitePort)}.`
    );
  }
  mkdirSync(workspaceRoot, { recursive: true });
  currentPreflightCheck = 'model cache';
  verifyModelCache();
  shareMachineModelCache();
  green(
    'Fixtures',
    `machine model cache is complete and linked into an empty private workspace`
  );
  currentPreflightCheck = 'free bridge port';
  if (await portReady(port)) {
    throw new InfrastructureError(
      `Parity needs unused bridge port ${port}. Another desktop bridge is already answering there.`
    );
  }
  green('Private ports', `free bridge port ${port} reserved for this run`);

  currentPreflightCheck = 'parity Vite lease';
  await acquireViteLease();
  viteLeaseHeld = true;
  green(
    'Concurrency',
    `box test slot is held by npm and the Vite lease is private to this run`
  );

  currentPreflightCheck = 'current debug binary';
  const binaryState = await ensureCurrentBinary();
  green(
    'Debug app',
    `${binaryState} for current HEAD ${currentHead().slice(0, 12)}`
  );

  currentPreflightCheck = 'Vite dev server';
  const viteState = await ensureVite();
  green(
    'Vite',
    `${viteState} and healthy on the binary's compiled port ${vitePort}`
  );
  if (process.env['PARITY_TEST_KILL_VITE_DURING_SETUP'] === '1') {
    if (!vite) {
      throw new InfrastructureError(
        'Vite kill-demo requires the runner to start Vite; port 5174 was already owned before setup.'
      );
    }
    stop(vite);
    await waitForExit(vite, 10_000);
    await assertViteHealthy();
  }

  currentPreflightCheck = 'desktop app and CRM shell';
  desktop = startDesktop();
  await waitForBridge();
  const app = new DesktopParityApp(async () => {
    const previousDesktop = desktop;
    stop(previousDesktop);
    const stopDeadline = Date.now() + 15_000;
    while (
      previousDesktop &&
      previousDesktop.exitCode === null &&
      previousDesktop.signalCode === null &&
      Date.now() < stopDeadline
    ) {
      await delay(100);
    }
    if (
      previousDesktop?.exitCode === null &&
      previousDesktop.signalCode === null
    ) {
      throw new InfrastructureError(
        'The old desktop process did not stop before restart'
      );
    }
    desktopOutput = '';
    desktop = startDesktop();
    await waitForBridge();
  });
  await app.ready();
  await assertInfrastructureLive();
  green(
    'Desktop app',
    `private app, data folders, virtual display ${xvfbDisplay}, bridge health, and CRM shell are ready`
  );

  currentPreflightCheck = 'fabricated Wealthbox source';
  const simulatorPort = await freePort();
  migrationBaseUrl = `http://127.0.0.1:${String(simulatorPort)}/v1`;
  wbsim = start('bun', ['tests/wbsim/server.ts'], {
    ...process.env,
    WBSIM_PORT: String(simulatorPort),
  });
  const simulatorDeadline = Date.now() + 30_000;
  while (Date.now() < simulatorDeadline) {
    try {
      if ((await fetch(`${migrationBaseUrl}/contacts?per_page=1`)).ok) break;
    } catch {
      // The simulator has not bound its local port yet.
    }
    await delay(150);
  }
  try {
    if (!(await fetch(`${migrationBaseUrl}/contacts?per_page=1`)).ok)
      throw new InfrastructureError(
        'The fabricated Wealthbox source did not become ready'
      );
  } catch (error) {
    if (error instanceof InfrastructureError) throw error;
    throw new InfrastructureError(
      'The fabricated Wealthbox source did not become ready'
    );
  }
  green(
    'Migration fixture',
    `fabricated Wealthbox source is healthy on private port ${simulatorPort}`
  );

  if (preflight) {
    console.log(
      'PREFLIGHT: GREEN — every precondition passed; zero features scored.'
    );
  }
  for (const feature of runFeatures) {
    if (preflight) break;
    await assertInfrastructureLive();
    if (feature.pending) {
      results.push({
        id: feature.id,
        name: feature.name,
        area: feature.area,
        verdict: feature.verdict,
        status: 'PENDING',
        detail: feature.pending,
      });
      continue;
    }
    const before = app.restarts;
    try {
      await feature.assert!(app);
      await assertInfrastructureLive();
      if (app.restarts === before) {
        fail('Assertion did not prove a native restart');
      }
      results.push({
        id: feature.id,
        name: feature.name,
        area: feature.area,
        verdict: feature.verdict,
        status: 'BUILT',
        detail:
          'Passed against the running desktop app and survived native restart.',
      });
    } catch (error) {
      if (error instanceof InfrastructureError) {
        throw new InfrastructureError(
          `While measuring ${feature.id} at ${app.lastStep}, the owned app became unavailable: ${errorText(error)}`
        );
      }
      // A scoreboard that says FAILING with an empty reason is not an instrument.
      // Record WHERE it broke (the last driver step), WHAT the app actually showed,
      // and any renderer error — so a failure can be acted on without a rerun.
      const raw = error instanceof Error ? error.message : String(error);
      const stack =
        error instanceof Error && error.stack
          ? error.stack.split('\n').slice(0, 3).join(' | ')
          : '';
      let onScreen = '';
      try {
        onScreen = (await app.text()).replace(/\s+/g, ' ').slice(0, 240);
      } catch {
        onScreen = '(could not read the screen — the app may have died)';
      }
      const detail = [
        `STEP: ${app.lastStep}`,
        `ERROR: ${raw || '(empty message)'}${stack ? ` :: ${stack}` : ''}`,
        `ON SCREEN: ${onScreen || '(blank)'}`,
      ].join(' — ');
      results.push({
        id: feature.id,
        name: feature.name,
        area: feature.area,
        verdict: feature.verdict,
        status: 'FAILING',
        detail,
      });
    }
  }
} catch (error) {
  infrastructureError = errorText(error);
  // A score is only meaningful if every assertion had a working desktop app.
  // Do not turn a dead harness into dozens of fictional feature failures.
  results.length = 0;
} finally {
  const built = results.filter((result) => result.status === 'BUILT').length;
  const report = {
    generatedAt: new Date().toISOString(),
    source: 'design/01-wealthbox-feature-matrix.md',
    totalFeatures: runFeatures.length,
    skippedFeatures: featureFilter ? 0 : SKIPPED_FEATURES.length,
    verified: infrastructureError ? null : built,
    results,
    skipped: featureFilter ? [] : SKIPPED_FEATURES,
    infrastructureError: infrastructureError ?? null,
  };
  if (!preflight) {
    mkdirSync(resolve(root, 'tests/parity'), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (infrastructureError) {
    if (preflight) console.error(`❌ ${currentPreflightCheck}: failed`);
    console.error(`INFRASTRUCTURE ERROR: ${infrastructureError}`);
    if (preflight) console.error('PREFLIGHT: RED — zero features scored.');
  } else if (!preflight) {
    printScoreboard(results);
  }
  try {
    await http('/eval', { js: 'window.close(); true' });
  } catch {
    /* app never reached a closable window */
  }
  stop(desktop);
  stop(vite);
  stop(wbsim);
  await Promise.all(
    [desktop, vite, wbsim]
      .filter((child): child is ChildProcess => Boolean(child))
      .map((child) => waitForExit(child, 15_000).catch(() => undefined))
  );
  if (viteLeaseHeld) releaseViteLease();
  rmSync(workspaceRoot, { recursive: true, force: true });
}

process.exitCode =
  results.some((result) => result.status === 'FAILING') || infrastructureError
    ? 1
    : 0;

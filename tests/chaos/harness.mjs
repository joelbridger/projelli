import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

export class RealApp {
  constructor(root, label) {
    this.root = root;
    this.label = label;
    this.workspace = null;
    this.port = null;
    this.child = null;
  }

  async start({ workspace = this.workspace, port = this.port } = {}) {
    this.workspace = workspace ?? await mkdtemp(path.join(tmpdir(), `lantern-chaos-${this.label}-`));
    this.port = port ?? await reservePort();
    const launcher = path.join(this.root, 'scripts/crm-loop/launch-app.sh');
    this.child = spawn('bash', [launcher, String(this.port), this.workspace], {
      cwd: this.root,
      env: { ...process.env, LANTERN_DEV_BRIDGE_PORT: String(this.port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await this.waitForBridge();
    return this;
  }

  async waitForBridge(timeout = 20_000) {
    const until = Date.now() + timeout;
    let last = 'not started';
    while (Date.now() < until) {
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/health`);
        if (response.ok) return;
        last = `health returned ${response.status}`;
      } catch (error) { last = error instanceof Error ? error.message : String(error); }
      await pause(100);
    }
    throw new Error(`desktop bridge did not start: ${last}`);
  }

  async request(route, params = {}) {
    const url = new URL(`http://127.0.0.1:${this.port}${route}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const response = await fetch(url);
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.error || `${route} failed (${response.status})`);
    return body.result;
  }

  eval(source) { return this.request('/eval', { js: source }); }
  click(testid) { return this.request('/click', { testid }); }
  fill(testid, text) { return this.request('/fill', { testid, text }); }

  async bootCrmHome() {
    const workspace = JSON.stringify(this.workspace);
    await this.eval(`(async () => {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (!invoke) throw new Error('Tauri invoke is unavailable');
      await invoke('crm_set_workspace', { path: ${workspace} });
      const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
      useWorkspaceStore.getState().setRootPath(${workspace});
      // This dispatch is the same navigation event the shell uses.  It keeps
      // the operation under test in the mounted, real desktop UI.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
      return true;
    })()`);
    await this.waitForTestid('crm-home', 4_000);
  }

  async waitForTestid(testid, timeout = 10_000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      try {
        if (await this.eval(`Boolean(document.querySelector('[data-testid=${JSON.stringify(testid)}]'))`)) return;
      } catch { /* app may be restarting */ }
      await pause(80);
    }
    throw new Error(`timed out waiting for ${testid}`);
  }

  async records() {
    return await this.eval(`window.__TAURI_INTERNALS__.invoke('crm_live_list')`);
  }

  async kill() {
    if (!this.child || this.child.exitCode !== null) return;
    this.child.kill('SIGKILL');
    // A broken GUI shutdown must not hang the test process forever. SIGKILL is
    // intentionally final; after a short grace period we continue teardown.
    await Promise.race([
      new Promise((resolve) => this.child.once('exit', resolve)),
      pause(2_000),
    ]);
  }

  async relaunch() {
    await this.kill();
    return await this.start({ workspace: this.workspace, port: this.port });
  }

  async close({ removeWorkspace = true } = {}) {
    await this.kill();
    if (removeWorkspace && this.workspace) await rm(this.workspace, { recursive: true, force: true });
  }
}

export function dataloss(message) {
  const error = new Error(`DATALOSS: ${message}`);
  error.dataloss = true;
  return error;
}

export function assert(condition, message) {
  if (!condition) throw dataloss(message);
}

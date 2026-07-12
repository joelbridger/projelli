import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
    this.appPidFile = null;
  }

  async start({ workspace = this.workspace, port = this.port } = {}) {
    this.workspace = workspace ?? await mkdtemp(path.join(tmpdir(), `lantern-chaos-${this.label}-`));
    this.port = port ?? await reservePort();
    this.appPidFile = path.join(this.workspace, '.chaos-app.pid');
    await rm(this.appPidFile, { force: true });
    const launcher = path.join(this.root, 'scripts/crm-loop/launch-app.sh');
    this.child = spawn('bash', [launcher, String(this.port), this.workspace], {
      cwd: this.root,
      env: {
        ...process.env,
        LANTERN_DEV_BRIDGE_PORT: String(this.port),
        // A fresh CRM screen can legitimately be busy opening its encrypted
        // workspace.  The bridge's normal five-second UI-eval budget is too
        // short for that first real disk open and would mislabel a slow read
        // as lost data.
        LANTERN_DEV_BRIDGE_TIMEOUT_MS: '30000',
        LANTERN_APP_PID_FILE: this.appPidFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await this.waitForBridge();
    await this.openMountedCrmScreen();
    return this;
  }

  async openMountedCrmScreen() {
    // Test mode bypasses the native folder-picker welcome screen only.  It
    // does not mock the desktop shell or CRM commands; bootCrmHome below
    // immediately replaces test mode's placeholder root with this case's
    // fresh on-disk workspace before reading or writing CRM data.
    await this.eval(`window.location.replace('/?testMode=true')`);
    await this.waitForTestid('crm-home', 20_000);
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
    // `launch-app.sh` starts Lantern in the background.  A shell-only kill
    // leaves the actual application alive, which would turn a supposed power
    // cut into an uninterrupted save.  The launcher publishes its child PID
    // solely for this test harness, so SIGKILL targets Lantern itself.
    try {
      const pid = Number.parseInt(await readFile(this.appPidFile, 'utf8'), 10);
      if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('launcher did not publish the desktop app PID');
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
        // It was already gone: this is still a hard-stop result.
      } else {
        throw error;
      }
    }
    // Let the launcher clean up its private virtual display.  If its shell is
    // wedged, stop only that wrapper after the short grace period.
    this.child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => this.child.once('exit', resolve)),
      pause(2_000),
    ]);
    if (this.child.exitCode === null) this.child.kill('SIGKILL');
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

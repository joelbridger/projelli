// scripts/bench-smoke/driver.mjs — high-level bench actions used by checks.
// Thin orchestration over remote.mjs (SSH exec) + parse.mjs (stdout parsing)
// + console-watch.mjs (console-error capture via the existing `eval` command).
// No CDP/Playwright code lives here or anywhere in this harness — every
// action is a subprocess call to the real, unmodified scripts/desktop-drive.mjs
// running on the bench.
import path from 'node:path';
import fs from 'node:fs';
import { runDesktopDrive, downloadFile, fetchFileTail, probeReachable } from './remote.mjs';
import { parseSnapshot, parsePages, parseEvalResult } from './parse.mjs';
import { installScript, readAndClearScript, interpretConsoleErrors } from './console-watch.mjs';
import { clickByTextScript } from './click-by-text.mjs';
import { dismissOverlayScript } from './overlay-dismiss.mjs';

export class DriverError extends Error {}

const DEFAULT_APP_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173'];

export function originOf(rawUrl) {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

export function buildOriginProbeScript(appOrigins = DEFAULT_APP_ORIGINS) {
  return `((async () => {
    const urls = ${JSON.stringify(appOrigins)};
    return Promise.all(urls.map(async (url) => {
      const origin = new URL(url).origin;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        const text = await res.text();
        return { url, origin, ok: res.ok, status: res.status, length: text.length };
      } catch (err) {
        return { url, origin, ok: false, error: String(err && err.message ? err.message : err) };
      }
    }));
  })())`;
}

export function selectSameOriginProbe(webviewUrl, probes) {
  const webviewOrigin = originOf(webviewUrl);
  const all = Array.isArray(probes) ? probes : [];
  const same = all.find((probe) => probe?.ok && probe.origin === webviewOrigin);
  const otherReachable = all.filter((probe) => probe?.ok && probe.origin !== webviewOrigin);
  return { webviewUrl, webviewOrigin, same, otherReachable, probes: all };
}

export function formatOriginProbeFailure(result) {
  const rows = result.probes
    .map((probe) => `${probe.url} -> ${probe.ok ? `OK ${probe.status}` : `BLOCKED ${probe.error || 'unknown error'}`}`)
    .join('; ');
  return (
    'Origin preflight failed: the bench fetch probe and the WebView app are not on the same origin. ' +
    `WebView URL=${result.webviewUrl}; WebView origin=${result.webviewOrigin || 'unreadable'}; probes=[${rows}]. ` +
    'This is a bench wiring problem, not proof of stale bundled code.'
  );
}

export class Driver {
  constructor(target, { evidenceDir } = {}) {
    this.target = target;
    this.evidenceDir = evidenceDir ?? null;
    this._shotCounter = 0;
  }

  async isReachable() {
    return probeReachable(this.target);
  }

  async snapshot() {
    const { code, stdout, stderr } = await runDesktopDrive(this.target, ['snapshot']);
    if (code !== 0) throw new DriverError(`snapshot failed (exit ${code}): ${stderr || stdout}`);
    return parseSnapshot(stdout);
  }

  async pages() {
    const { code, stdout, stderr } = await runDesktopDrive(this.target, ['pages']);
    if (code !== 0) throw new DriverError(`pages failed (exit ${code}): ${stderr || stdout}`);
    return parsePages(stdout);
  }

  async currentUrl() {
    const { code, stdout, stderr } = await runDesktopDrive(this.target, ['url']);
    if (code !== 0) throw new DriverError(`url failed (exit ${code}): ${stderr || stdout}`);
    return stdout.trim();
  }

  async assertSameOrigin() {
    const webviewUrl = await this.currentUrl();
    const probes = await this.evalJs(buildOriginProbeScript(this.target.appOrigins ?? DEFAULT_APP_ORIGINS));
    const result = selectSameOriginProbe(webviewUrl, probes);
    if (!result.same) throw new DriverError(formatOriginProbeFailure(result));
    return {
      webviewUrl,
      webviewOrigin: result.webviewOrigin,
      fetchUrl: result.same.url,
      fetchOrigin: result.same.origin,
      probes: result.probes,
    };
  }

  async click(testid) {
    const { code, stdout, stderr } = await runDesktopDrive(this.target, ['click', testid]);
    if (code !== 0) throw new DriverError(`click(${testid}) failed (exit ${code}): ${stderr || stdout}`);
    return stdout.trim();
  }

  /** Click an element that was matched by visible text (no data-testid),
   * via the existing `eval` command rather than desktop-drive.mjs's `click`
   * (which only accepts a data-testid). Throws DriverError if nothing
   * matched — never silently no-ops. */
  async clickByText(needle) {
    const result = await this.evalJs(clickByTextScript(needle));
    if (result !== 'clicked') {
      throw new DriverError(`clickByText("${needle}") found no matching element to click`);
    }
    return result;
  }

  /** Same as clickByText, but dispatches a dblclick — needed for file-tree
   * rows, which (confirmed live) open on double-click, not a single click. */
  async doubleClickByText(needle) {
    const result = await this.evalJs(clickByTextScript(needle, { double: true }));
    if (result !== 'clicked') {
      throw new DriverError(`doubleClickByText("${needle}") found no matching element to click`);
    }
    return result;
  }

  async type(testid, text, { submit = false } = {}) {
    const args = ['type-stdin', testid];
    if (submit) args.push('--submit');
    const { code, stdout, stderr } = await runDesktopDrive(this.target, args, { stdinText: text });
    if (code !== 0) throw new DriverError(`type(${testid}) failed (exit ${code}): ${stderr || stdout}`);
    return stdout.trim();
  }

  async evalJs(js) {
    const encoded = Buffer.from(js, 'utf8').toString('base64');
    const { code, stdout, stderr } = await runDesktopDrive(this.target, ['eval', `eval(atob(\`${encoded}\`))`]);
    if (code !== 0) throw new DriverError(`eval failed (exit ${code}): ${stderr || stdout}`);
    return parseEvalResult(stdout);
  }

  /** Explicit-wait helper — NEVER sleep-and-hope; desktop-drive.mjs's waitfor
   * polls Playwright's own auto-waiting getByText(...).waitFor(). Resolves
   * {found:true} or {found:false, error} rather than throwing, since "the
   * text never appeared" is a normal, checkable outcome for a smoke check. */
  async waitFor(text, seconds = 15) {
    const { code, stdout, stderr } = await runDesktopDrive(this.target, ['waitfor', text, String(seconds)]);
    if (code !== 0) return { found: false, error: stderr || stdout };
    return { found: true, detail: stdout.trim() };
  }

  async localOnlyEgressWalk() {
    const { code, stdout, stderr } = await runDesktopDrive(this.target, ['local-only-egress-walk']);
    if (code !== 0) throw new DriverError(`local-only egress walk failed (exit ${code}): ${stderr || stdout}`);
    try {
      return JSON.parse(stdout);
    } catch (err) {
      throw new DriverError(`local-only egress walk returned unreadable JSON: ${err.message}; raw=${stdout}`);
    }
  }

  /** Best-effort: close any modal/overlay left open from a prior session
   * before checks start (a stale dialog's backdrop otherwise intercepts every
   * click meant for the app underneath it). Never throws — a failed dismiss
   * just means "nothing to dismiss" or "eval briefly unavailable," neither of
   * which should abort the whole run. */
  async dismissBlockingOverlay() {
    try {
      return await this.evalJs(dismissOverlayScript());
    } catch {
      return { before: 0, after: 0 };
    }
  }

  async installConsoleWatch() {
    await this.evalJs(installScript());
  }

  async readConsoleErrors() {
    const raw = await this.evalJs(readAndClearScript());
    return interpretConsoleErrors(raw);
  }

  /** Screenshot on the bench (native path under repoDir\bench-smoke-tmp), then
   * scp it down into the local evidence dir. Returns the local path (relative
   * to evidenceDir) on success, or throws DriverError. */
  async captureScreenshot(name) {
    if (!this.evidenceDir) throw new DriverError('captureScreenshot requires evidenceDir to be set');
    this._shotCounter += 1;
    const fileName = `${String(this._shotCounter).padStart(2, '0')}-${name}.jpeg`;
    const remotePath = `${this.target.repoDir}\\bench-smoke-tmp\\${fileName}`;
    const localPath = path.join(this.evidenceDir, fileName);

    const shot = await runDesktopDrive(this.target, ['screenshot', remotePath]);
    if (shot.code !== 0) throw new DriverError(`screenshot failed (exit ${shot.code}): ${shot.stderr || shot.stdout}`);

    const dl = await downloadFile(this.target, remotePath, localPath);
    if (dl.code !== 0) throw new DriverError(`scp of screenshot failed (exit ${dl.code}): ${dl.stderr || dl.stdout}`);

    return fileName;
  }

  async captureAppLogTail(name, { lineCount = 200 } = {}) {
    if (!this.evidenceDir) throw new DriverError('captureAppLogTail requires evidenceDir to be set');
    const safeName = String(name).replace(/[^a-zA-Z0-9._-]+/g, '-');
    const fileName = `${safeName}.txt`;
    const localPath = path.join(this.evidenceDir, fileName);
    const remotePath = this.target.appLogPath ?? 'C:\\tauri-dev.log';

    const tail = await fetchFileTail(this.target, remotePath, lineCount);
    if (tail.code !== 0) throw new DriverError(`log tail failed (exit ${tail.code}): ${tail.stderr || tail.stdout}`);

    fs.writeFileSync(localPath, tail.stdout || '(log tail was empty)\n', 'utf8');
    return fileName;
  }
}

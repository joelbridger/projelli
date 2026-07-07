/**
 * webdriver.mjs — a tiny, zero-dependency W3C WebDriver client for driving the
 * REAL Lantern Tauri desktop app through `tauri-driver`.
 *
 * This is the proven mechanism from the harness probe
 * (docs/quality/2026-06-18-user-test/harness-probe/driver.mjs), generalized into
 * a reusable library so each test spec can drive the real Rust-backed app by
 * `data-testid` without pulling in WebdriverIO/Selenium.
 *
 * A `Session` is one launched app instance. `tauri-driver` launches the binary
 * on `newSession()` and kills it on `close()`. Create one Session per spec for
 * isolation.
 */

import fs from 'node:fs';
import path from 'node:path';

const W3C_ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

export class Session {
  /**
   * @param {object} opts
   * @param {string} opts.app         absolute path to the Tauri app binary
   * @param {number} opts.driverPort  tauri-driver intermediary port
   * @param {(msg:string)=>void} [opts.log]
   */
  constructor({ app, driverPort, log = () => {} }) {
    this.app = app;
    this.base = `http://127.0.0.1:${driverPort}`;
    this.log = log;
    this.sessionId = null;
  }

  async #request(method, route, body, allowError = false) {
    const res = await fetch(this.base + route, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const raw = await res.text();
    let json;
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`${method} ${route} non-JSON ${res.status}: ${raw.slice(0, 500)}`);
    }
    if (
      !allowError &&
      (!res.ok || (json.value && typeof json.value === 'object' && json.value.error))
    ) {
      throw new Error(`${method} ${route} failed ${res.status}: ${JSON.stringify(json).slice(0, 1400)}`);
    }
    return json;
  }

  /** Launch the app + open a WebDriver session. */
  async newSession() {
    const res = await this.#request('POST', '/session', {
      capabilities: { alwaysMatch: { 'tauri:options': { application: this.app, args: [] } } },
    });
    this.sessionId = res.sessionId || res.value?.sessionId;
    if (!this.sessionId) throw new Error(`No session id: ${JSON.stringify(res)}`);
    return this.sessionId;
  }

  /** Kill the app + end the session (best-effort). */
  async close() {
    if (!this.sessionId) return;
    await this.#request('DELETE', `/session/${this.sessionId}`, {}, true).catch(() => {});
    this.sessionId = null;
  }

  #elementId(resp) {
    const v = resp.value;
    return v[W3C_ELEMENT] || v.ELEMENT;
  }

  /** Find one element, polling until found or timeout. `using`: 'css selector' | 'xpath'. */
  async find(using, value, timeoutMs = 30_000) {
    const started = Date.now();
    let lastErr;
    while (Date.now() - started < timeoutMs) {
      try {
        return this.#elementId(
          await this.#request('POST', `/session/${this.sessionId}/element`, { using, value }),
        );
      } catch (e) {
        lastErr = e;
        await sleep(400);
      }
    }
    throw new Error(`Element not found after ${timeoutMs}ms: ${using}=${value}. Last: ${lastErr?.message}`);
  }

  /** Convenience: find by data-testid. */
  testid(id, timeoutMs) {
    return this.find('css selector', `[data-testid="${id}"]`, timeoutMs);
  }

  /** True if the testid is present within the (short) timeout; never throws. */
  async hasTestid(id, timeoutMs = 2_000) {
    try {
      await this.testid(id, timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  async click(element) {
    await this.#request('POST', `/session/${this.sessionId}/element/${element}/click`, {});
  }

  /** Find by testid + click. */
  async clickTestid(id, timeoutMs) {
    await this.click(await this.testid(id, timeoutMs));
  }

  /** Click a testid if it appears quickly; returns whether it clicked. */
  async maybeClickTestid(id, timeoutMs = 2_000) {
    if (await this.hasTestid(id, timeoutMs)) {
      await this.clickTestid(id, 1_000);
      return true;
    }
    return false;
  }

  async type(element, text) {
    await this.#request('POST', `/session/${this.sessionId}/element/${element}/value`, {
      text: String(text),
    });
  }

  async typeTestid(id, text, timeoutMs) {
    await this.type(await this.testid(id, timeoutMs), text);
  }

  async clear(element) {
    await this.#request('POST', `/session/${this.sessionId}/element/${element}/clear`, {});
  }

  async text(element) {
    return (await this.#request('GET', `/session/${this.sessionId}/element/${element}/text`)).value;
  }

  /** Run JS in the page. `script` uses arguments[0..]; returns the value. */
  async execute(script, args = []) {
    return (await this.#request('POST', `/session/${this.sessionId}/execute/sync`, { script, args })).value;
  }

  async refresh() {
    await this.#request('POST', `/session/${this.sessionId}/refresh`, {});
  }

  /** Full visible body text — handy for coarse assertions. */
  bodyText() {
    return this.execute('return document.body.innerText;');
  }

  /** Wait until `fn(session)` returns truthy, or throw after timeout. */
  async waitFor(fn, { timeoutMs = 20_000, intervalMs = 400, label = 'condition' } = {}) {
    const started = Date.now();
    let lastErr;
    while (Date.now() - started < timeoutMs) {
      try {
        const r = await fn(this);
        if (r) return r;
      } catch (e) {
        lastErr = e;
      }
      await sleep(intervalMs);
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}. Last: ${lastErr?.message ?? 'falsy'}`);
  }

  /** Wait until the page body contains `needle`. */
  waitForBodyText(needle, opts = {}) {
    return this.waitFor(
      async (s) => (await s.bodyText()).includes(needle),
      { label: `body text "${needle}"`, ...opts },
    );
  }

  async screenshot(file) {
    const res = await this.#request('GET', `/session/${this.sessionId}/screenshot`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(res.value, 'base64'));
    return file;
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * DemoEngine — the Node-side high-level API a flow script uses to "act like a
 * real user" against the live app while a smooth cursor + captions are drawn
 * on screen (see engine/overlay.js for the in-page half).
 *
 * A flow calls engine methods; each one:
 *   1. glides the drawn cursor to the target with eased motion,
 *   2. shows a press + ripple,
 *   3. fires the REAL Playwright interaction at the same coordinates.
 *
 * So the recording shows a believable pointer, and the app really responds.
 */

const DEFAULT_MOVE_MS = 720;

export class DemoEngine {
  /** @param {import('playwright').Page} page */
  constructor(page, { baseURL = 'http://localhost:5173' } = {}) {
    this.page = page;
    this.baseURL = baseURL;
    this._debug = !!process.env.DEMO_DEBUG;
  }

  async _timed(label, fn) {
    if (!this._debug) return fn();
    const t = Date.now();
    try {
      return await fn();
    } finally {
      const ms = Date.now() - t;
      if (ms > 600) console.log(`    [${label}] ${ms}ms`);
    }
  }

  // ---- lifecycle -------------------------------------------------------

  async goto(pathOrUrl) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.baseURL}${pathOrUrl}`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this._ready();
  }

  async _ready() {
    await this.page.waitForFunction(() => !!(window.__demo && window.__demo.__installed), null, {
      timeout: 15000,
    });
  }

  // ---- narration -------------------------------------------------------

  /**
   * Show a caption beside its active target, then hold so it can be read.
   * A target in the lower 40% of the frame sends the pill to top-center;
   * everything else uses bottom-center. If a beat has no target, use the
   * cursor's current destination instead.
   */
  async caption(text, holdMs = 1400, { target } = {}) {
    await this._ready();
    const position = await this._captionPosition(target);
    await this.page.evaluate(
      ({ text: captionText, position: captionPosition }) =>
        window.__demo.showCaption(captionText, captionPosition),
      { text, position },
    );
    await this.hold(holdMs);
  }

  async clearCaption() {
    await this.page.evaluate(() => window.__demo.hideCaption());
    await this.hold(260);
  }

  async hold(ms) {
    await this.page.waitForTimeout(ms);
  }

  // ---- targeting -------------------------------------------------------

  testId(id) {
    return this.page.getByTestId(id);
  }

  async _center(locator) {
    return this._timed('center', async () => {
      // Keep these short: a target that is not ready fast is skipped by the
      // caller (.catch) rather than freezing the recording with dead air.
      await locator.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
      await locator.waitFor({ state: 'visible', timeout: 3000 });
      const box = await locator.boundingBox();
      if (!box) throw new Error('target has no bounding box (not visible?)');
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
  }

  async _captionPosition(target) {
    let y;
    if (target) {
      // Do not scroll a page just to place narration: the target should
      // already be visible for the beat it describes. Falling back to the
      // cursor keeps an introductory caption useful if a target is late.
      const box = await target.boundingBox().catch(() => null);
      if (box) y = box.y + box.height / 2;
    }
    if (typeof y !== 'number') {
      y = await this.page.evaluate(() => window.__demo.pos().y);
    }
    const height = await this.page.evaluate(() => window.innerHeight);
    return y >= height * 0.6 ? 'top' : 'bottom';
  }

  // ---- motion ----------------------------------------------------------

  /** Glide the drawn cursor to a locator's centre (no click). */
  async moveTo(locator, { duration = DEFAULT_MOVE_MS } = {}) {
    const { x, y } = await this._center(locator);
    await this.page.evaluate(
      ({ x, y, d }) => window.__demo.moveTo(x, y, d),
      { x, y, d: duration },
    );
    return { x, y };
  }

  async moveToTestId(id, opts) {
    return this.moveTo(this.testId(id), opts);
  }

  /** Glide to a locator, show the press + ripple, then really click it. */
  async click(locator, { duration = DEFAULT_MOVE_MS, settle = 260 } = {}) {
    await this.moveTo(locator, { duration });
    await this.hold(settle);
    await this.page.evaluate(async () => {
      await window.__demo.press();
      window.__demo.ripple();
    });
    // Real interaction at the same spot. force:false keeps actionability checks.
    const t = Date.now();
    try {
      await locator.click();
      if (this._debug && Date.now() - t > 600) console.log(`    [click ok] ${Date.now() - t}ms`);
    } catch (e) {
      if (this._debug) console.log(`    [click failed after ${Date.now() - t}ms] ${e.message.split('\n')[0]}`);
    }
    await this.hold(200);
  }

  async clickTestId(id, opts) {
    await this.click(this.testId(id), opts);
  }

  /** Click a field, then type into it at a human cadence. */
  async type(locator, text, { duration = DEFAULT_MOVE_MS, perChar = 42 } = {}) {
    await this.click(locator, { duration });
    await locator.pressSequentially(text, { delay: perChar });
    await this.hold(300);
  }

  async typeInTestId(id, text, opts) {
    await this.type(this.testId(id), text, opts);
  }

  /** Wait until a locator is visible (no cursor motion). */
  async waitFor(locator, { timeout = 20000 } = {}) {
    await this._timed('waitFor', () => locator.waitFor({ state: 'visible', timeout }));
  }

  async waitForTestId(id, opts) {
    await this.waitFor(this.testId(id), opts);
  }
}

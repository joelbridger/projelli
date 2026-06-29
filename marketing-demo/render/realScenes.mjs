/*
 * marketing-demo/render/realScenes.mjs
 * DEMO-ONLY. Drives the REAL Keepance app for the two payoff scenes:
 *   - installDeterminism: seeds the Webb matter + filled Client Map into
 *     localStorage before load, and intercepts the demo AI endpoint so nothing
 *     depends on a live key/proxy.
 *   - sceneClientMap (Scene 5): opens the Webb Household hub and reveals the
 *     real, fully-populated, source-cited Client Map.
 *   - sceneAsk (Scene 6): the Ask Q&A — built as a faithful in-page replica of
 *     the real Ask UI (see askScene.mjs) because the real Ask pipeline cannot
 *     produce a live-typed, Webb-specific, verified-citation answer in-browser
 *     without product-code changes.
 */
import { mattersEnvelope, clientMapsEnvelope, MATTER_ID } from '../data/webbSeed.mjs';
import { runAskScene } from './askScene.mjs';

const ev = (page, fn, ...args) => page.evaluate(fn, ...args);

export async function installDeterminism(context, page) {
  // Seed BEFORE any app code runs: the Webb matter + filled Client Map, and a
  // (fake) Anthropic key in the keychain mirror so the trust badge reads
  // "connected" — matching the narrative that the advisor connected AI in
  // scene 3. No real key, no real call: the AI scenes are scripted/replica.
  await context.addInitScript(
    ({ matters, clientMaps }) => {
      try {
        localStorage.setItem('keepance:matters', JSON.stringify(matters));
        localStorage.setItem('keepance:client-maps', JSON.stringify(clientMaps));
        // KeychainService browser backend: secret under bos_key_<provider> (b64),
        // metadata under bos_key_metadata; default provider for the egress badge.
        localStorage.setItem('bos_key_anthropic', btoa('sk-ant-api03-demo-not-a-real-key'));
        localStorage.setItem('bos_key_metadata', JSON.stringify([
          { provider: 'anthropic', keyPrefix: 'sk-ant-a', addedAt: '2026-06-28T12:00:00.000Z' },
        ]));
        localStorage.setItem('keepance_default_provider', 'anthropic');
      } catch (e) { console.warn('[demo-seed] failed', e); }
    },
    { matters: mattersEnvelope, clientMaps: clientMapsEnvelope },
  );

  // Stub the demo AI endpoint (used only if the chat sidebar is ever driven).
  await context.route('**/api/demo-chat', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, text: 'Connected. (Scripted demo response.)', model: 'claude-sonnet-4-6', usage: { input_tokens: 900, output_tokens: 200 } }),
    }),
  );

  // Stub any real provider calls the fake key might trigger (model list fetch),
  // so the render never reaches out to api.anthropic.com.
  await context.route(/api\.anthropic\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'claude-sonnet-4-6' }] }) }),
  );
}

// =====================================================================
// SCENE 5 — The Client Map appears (the aha) — REAL app + REAL store
// =====================================================================
export async function sceneClientMap(page) {
  // Make sure we're on the Client Map (matters) surface.
  await page.click('[data-testid="spine-nav-matters"]').catch(() => {});
  await page.waitForTimeout(500);

  // Open the Webb Household hub (the row that the seed created).
  const rowSel = `[data-testid="matter-row-${MATTER_ID}"]`;
  const haveRow = await page.locator(rowSel).count().catch(() => 0);
  if (haveRow) {
    // animate cursor to the row and click it
    await ev(page, async (sel) => {
      await window.__kp.cursorOn();
      await window.__kp.moveToEl(sel, 820);
      await window.__kp.click();
    }, rowSel);
    await page.click(rowSel).catch(() => {});
  } else {
    console.warn('[scene5] matter row not found:', rowSel);
  }

  // wait for the real Client Map panel
  await page.waitForSelector('[data-testid="clientmap-panel"]', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);

  await ev(page, async () => { await window.__kp.showCaption('One client. Every detail in one place, with sources.'); });
  await page.waitForTimeout(1700);
  await ev(page, async () => { await window.__kp.hideCaption(); });

  // glance at Key people
  await clickTab(page, 'people');
  await page.waitForTimeout(1050);

  // open Where things stand and scroll to the dramatic beat: the stale beneficiary
  await clickTab(page, 'standing');
  await page.waitForTimeout(750);
  await ev(page, async () => {
    // find the beneficiary item (last item in the standing section) and bring it
    // into view by scrolling its nearest scrollable ancestor.
    const items = document.querySelectorAll('[data-testid="clientmap-section-standing"] [data-testid="clientmap-item"], [data-testid="clientmap-item"]');
    const target = items[items.length - 1];
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  await page.waitForTimeout(900);
  await ev(page, async () => { await window.__kp.showCaption('It even flags a stale beneficiary on an old 401(k).'); });
  await page.waitForTimeout(2200);
  await ev(page, async () => { await window.__kp.hideCaption(); });

  // hover a source citation chip to show the answer is source-backed
  const chip = '[data-testid="clientmap-source-link"]';
  const haveChip = await page.locator(chip).first().count().catch(() => 0);
  if (haveChip) {
    await ev(page, async (s) => {
      const el = document.querySelector(s);
      if (el) { await window.__kp.moveToEl(s, 700); }
    }, chip);
    await page.locator(chip).first().hover().catch(() => {});
    await ev(page, async () => { await window.__kp.showCaption('Every line traces back to a real document.'); });
    await page.waitForTimeout(1700);
    await ev(page, async () => { await window.__kp.hideCaption(); });
  }
  await page.waitForTimeout(400);
}

async function clickTab(page, key) {
  const sel = `[data-testid="clientmap-tab-${key}"]`;
  const ok = await page.locator(sel).count().catch(() => 0);
  if (!ok) return;
  await ev(page, async (s) => {
    await window.__kp.moveToEl(s, 700);
    await window.__kp.click();
  }, sel);
  await page.click(sel).catch(() => {});
}

// =====================================================================
// SCENE 6 — Ask (faithful replica overlay; see askScene.mjs)
// =====================================================================
export async function sceneAsk(page) {
  await runAskScene(page);
}

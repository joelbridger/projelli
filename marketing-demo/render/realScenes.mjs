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
import { mattersEnvelope, clientMapsEnvelope, MATTER_ID, DEMO_CLIENT_NAMES } from '../data/webbSeed.mjs';
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
  // ---------------------------------------------------------------------------
  // v3 app-arrival: land straight on the Webb map + stream the book of business
  // ---------------------------------------------------------------------------
  // 1) Open the Webb hub BEHIND the navy cover that onboarding left up, so the
  //    first app surface the viewer sees is the filled, cited Webb Client Map —
  //    never the all-clients table (change #2). The stage is pointer-events:none,
  //    so these real clicks reach the app through the cover.
  await page.click('[data-testid="spine-nav-matters"]').catch(() => {});
  await page.waitForTimeout(450);
  const rowSel = `[data-testid="matter-row-${MATTER_ID}"]`;
  if (await page.locator(rowSel).count().catch(() => 0)) {
    await page.click(rowSel).catch(() => {});
  } else {
    console.warn('[scene5] matter row not found:', rowSel);
  }
  await page.waitForSelector('[data-testid="clientmap-panel"]', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);

  // 2) "Book of business arriving" — done on the REAL app (no fake/placeholder
  //    map). The left sidebar (Spine) already lists every seeded client; while the
  //    navy is still up we HIDE those real rows, then stream them back in one-by-one
  //    over the real, already-open Webb Client Map. Nothing fake is ever shown.
  await ev(page, (names) => {
    const sb = document.querySelector('[data-testid="sidebar"]');
    const rows = sb
      ? [...sb.querySelectorAll('button')].filter((b) => names.some((n) => (b.textContent || '').includes(n)))
      : [];
    const st = document.createElement('style');
    st.id = 'kpd-client-pop';
    st.textContent =
      '.kpd-cli-row{transition:opacity .42s ease, transform .42s ease !important}' +
      '.kpd-cli-hidden{opacity:0 !important; transform:translateX(-16px) !important}';
    document.head.appendChild(st);
    rows.forEach((r) => r.classList.add('kpd-cli-row', 'kpd-cli-hidden'));
    window.__kpCliRows = rows;
  }, DEMO_CLIENT_NAMES);

  // 3) Lift the navy -> the real Webb Client Map + the real sidebar (rows hidden).
  await ev(page, async () => { await window.__kp.hideStage(560); });
  await page.waitForTimeout(220);
  await ev(page, async () => { await window.__kp.showCaption('Your whole book of business, arriving. Every client, kept private.'); });

  // 4) Stream the REAL sidebar client rows in one-by-one (Webb first).
  await ev(page, async () => {
    const rows = window.__kpCliRows || [];
    for (const r of rows) { r.classList.remove('kpd-cli-hidden'); await window.__kp.sleep(300); }
  });
  await page.waitForTimeout(850);
  await ev(page, async () => { await window.__kp.hideCaption(); });
  // tidy up the temporary populate styling (rows are now permanently visible)
  await ev(page, () => {
    document.getElementById('kpd-client-pop')?.remove();
    (window.__kpCliRows || []).forEach((r) => r.classList.remove('kpd-cli-row', 'kpd-cli-hidden'));
    window.__kpCliRows = null;
  });

  // 5) cursor on (parked over the map) for the guided tour beats below
  await ev(page, () => {
    window.__kp.setCursor(window.innerWidth * 0.42, window.innerHeight * 0.5);
    window.__kp.cursorOn();
  });
  await page.waitForTimeout(300);

  await ev(page, async () => { await window.__kp.showCaption('One client. Every detail in one place, with sources.'); });
  await page.waitForTimeout(1700);
  await ev(page, async () => { await window.__kp.hideCaption(); });

  // glance at Key people
  await clickTab(page, 'people');
  await page.waitForTimeout(1050);

  // open Where things stand and scroll to the dramatic beat: the stale beneficiary.
  await clickTab(page, 'standing');
  await page.waitForTimeout(750);
  // The standing list fills the viewport, so its last item (the stale beneficiary)
  // sits in the lower third — exactly where the now ~3x-bigger caption lives. Add a
  // temporary bottom spacer to the item's scroll container so we can CENTRE the
  // beneficiary and leave the lower third clear for the caption (removed after).
  await ev(page, async () => {
    const items = document.querySelectorAll('[data-testid="clientmap-section-standing"] [data-testid="clientmap-item"], [data-testid="clientmap-item"]');
    const target = items[items.length - 1];
    if (!target) return;
    let sc = target.parentElement;
    while (sc && sc !== document.body) {
      const oy = getComputedStyle(sc).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && sc.scrollHeight > sc.clientHeight + 4) break;
      sc = sc.parentElement;
    }
    if (sc && sc !== document.body && !document.getElementById('kpd-scroll-spacer')) {
      const sp = document.createElement('div');
      sp.id = 'kpd-scroll-spacer';
      sp.style.cssText = 'height:320px;flex:none;pointer-events:none';
      sc.appendChild(sp);
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  await page.waitForTimeout(950);
  await ev(page, async () => { await window.__kp.showCaption('It even flags a stale beneficiary on an old 401(k).'); });
  await page.waitForTimeout(2200);
  await ev(page, async () => { await window.__kp.hideCaption(); });

  // hover the beneficiary's OWN source chip (the last one — visible near centre now)
  // so the "source-backed" caption sits over clear space, not over the content.
  const chip = '[data-testid="clientmap-source-link"]';
  const haveChip = await page.locator(chip).last().count().catch(() => 0);
  if (haveChip) {
    await ev(page, async () => {
      const els = document.querySelectorAll('[data-testid="clientmap-source-link"]');
      const el = els[els.length - 1];
      if (el) {
        const r = el.getBoundingClientRect();
        await window.__kp.moveTo(r.left + r.width / 2, r.top + r.height / 2, 700);
      }
    });
    await page.locator(chip).last().hover().catch(() => {});
    await ev(page, async () => { await window.__kp.showCaption('Every line traces back to a real document.'); });
    await page.waitForTimeout(1700);
    await ev(page, async () => { await window.__kp.hideCaption(); });
  }
  // remove the temporary scroll spacer
  await ev(page, () => { document.getElementById('kpd-scroll-spacer')?.remove(); });
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

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

// The advisor's book of business for the "arriving" rail (Scene 5 lead-in).
// Webb leads (it's the hero whose real map we land on); the rest are plausible
// households so the rail reads like a real practice streaming in. DEMO-ONLY set
// dressing — only Webb is a real seeded matter with a Client Map.
const ARRIVAL_CLIENTS = [
  { name: 'Webb Household', webb: true },
  { name: 'Caldwell Family Trust' },
  { name: 'Okafor Household' },
  { name: 'Nguyen Household' },
  { name: 'Brennan Family' },
  { name: 'Salazar Household' },
  { name: 'Petrosyan Family' },
  { name: 'Whitfield Trust' },
];

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

  // 2) Build the "book of business arriving" overlay UNDER the navy (z 85000 <
  //    stage 90000), then lift the navy to reveal it over the already-open map.
  await ev(page, (clients) => {
    const PAL = ['#1f74c4', '#0a2540', '#16654a', '#b45309', '#7c3aed', '#be185d', '#0369a1', '#4d7c0f'];
    const initials = (n) => n.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const tick = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const shield = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    const rows = clients.map((c, i) => `
      <div class="kpd-arr-client${c.webb ? ' is-webb' : ''}">
        <div class="kpd-arr-av" style="background:${c.webb ? 'linear-gradient(135deg,#1f74c4,#5dc6ff)' : PAL[i % PAL.length]}">${initials(c.name)}</div>
        <div class="kpd-arr-meta">
          <div class="kpd-arr-name">${c.name}</div>
          <div class="kpd-arr-sub"><span class="kpd-arr-tick">${tick}</span>Imported &amp; private</div>
        </div>
      </div>`).join('');
    const L = '<div class="kpd-arr-line"></div>';
    const Lm = '<div class="kpd-arr-line m"></div>';
    const Ls = '<div class="kpd-arr-line s"></div>';
    const card = (title, body) => `<div class="kpd-arr-card"><div class="kpd-arr-ch">${title}</div>${body}</div>`;
    const wrap = document.createElement('div');
    wrap.id = 'kpd-arrival';
    wrap.innerHTML = `
      <div class="kpd-arr-top">
        <div class="kpd-arr-brand"><span class="kpd-arr-mark">${shield}</span>Keepance</div>
        <div class="kpd-arr-status"><span class="kpd-arr-dot"></span>Importing your book of business…</div>
      </div>
      <div class="kpd-arr-body">
        <div class="kpd-arr-rail">
          <div class="kpd-arr-rail-h">CLIENTS <span class="kpd-arr-count" id="kpd-arr-count">0</span></div>
          <div class="kpd-arr-list" id="kpd-arr-list">${rows}</div>
        </div>
        <div class="kpd-arr-main">
          <div class="kpd-arr-maptitle"><span class="kpd-arr-mav">WH</span>Webb Household</div>
          <div class="kpd-arr-mapsub">Building this client's map from everything you just connected…</div>
          <div class="kpd-arr-skel">
            ${card('Where things stand', Lm + L + Ls)}
            ${card('Key people', L + Ls)}
            ${card("What's coming", Lm + Ls)}
            ${card('Next actions', L + Lm)}
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
  }, ARRIVAL_CLIENTS);

  await ev(page, async () => { await window.__kp.hideStage(520); }); // navy out -> arrival visible
  await ev(page, () => { document.getElementById('kpd-arrival')?.classList.add('kpd-in'); });
  await page.waitForTimeout(220);
  await ev(page, async () => { await window.__kp.showCaption('Your whole book of business, arriving. Every client, kept private.'); });

  // 3) stream the clients into the left rail one-by-one (and assemble the map skeleton)
  await ev(page, async () => {
    const cards = [...document.querySelectorAll('#kpd-arr-list .kpd-arr-client')];
    const count = document.getElementById('kpd-arr-count');
    const skel = [...document.querySelectorAll('#kpd-arrival .kpd-arr-card')];
    for (let i = 0; i < cards.length; i++) {
      cards[i].classList.add('kpd-in');
      if (count) count.textContent = String(i + 1);
      if (i === 0) skel.forEach((c, ci) => setTimeout(() => c.classList.add('kpd-in'), 200 + ci * 170));
      await window.__kp.sleep(i === 0 ? 560 : 360);
    }
  });
  await page.waitForTimeout(850);
  await ev(page, async () => { await window.__kp.hideCaption(); });

  // 4) crossfade the arrival overlay out -> the real, already-open Webb map
  await ev(page, async () => {
    const a = document.getElementById('kpd-arrival');
    if (a) { a.classList.remove('kpd-in'); await window.__kp.sleep(560); a.remove(); }
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

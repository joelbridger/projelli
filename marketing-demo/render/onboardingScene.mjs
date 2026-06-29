/*
 * marketing-demo/render/onboardingScene.mjs
 * DEMO-ONLY. Scene 2 of the Keepance marketing film: the V2 "concise" 4-screen
 * onboarding (Jameson's simplified version), captured full-screen.
 *
 * Source of truth: docs/design/onboarding-prototype-v2-concise — a standalone,
 * vector-crisp, ANIMATED clickable HTML prototype (Lottie + GSAP, no React, no
 * app build). It is served by serve_nocache.py (regenerate.sh starts it) and
 * loaded here into a full-screen iframe layered just under the navy "stage"
 * cover (z 80000 < stage 90000), so it loads hidden. We then crossfade the navy
 * out to reveal it, advance the 4 screens by postMessage('kp-advance') to the
 * prototype shell (its index.html listens for that message), and pace each hold
 * so the Lottie step icons, the card-to-card flow, and the screen-4 progress
 * bars all read on camera. A navy wipe then hands off to Scene 5 (the real
 * Client Map).
 *
 * The 4 screens, in order:
 *   1. intro     — 3-card flowchart (Connect AI + files -> Keepance builds
 *                  Client Maps -> Ask anything, with sources) + security pills.
 *   2. power     — "Connect your AI": cloud (ChatGPT/Claude/Gemini) vs local AI.
 *   3. connect   — "Securely connect your data": OneDrive / Outlook / Wealthbox
 *                  (+ planned-connection logos).
 *   4. setup     — live setup: per-source progress bars filling, "Building your
 *                  Client Maps", a preview of questions, "Continue to the app".
 *
 * This REPLACES the old simulated welcome/connect-AI/connect-data modals AND the
 * earlier 8-chapter React journey cut. The cold open, the real Client Map, the
 * Ask scene, and the closing card are all kept unchanged.
 */

const ONBOARDING_URL = process.env.ONBOARDING_URL || 'http://localhost:8911/';

// advance the prototype shell to the next scene (it listens for this message)
async function advance(page) {
  await page.evaluate(() => {
    const f = document.getElementById('kpd-onboarding');
    if (f && f.contentWindow) f.contentWindow.postMessage('kp-advance', '*');
  });
}

// Screen 4's progress bars climb slowly by design (so the demo always reads as
// "in progress"). For the film, nudge them up a touch faster so the fill is
// clearly visible on camera. This only touches the rendered onboarding iframe at
// capture time; it never modifies the prototype source. Non-fatal if it can't
// find the frame (the prototype's own interval still climbs the bars).
async function fillScreen4Bars(page) {
  try {
    let frame = null;
    for (let i = 0; i < 24; i++) {
      frame = page.frames().find((f) => /scene-4\.html/.test(f.url()));
      if (frame) break;
      await page.waitForTimeout(150);
    }
    if (!frame) return;
    await frame.evaluate(async () => {
      const fills = [...document.querySelectorAll('.pfill')];
      const pcts = [...document.querySelectorAll('.ppct')];
      const caps = [97, 90, 88, 84]; // AI download climbs highest; imports trail
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let t = 0; t < 20; t++) {
        let moving = false;
        fills.forEach((f, i) => {
          const w = parseFloat(f.style.width) || 0;
          const cap = caps[i] ?? 90;
          if (w < cap) {
            moving = true;
            const nw = Math.min(cap, w + (i === 0 ? 2.4 : 1.7));
            f.style.width = nw + '%';
            if (pcts[i]) pcts[i].textContent = Math.round(nw) + '%';
          }
        });
        if (!moving) break;
        await sleep(230);
      }
    });
  } catch {
    /* non-fatal: bars still climb via the prototype's own interval */
  }
}

export async function sceneOnboarding(page) {
  // 1) Mount the onboarding prototype in a full-screen iframe BEHIND the navy
  //    stage cover left up by the cold open (z 80000 < stage 90000), so it loads
  //    hidden. The shell paints its own light gradient immediately (no white
  //    flash) while the first scene's content animates in.
  await page.evaluate((url) => {
    const f = document.createElement('iframe');
    f.id = 'kpd-onboarding';
    f.src = url;
    f.setAttribute('allow', 'autoplay');
    Object.assign(f.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%',
      border: '0', margin: '0', padding: '0', background: '#e9ebf2',
      zIndex: '80000',
    });
    document.body.appendChild(f);
  }, ONBOARDING_URL);

  // brief load beat, then crossfade the navy cold-open card out so the viewer
  // catches screen 1's cards + Lottie icons animating in (cursor stays off; the
  // onboarding has its own nav).
  await page.waitForTimeout(850);
  await page.evaluate(async () => { await window.__kp.cursorOff(); });
  await page.evaluate(async () => { await window.__kp.hideStage(700); });

  // --- Screen 1 · intro 3-card flowchart (animated Lottie step icons) ---
  await page.waitForTimeout(4400);

  // --- Screen 2 · Connect your AI: cloud (ChatGPT/Claude/Gemini) vs local ---
  await advance(page);
  await page.waitForTimeout(5100);

  // --- Screen 3 · Securely connect your data: OneDrive / Outlook / Wealthbox ---
  await advance(page);
  await page.waitForTimeout(5100);

  // --- Screen 4 · live setup: progress bars fill + Building your Client Maps ---
  await advance(page);
  await page.waitForTimeout(1200);   // let the panel animate in
  await fillScreen4Bars(page);       // ~4.6s of visible filling
  await page.waitForTimeout(1300);   // hold on the finished-ish setup + ask chips

  // 2) Hand off to Scene 5: raise navy over the onboarding, remove the iframe,
  //    then fade the navy out to reveal the real app (Client Map surface).
  await page.evaluate(async () => {
    const navy = '<div class="kpd-scene"><div class="kpd-fullcard"><div class="kpd-grain"></div></div></div>';
    await window.__kp.showStage(navy, 520);
  });
  await page.evaluate(() => { document.getElementById('kpd-onboarding')?.remove(); });
  await page.waitForTimeout(180);
  await page.evaluate(async () => { await window.__kp.hideStage(560); });
}

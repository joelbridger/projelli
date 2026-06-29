/*
 * marketing-demo/render/onboardingScene.mjs
 * DEMO-ONLY. Scene 2 of the Keepance marketing film: the V2 "concise" 4-screen
 * onboarding (Jameson's simplified version), captured full-screen — now driven
 * by the SAME animated cursor used in the app scenes, so it reads like a real
 * user clicking through setup (Jameson's v3 feedback).
 *
 * Source of truth: docs/design/onboarding-prototype-v2-concise — a standalone,
 * vector-crisp, ANIMATED clickable HTML prototype (Lottie + GSAP, no React, no
 * app build). It is served by serve_nocache.py (regenerate.sh starts it) and
 * loaded here into a full-screen iframe layered just under the navy "stage"
 * cover (z 80000 < stage 90000), so it loads hidden. We then crossfade the navy
 * out to reveal it, and the cursor walks each screen's real controls:
 *   screen 1 (intro)   -> clicks "Go!"            (the in-scene CTA; advances)
 *   screen 2 (AI)      -> clicks "Anthropic"      (BYOK / "use your own AI")
 *                         then the shell "Continue" to advance
 *   screen 3 (data)    -> clicks Connect on each of OneDrive / Outlook /
 *                         Wealthbox (they flip to "Connected"), then "Continue"
 *   screen 4 (setup)   -> progress bars fill, then "Continue to the app"
 * A navy wipe then hands off to the app-arrival beat (realScenes.sceneClientMap),
 * which opens the Webb Client Map behind the cover and streams the book of
 * business into the left rail before settling on the map.
 *
 * Coordinate model (why boundingBox works across the nesting): the page nests
 * top-page -> #kpd-onboarding iframe (the shell) -> #frame iframe (scene-N.html).
 * Playwright's locator.boundingBox() returns coordinates in the TOP page's
 * viewport, walking every iframe offset/scale for us, so the cursor (which lives
 * in the top page at z 99999) can target a control inside the nested scene. The
 * functional click is a real top-level page.mouse.click() at those same coords,
 * which the browser hit-tests straight through the iframes to the control.
 *
 * The 4 screens, in order:
 *   1. intro     — 3-card flowchart (Connect AI + files -> Keepance builds
 *                  Client Maps -> Ask anything, with sources) + security pills.
 *   2. power     — "Connect your AI": cloud (ChatGPT/Claude/Gemini) vs local AI.
 *   3. connect   — "Securely connect your data": OneDrive / Outlook / Wealthbox
 *                  (+ planned-connection logos).
 *   4. setup     — live setup: per-source progress bars filling, "Building your
 *                  Client Maps", a preview of questions, "Continue to the app".
 */

const ONBOARDING_URL = process.env.ONBOARDING_URL || 'http://localhost:8911/';

// advance the prototype shell to the next scene (it listens for this message).
// Used as a fallback if a Continue-button click can't be resolved.
async function advance(page) {
  await page.evaluate(() => {
    const f = document.getElementById('kpd-onboarding');
    if (f && f.contentWindow) f.contentWindow.postMessage('kp-advance', '*');
  });
}

// Find the nested scene-N.html frame (it (re)loads each time the shell advances,
// so we retry until it appears). `tries` x 120ms is the polling budget.
async function sceneFrame(page, n, tries = 40) {
  const re = new RegExp(`scene-${n}\\.html`);
  for (let i = 0; i < tries; i++) {
    const f = page.frames().find((fr) => re.test(fr.url()));
    if (f) return f;
    await page.waitForTimeout(120);
  }
  return null;
}

// Confirm the shell advanced to scene `n` after an advancing click. The click
// itself is reliable (a real mouse click on a resolved box), so we wait GENEROUSLY
// for the nested frame and only post ONE fallback advance if it still hasn't
// appeared (a genuinely missed click) — never just because the load was slow,
// which would otherwise double-advance past the target scene and desync the film.
async function ensureScene(page, n) {
  let f = await sceneFrame(page, n, 80); // ~10s — far beyond any warm-server load
  if (!f) { await advance(page); f = await sceneFrame(page, n, 40); }
  return f;
}

// The shell (onboarding index.html) frame — hosts the persistent Back/Continue
// nav. It is the onboarding-origin frame that is NOT a scene-N.html document.
// Derive the origin from ONBOARDING_URL so a non-default ONB_PORT still resolves.
function shellFrame(page) {
  let origin = ONBOARDING_URL;
  try { origin = new URL(ONBOARDING_URL).origin; } catch { /* keep the raw URL */ }
  return page.frames().find((fr) => fr.url().startsWith(origin) && !/scene-\d/.test(fr.url())) || null;
}

// Show/hide the shell's nav layer (Back / Continue / dots / corner logo). Hidden
// while a scene's portrayed Microsoft sign-in page is up, so the onboarding chrome
// never sits on top of that "browser page" (the page lives in the scene frame,
// below the shell nav). Restored once the sign-in page is dismissed.
async function setShellNav(page, visible) {
  const shell = shellFrame(page);
  if (!shell) return;
  await shell.evaluate((v) => {
    const n = document.getElementById('navlayer');
    if (n) n.style.display = v ? '' : 'none';
  }, visible).catch(() => {});
}

// Move the visible demo cursor to the centre of a top-page bounding box, do the
// click flourish (press + ripple), and optionally fire a real click there.
async function moveAndClick(page, box, { pre = 360, moveDur = 760, settle = 150, real = false } = {}) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (pre) await page.waitForTimeout(pre);            // a beat before reaching
  await page.evaluate(async ({ x, y, d }) => { await window.__kp.moveTo(x, y, d); }, { x: cx, y: cy, d: moveDur });
  if (settle) await page.waitForTimeout(settle);      // settle before pressing
  await page.evaluate(async () => { await window.__kp.click(); }); // visual press + ripple
  if (real) await page.mouse.click(cx, cy);           // functional click (through the iframes)
}

// Cursor-click a control inside scene-N. real:true also fires the DOM click.
async function clickInScene(page, n, selector, opts = {}) {
  const frame = await sceneFrame(page, n);
  if (!frame) { console.warn('[onboarding] scene frame not found:', n); return false; }
  const loc = frame.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  const box = await loc.boundingBox().catch(() => null);
  if (!box) { console.warn('[onboarding] no box for', n, selector); return false; }
  await moveAndClick(page, box, opts);
  return true;
}

// Move the cursor to a text field inside scene-N and type into it (visible).
async function typeInScene(page, n, selector, text, { pre = 320, moveDur = 620, delay = 36 } = {}) {
  const frame = await sceneFrame(page, n);
  if (!frame) { console.warn('[onboarding] scene frame not found:', n); return false; }
  const loc = frame.locator(selector).first();
  const box = await loc.boundingBox().catch(() => null);
  if (box) {
    if (pre) await page.waitForTimeout(pre);
    await page.evaluate(async ({ x, y, d }) => { await window.__kp.moveTo(x, y, d); },
      { x: box.x + Math.min(34, box.width / 2), y: box.y + box.height / 2, d: moveDur });
    await page.evaluate(async () => { await window.__kp.click(); });
  }
  await loc.click().catch(() => {});
  await loc.type(text, { delay }).catch(() => {});
  return true;
}

// Cursor-click the shell's "Continue" button to advance to scene `nextN`.
// Falls back to a postMessage advance if the button can't be resolved/clicked.
async function clickContinue(page, nextN, { pre = 360, moveDur = 760, real = true } = {}) {
  const shell = shellFrame(page);
  const box = shell ? await shell.locator('#cont').boundingBox().catch(() => null) : null;
  if (!box) { await advance(page); await sceneFrame(page, nextN, 80); return; } // couldn't resolve the button
  await moveAndClick(page, box, { pre, moveDur, real });
  if (real) await ensureScene(page, nextN); // verify the advance without risking a double-advance
}

// Screen 4's progress bars climb slowly by design (so the demo always reads as
// "in progress"). For the film, nudge them up a touch faster so the fill is
// clearly visible on camera. This only touches the rendered onboarding iframe at
// capture time; it never modifies the prototype source. Non-fatal if it can't
// find the frame (the prototype's own interval still climbs the bars).
async function fillScreen4Bars(page) {
  try {
    const frame = await sceneFrame(page, 4);
    if (!frame) return;
    await frame.evaluate(async () => {
      const fills = [...document.querySelectorAll('.pfill')];
      const pcts = [...document.querySelectorAll('.ppct')];
      const caps = [95, 88, 84, 80]; // the data imports climb visibly but stay "in progress"
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let t = 0; t < 14; t++) {
        let moving = false;
        fills.forEach((f, i) => {
          const w = parseFloat(f.style.width) || 0;
          const cap = caps[i] ?? 88;
          if (w < cap) {
            moving = true;
            const nw = Math.min(cap, w + 3.2);
            f.style.width = nw + '%';
            if (pcts[i]) pcts[i].textContent = Math.round(nw) + '%';
          }
        });
        if (!moving) break;
        await sleep(190);
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

  // brief load beat, then turn the cursor on (parked low-centre) and crossfade
  // the navy cold-open card out so the viewer catches screen 1 animating in.
  await page.waitForTimeout(850);
  await page.evaluate(() => {
    window.__kp.setCursor(window.innerWidth * 0.5, window.innerHeight * 0.7);
    window.__kp.cursorOn();
  });
  await page.evaluate(async () => { await window.__kp.hideStage(700); });

  // --- Screen 1 · intro 3-card flowchart -> cursor clicks "Go!" ---
  await page.waitForTimeout(2000);                 // let the cards + Lottie settle
  await clickInScene(page, 1, 'button.cta', { pre: 420, moveDur: 840, real: true });
  await ensureScene(page, 2);                      // confirm "Go!" advanced before driving screen 2

  // --- Screen 2 · Connect your AI -> pick Anthropic, paste a key, verify it ---
  await page.waitForTimeout(1800);                 // screen 2 animates in
  await clickInScene(page, 2, '.segbtn[data-p="anthropic"]', { pre: 320, moveDur: 660, real: true });
  await page.waitForTimeout(600);                  // the key-paste steps reveal
  await typeInScene(page, 2, '#provkey', 'sk-ant-api03-V9d2KpL7nQ4rT8sX3bW1mY6cF0jH5gZ-aQ2bd', { delay: 18 });
  await page.waitForTimeout(320);
  await clickInScene(page, 2, '#savekey', { pre: 240, moveDur: 480, real: true });
  await page.waitForTimeout(1650);                 // "Checking your key with Anthropic…" -> "Key verified."
  await clickContinue(page, 3, { pre: 300, moveDur: 600 });

  // --- Screen 3 · Securely connect your data -> three REAL connector flows ---
  await page.waitForTimeout(1700);                 // screen 3 animates in
  // OneDrive: connect -> Microsoft sign-in webpage -> pick account -> import
  await clickInScene(page, 3, '.ctile[data-conn="onedrive"] .connectbtn', { pre: 280, moveDur: 560, real: true });
  await page.waitForTimeout(650);                  // "Waiting for Microsoft sign-in…" + the sign-in page appears
  await setShellNav(page, false);                  // hide onboarding chrome behind the "browser page"
  await page.waitForTimeout(220);
  await clickInScene(page, 3, '#msacct', { pre: 260, moveDur: 540, real: true }); // pick the account
  await page.waitForTimeout(340);
  await setShellNav(page, true);                   // sign-in page dismissed; restore chrome
  await page.waitForTimeout(1850);                 // Connected. -> Importing… items -> Documents imported.
  // Microsoft 365: connect -> Microsoft sign-in webpage -> pick account -> import
  await clickInScene(page, 3, '.ctile[data-conn="m365"] .connectbtn', { pre: 240, moveDur: 500, real: true });
  await page.waitForTimeout(650);
  await setShellNav(page, false);
  await page.waitForTimeout(220);
  await clickInScene(page, 3, '#msacct', { pre: 240, moveDur: 520, real: true });
  await page.waitForTimeout(340);
  await setShellNav(page, true);
  await page.waitForTimeout(1750);                 // Connected. -> Importing… messages -> All mail imported and searchable.
  // Wealthbox: paste an API key -> connect -> Sync now -> households import
  await typeInScene(page, 3, '.ctile[data-conn="wealthbox"] .wbkey', 'wb_live_3f9aK2pQ7xR4nL8', { delay: 20 });
  await page.waitForTimeout(260);
  await clickInScene(page, 3, '.ctile[data-conn="wealthbox"] .connectbtn', { pre: 240, moveDur: 460, real: true });
  await page.waitForTimeout(1500);                 // Connecting… -> Connected to Northcrest Wealth (Premier).
  await clickInScene(page, 3, '.ctile[data-conn="wealthbox"] .connectbtn', { pre: 240, moveDur: 440, real: true }); // Sync now
  await page.waitForTimeout(2300);                 // Syncing… households -> Sync complete
  await clickContinue(page, 4, { pre: 300, moveDur: 600 });

  // --- Screen 4 · live setup -> bars fill -> cursor clicks "Continue to the app" ---
  await page.waitForTimeout(900);                  // let the panel animate in
  await fillScreen4Bars(page);                     // ~2.4s of visible filling
  await page.waitForTimeout(500);
  // Cursor presses "Continue to the app" — VISUAL only: a real click would loop
  // the shell back to screen 1; the navy wipe below is the actual handoff.
  const shell = shellFrame(page);
  const contBox = shell ? await shell.locator('#cont').boundingBox().catch(() => null) : null;
  if (contBox) await moveAndClick(page, contBox, { pre: 380, moveDur: 760, real: false });
  await page.evaluate(() => window.__kp.cursorOff());

  // 2) Hand off: raise navy over the onboarding and remove the iframe. The navy
  //    is INTENTIONALLY LEFT UP — sceneClientMap opens the Webb Client Map behind
  //    it, streams the book of business into the left rail, then crossfades to
  //    the real map (changes #2 + #3). Never reveals the all-clients table.
  await page.evaluate(async () => {
    const navy = '<div class="kpd-scene"><div class="kpd-fullcard"><div class="kpd-grain"></div></div></div>';
    await window.__kp.showStage(navy, 520);
  });
  await page.evaluate(() => { document.getElementById('kpd-onboarding')?.remove(); });
  await page.waitForTimeout(180);
}

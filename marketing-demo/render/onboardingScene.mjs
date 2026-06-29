/*
 * marketing-demo/render/onboardingScene.mjs
 * DEMO-ONLY. Scene 2 of the Keepance marketing film: the REAL first-run
 * onboarding (the onboarding-journey `JourneyHost`), driven full-screen.
 *
 * This replaces the old simulated welcome/connect-AI/connect-data modals
 * (scenes 2-4 in scenes.mjs). The journey is mounted as a real React overlay on
 * the running /try app via window.__kpJourney (registered by
 * src/dev/DemoJourneyOverlay under the vite dev server). We drive its real
 * buttons with the demo cursor + Playwright clicks, so the film shows the
 * genuine onboarding, not a mock.
 *
 * Cut (tight, cinematic): Welcome -> Your files stay home (pick a folder) ->
 * Meet the AI -> Choose your AI -> Connect your account (BYOK). Then a navy
 * wipe hands off to Scene 5 (the real Client Map).
 */

// Move the demo cursor onto a real element, show the click ripple, then perform
// the actual DOM click via Playwright (the cursor/ripple are visual only).
async function cursorClick(page, testId, moveDur = 760) {
  const sel = `[data-testid="${testId}"]`;
  await page.evaluate(async ({ s, d }) => {
    await window.__kp.moveToEl(s, d);
    await window.__kp.click();
  }, { s: sel, d: moveDur });
  await page.click(sel).catch(() => {});
  await page.waitForTimeout(150);
}

async function cursorHover(page, testId, moveDur = 680) {
  const sel = `[data-testid="${testId}"]`;
  await page.evaluate(async ({ s, d }) => {
    await window.__kp.moveToEl(s, d);
  }, { s: sel, d: moveDur });
}

export async function sceneOnboarding(page) {
  // Mount the real JourneyHost behind the navy cover left up by the cold open.
  await page.waitForFunction(() => window.__kpJourney && window.__kpJourney.__ready, { timeout: 8000 });
  await page.evaluate(() => window.__kpJourney.show());
  await page.waitForSelector('[data-testid="ch1-root"]', { timeout: 12000 });

  // Park the cursor low-center, then fade the navy cold-open cover out to reveal
  // the onboarding underneath (a clean crossfade from the pain card to setup).
  await page.evaluate(async () => {
    await window.__kp.setCursor(window.innerWidth * 0.52, window.innerHeight * 0.6);
    await window.__kp.cursorOn();
  });
  await page.evaluate(async () => { await window.__kp.hideStage(640); });

  // --- Ch1 · Welcome ---
  await page.waitForTimeout(2300);
  await cursorClick(page, 'chapter-continue', 860); // "Start"
  await page.waitForSelector('[data-testid="ch3-root"]', { timeout: 8000 });

  // --- Ch3 · Your files stay home (pick a folder) ---
  await page.waitForTimeout(1500);
  await cursorClick(page, 'ch3-choose-folder', 760); // stub returns a path
  await page.waitForSelector('[data-testid="ch3-chosen-path"]', { timeout: 6000 });
  await page.waitForTimeout(1150);
  await cursorClick(page, 'chapter-continue', 740); // "Continue"
  await page.waitForSelector('[data-testid="ch4-root"]', { timeout: 8000 });

  // --- Ch4 · Meet the AI ---
  await page.waitForTimeout(2700);
  await cursorClick(page, 'chapter-continue', 860); // "Show me my choices"
  await page.waitForSelector('[data-testid="ch5-root"]', { timeout: 8000 });

  // --- Ch5 · Choose your AI -> Connect your account (BYOK) ---
  // Brief on the choice cards, then drill into the clean Bring-Your-Own-Key
  // connect screen (the real "connect an AI, your key never leaves" beat).
  await page.waitForTimeout(1250);
  await cursorClick(page, 'ch5-card-cloud', 840); // "Use your own AI account"
  await page.waitForSelector('[data-testid="ch5-cloud-view"]', { timeout: 8000 });
  await page.waitForTimeout(1200);
  // Show the provider choice is real, land back on Claude, glance at the key field.
  await cursorHover(page, 'ch5-provider-tab-openai', 700);
  await page.waitForTimeout(550);
  await cursorHover(page, 'ch5-provider-tab-anthropic', 560);
  await page.waitForTimeout(500);
  await cursorHover(page, 'ch5-key-input', 700);
  await page.waitForTimeout(1300);

  // --- Hand off to Scene 5: navy wipe, unmount the journey, reveal the app ---
  await page.evaluate(async () => {
    const navy = '<div class="kpd-scene"><div class="kpd-fullcard"><div class="kpd-grain"></div></div></div>';
    await window.__kp.showStage(navy, 480);
  });
  await page.evaluate(() => window.__kpJourney.hide());
  await page.evaluate(async () => { await window.__kp.cursorOff(); });
  await page.waitForTimeout(160);
  await page.evaluate(async () => { await window.__kp.hideStage(560); });
}

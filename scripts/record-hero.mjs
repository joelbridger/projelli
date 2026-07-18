/**
 * Records real footage of the Keepance app working the seeded Halvorsen
 * Estate matter, for the marketing site hero + tour.
 *
 * Drives the MAIN app in test mode with the recording matter seeded
 * (?testMode=true&recordMatter=1): real editor, real file tree, no demo chrome,
 * working file-open. Saves a webm to scripts/recordings/.
 *
 * Prereq: dev server at http://localhost:5173 (npm run dev).
 * Run: node scripts/record-hero.mjs
 */
import { chromium } from 'playwright';
import { withBrowserLaunchOptions } from './browser-launch.mjs';

const URL = process.env.REC_URL || 'http://localhost:5173/?testMode=true&recordMatter=1';
const OUT = 'scripts/recordings';

const browser = await chromium.launch(withBrowserLaunchOptions());
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const tree = (text) => page.locator('[role="treeitem"]', { hasText: text }).first();

console.log('navigating...');
await page.goto(URL, { waitUntil: 'domcontentloaded' });

// Wait for the seeded matter + the deposition (auto-opened) to render.
await tree('Deposition Notes.md').waitFor({ timeout: 30000 });
await page.getByText('second appraisal', { exact: false }).first().waitFor({ timeout: 15000 });
await wait(3800); // hold: real legal notes, on your machine

// Open the saved AI conversation that catches the contradiction.
console.log('opening contradiction chat...');
await tree('Deposition contradictions').click();
await page.getByText('never saw a second appraisal', { exact: false }).first().waitFor({ timeout: 15000 });
await wait(5200); // hold: the AI's findings with page cites

// Gentle scroll through the answer.
await page.mouse.move(900, 420);
await page.mouse.wheel(0, 300);
await wait(3000);

await context.close(); // finalizes the webm
await browser.close();
console.log('done');

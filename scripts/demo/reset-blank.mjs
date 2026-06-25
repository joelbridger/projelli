#!/usr/bin/env node
// reset-blank.mjs — wipe to a TRUE first-run ("blank") state for the build-it-live demo.
//
// Clears ALL localStorage and writes NO seed, so the app boots into the first-run
// onboarding wizard with zero clients and zero recent workspaces (App.tsx shows the
// FirstRunWizard when onboarding is incomplete AND recentWorkspaces is empty).
// The OS-keychain OpenAI key is left intact, so "Ask" works immediately after a
// live import without typing an API key on stage.
//
// Pair with the small staged blank workspace on the bench (C:\keepance-demo-blank)
// so the live build-up imports a couple of .txt/.docx files and indexes in seconds.
//
// Run from the server through the CDP tunnel:  DESKTOP_CDP_PORT=9444 node reset-blank.mjs
import { getPage, disconnect } from '../robot/connection.mjs';
const page = await getPage();
page.setDefaultTimeout(20000);

const before = await page.evaluate(() => {
  const n = localStorage.length;
  localStorage.clear();
  return n;
});
console.log('cleared localStorage keys:', before);

await page.evaluate(() => location.reload());
await page.waitForTimeout(5000);

// verify the first-run wizard / workspace picker is showing (no workspace, no clients)
const verify = await page.evaluate(() => {
  const tids = new Set([...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')));
  return {
    firstRunOrPicker:
      tids.has('first-run-wizard') ||
      tids.has('workspace-selector-dialog') ||
      tids.has('welcome-dialog-pitch'),
    hasMattersNav: tids.has('spine-nav-matters'),
    bodyHead: document.body.innerText.slice(0, 140),
  };
});
console.log('VERIFY:', JSON.stringify(verify, null, 2));
console.log(verify.firstRunOrPicker && !verify.hasMattersNav
  ? 'RESET-BLANK OK ✓  (boots to first-run)'
  : 'RESET-BLANK needs attention ✗');
await disconnect();

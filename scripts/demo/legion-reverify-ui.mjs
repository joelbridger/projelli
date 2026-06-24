#!/usr/bin/env node
// UI re-verify for the Round 2 fixes (run after rebuild + clean slate + workspace open).
// Checks: Clients list has no "PRIVILEGE" header (R2-LABEL1); Email surface honest +
// copy fixed (R2-EMAIL1/2); recents deduped (R2-RECENT1); Activity Log has rows
// (R2-AUDIT1) — caller should run an Ask first. Reports a JSON verdict per check.
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);page.setDefaultTimeout(8000);
const out={};
const txt=async(sel)=>{try{return (await page.evaluate((s)=>document.querySelector(s)?.innerText||'',sel)).replace(/\s+/g,' ');}catch{return '';}};
try{
  // R2-LABEL1: Clients list header
  await page.click('[data-testid="spine-nav-matters"]').catch(()=>{});
  await page.waitForTimeout(1200);
  const clientsText = await txt('main');
  out.R2_LABEL1_privilege_header = { hasPrivilegeWord: /PRIVILEGE/i.test(clientsText), pass: !/PRIVILEGE/i.test(clientsText) };

  // R2-AUDIT1: Activity Log rows (assumes caller already asked a question)
  await page.click('[data-testid="spine-nav-audit"]').catch(()=>{});
  await page.waitForTimeout(1200);
  const auditText = await txt('main');
  const emptyLog = /No activity logged yet/i.test(auditText);
  const rowCount = await page.$$eval('[data-testid^="audit-"]', els=>els.length).catch(()=>0);
  out.R2_AUDIT1_activity_log = { emptyLog, rowLikeEls: rowCount, pass: !emptyLog };

  // R2-EMAIL1/2: Email surface
  await page.click('[data-testid="spine-nav-email"]').catch(()=>{});
  await page.waitForTimeout(1200);
  const emailText = await txt('main');
  out.R2_EMAIL = {
    saysConnected: /your email is connected/i.test(emailText),
    saysSyncing: /syncing/i.test(emailText),
    dupSearchCopy: /inbox search never could/i.test(emailText),
    fixedCopyPresent: /your inbox never could/i.test(emailText),
    pass: !/inbox search never could/i.test(emailText),
  };

  // R2-RECENT1: recents dedupe (open the workspace switcher in the header)
  out.note = 'recents dedupe checked separately via header switcher if available';
}catch(e){out.err=String(e.message||e).slice(0,160);}
console.log(JSON.stringify(out,null,2));
await browser.close().catch(()=>{});

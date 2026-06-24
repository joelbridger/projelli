#!/usr/bin/env node
// Navigate to Hollings + open Client Map IN ONE CDP SESSION while capturing
// console + page errors, to learn why the panel white-screens.
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();let page=pickPage(browser);
const logs=[];
const attach=(pg)=>{ pg.on('console',m=>logs.push('['+m.type()+'] '+m.text().slice(0,200))); pg.on('pageerror',e=>logs.push('[PAGEERROR] '+(e.stack||e.message||String(e)).slice(0,400))); pg.on('framenavigated',f=>{ if(f===pg.mainFrame()) logs.push('[NAV] '+f.url()); }); };
attach(page);
const click=async(tid,wait=1500)=>{ try{ await page.click(`[data-testid="${tid}"]`,{timeout:8000}); logs.push('CLICKED '+tid); }catch(e){ logs.push('CLICK-FAIL '+tid+': '+String(e.message).slice(0,80)); } await page.waitForTimeout(wait); };
try{
  await click('recent-workspaces-toggle',1200);
  await click('recent-workspace-row',4000);
  await click('feature-tour-skip',1200);
  await click('spine-nav-matters',2000);
  await click('matter-row-matter_nc_hollings_family',3000);
  logs.push('PRE-CLIENTMAP body.len='+await page.evaluate(()=>document.body.innerText.length).catch(()=>'err'));
  await click('hub-panel-clientmap-open',6000);
  logs.push('POST-CLIENTMAP body.len='+await page.evaluate(()=>document.body.innerText.length).catch(()=>'err'));
}catch(e){ logs.push('OUTER-ERR '+String(e.message)); }
console.log(JSON.stringify(logs,null,2));
await browser.close().catch(()=>{});

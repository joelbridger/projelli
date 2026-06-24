#!/usr/bin/env node
// Trash + a LIGHT client's hub + its (likely empty) Client Map empty-state.
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);
const dir='C:/keepance/';const report={};
try{
  // Trash
  await page.click('[data-testid="spine-nav-files"]',{timeout:5000});
  await page.waitForTimeout(800);
  await page.getByText('Trash',{exact:true}).first().click({timeout:4000}).catch(e=>report.trashClick=String(e.message).slice(0,80));
  await page.waitForTimeout(800);
  await page.screenshot({path:`${dir}sw-trash.jpeg`,type:'jpeg',quality:78});
  report.trashText=(await page.evaluate(()=>document.body.innerText).catch(()=>'')).replace(/\s+/g,' ').match(/Trash.{0,200}/)?.[0]||'';
}catch(e){report.trashErr=String(e.message).slice(0,120);}
try{
  // Light client (Caldwell, Jennifer) → hub
  await page.click('[data-testid="spine-nav-matters"]',{timeout:5000});
  await page.waitForTimeout(600);
  await page.getByText('Caldwell, Jennifer',{exact:false}).first().click({timeout:4000});
  await page.waitForTimeout(1500);
  await page.screenshot({path:`${dir}sw-light-hub.jpeg`,type:'jpeg',quality:78});
  // at-a-glance text
  report.lightGlance=(await page.evaluate(()=>document.querySelector('[data-testid="hub-ai-glance"]')?.innerText||'(no glance)').catch(()=>'')).replace(/\s+/g,' ').slice(0,300);
  report.lightActivity=(await page.evaluate(()=>document.querySelector('[data-testid="hub-activity"]')?.innerText||'(no activity)').catch(()=>'')).replace(/\s+/g,' ').slice(0,200);
  report.lightDocs=(await page.evaluate(()=>document.querySelector('[data-testid="hub-panel-documents"]')?.innerText||'').catch(()=>'')).replace(/\s+/g,' ').slice(0,120);
  // open client map (empty-state)
  await page.click('[data-testid="hub-panel-clientmap-open"]',{timeout:4000}).catch(e=>report.cmOpen=String(e.message).slice(0,80));
  await page.waitForTimeout(1500);
  await page.screenshot({path:`${dir}sw-light-map.jpeg`,type:'jpeg',quality:78});
  report.lightMap=(await page.evaluate(()=>document.querySelector('[data-testid="clientmap-view"]')?.innerText||document.querySelector('main')?.innerText||'').catch(()=>'')).replace(/\s+/g,' ').slice(0,300);
}catch(e){report.lightErr=String(e.message).slice(0,120);}
console.log(JSON.stringify(report,null,2));
await browser.close().catch(()=>{});

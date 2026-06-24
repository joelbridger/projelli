#!/usr/bin/env node
// Open a LIGHT client's hub via the Clients table row; capture sparse at-a-glance
// + open its Client Map (empty-state or sparse build).
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);
const dir='C:/keepance/';const report={};
try{
  await page.click('[data-testid="spine-nav-matters"]',{timeout:5000});
  await page.waitForTimeout(700);
  // click the client name heading in the table (main region), not the sidebar
  await page.click('[data-testid="matter-row-matter_nc_diaz_sandra"]',{timeout:5000});
  await page.waitForTimeout(2000);
  await page.screenshot({path:`${dir}sw-light2-hub.jpeg`,type:'jpeg',quality:78});
  report.url=page.url();
  report.glance=(await page.evaluate(()=>document.querySelector('[data-testid="hub-ai-glance"]')?.innerText||'(no glance)')).replace(/\s+/g,' ').slice(0,400);
  report.activity=(await page.evaluate(()=>document.querySelector('[data-testid="hub-activity"]')?.innerText||'(no activity)')).replace(/\s+/g,' ').slice(0,200);
  report.docs=(await page.evaluate(()=>document.querySelector('[data-testid="hub-panel-documents"]')?.innerText||'(no docs panel)')).replace(/\s+/g,' ').slice(0,150);
  report.clientmapPreview=(await page.evaluate(()=>document.querySelector('[data-testid="hub-panel-clientmap-body"]')?.innerText||'(no cm body)')).replace(/\s+/g,' ').slice(0,250);
  // open the client map
  await page.click('[data-testid="hub-panel-clientmap-open"]',{timeout:5000}).catch(e=>report.cmOpenErr=String(e.message).slice(0,80));
  await page.waitForTimeout(2500);
  await page.screenshot({path:`${dir}sw-light2-map.jpeg`,type:'jpeg',quality:78});
  report.map=(await page.evaluate(()=>document.querySelector('[data-testid="clientmap-view"]')?.innerText||document.querySelector('main')?.innerText||'')).replace(/\s+/g,' ').slice(0,400);
}catch(e){report.err=String(e.message).slice(0,160);}
console.log(JSON.stringify(report,null,2));
await browser.close().catch(()=>{});

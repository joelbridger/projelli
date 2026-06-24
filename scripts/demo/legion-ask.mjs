#!/usr/bin/env node
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
const Q = process.argv[2] || 'What did we decide about the business exit at the last review?';
const OUT = process.argv[3] || 'C:/keepance/ask.jpeg';
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);
const logs=[]; page.on('pageerror',e=>logs.push('[PAGEERROR] '+(e.message||'').slice(0,160)));
try{
  await page.fill('[data-testid="hub-ask-input"]', Q);
  await page.click('[data-testid="hub-ask-submit"]');
  // wait for an answer to appear (up to ~30s)
  await page.waitForTimeout(2000);
  for(let i=0;i<28;i++){
    const txt = await page.evaluate(()=>document.body.innerText).catch(()=>'');
    if(/source|cite|p\.\d|\[\d\]/i.test(txt) && txt.length>3000) break;
    await page.waitForTimeout(1000);
  }
  await page.evaluate(()=>{const el=document.querySelector('[data-testid="hub-ask-input"]'); if(el)el.scrollIntoView({block:'start'});}).catch(()=>{});
  await page.waitForTimeout(500);
  await page.screenshot({path:OUT,type:'jpeg',quality:80});
  const bodyLen = await page.evaluate(()=>document.body.innerText.length).catch(()=>0);
  console.log(JSON.stringify({asked:Q, bodyLen, pageErrors:logs}));
}catch(e){ console.log(JSON.stringify({err:String(e.message), logs})); }
await browser.close().catch(()=>{});

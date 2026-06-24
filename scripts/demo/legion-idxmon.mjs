#!/usr/bin/env node
// Sample the indexing progress banner repeatedly until it disappears (or timeout),
// capturing each distinct phase string (office count, PDF/OCR phase, done).
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);
const seen=[]; let last=''; let goneCount=0;
const SAMPLES=parseInt(process.argv[2]||'40',10);
for(let i=0;i<SAMPLES;i++){
  const txt=await page.evaluate(()=>{
    const body=document.body.innerText;
    const m=body.match(/Indexing[^\n]*|Reading PDFs[^\n]*|OCR[^\n]*|Indexing PDFs[^\n]*|Scanning[^\n]*/i);
    return m?m[0].slice(0,120):'';
  }).catch(()=>'');
  if(txt && txt!==last){seen.push({t:i,txt});last=txt;}
  if(!txt){goneCount++; if(goneCount>=3 && seen.length>0) break;} else goneCount=0;
  await page.waitForTimeout(2000);
}
console.log(JSON.stringify({phases:seen, endedClean:goneCount>=3},null,2));
await browser.close().catch(()=>{});

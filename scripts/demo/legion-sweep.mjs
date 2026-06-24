#!/usr/bin/env node
// Navigate each top-level surface and screenshot it in ONE CDP session.
// Also dumps a shallow text snapshot per surface for quick triage.
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);
const dir='C:/keepance/';
const surfaces=[
  ['spine-nav-settings','settings'],
  ['spine-nav-privacy','privacy'],
  ['spine-nav-audit','audit'],
  ['spine-nav-workflows','workflows'],
  ['spine-nav-email','email'],
  ['spine-nav-files','files'],
];
const report={};
for(const [testid,name] of surfaces){
  try{
    await page.click(`[data-testid="${testid}"]`,{timeout:5000});
    await page.waitForTimeout(1200);
    await page.screenshot({path:`${dir}sw-${name}.jpeg`,type:'jpeg',quality:78});
    const txt=await page.evaluate(()=>document.querySelector('main')?.innerText||document.body.innerText).catch(()=>'');
    report[name]={ok:true,textHead:txt.replace(/\s+/g,' ').slice(0,500)};
  }catch(e){report[name]={ok:false,err:String(e.message||e).slice(0,120)};}
}
console.log(JSON.stringify(report,null,2));
await browser.close().catch(()=>{});

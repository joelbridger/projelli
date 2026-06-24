#!/usr/bin/env node
// UI-driven SINGLE Client Map build (works in preview/production, no /src import):
// open a client hub -> Open Client Map -> wait for the build to populate -> report
// section item counts from the persisted store (the TRUE clean single-build baseline).
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
const MID = process.argv[2] || 'matter_nc_hollings_family';
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);page.setDefaultTimeout(15000);
const out={mid:MID};
function counts(){return page.evaluate((MID)=>{
  const raw=localStorage.getItem('keepance:client-maps');if(!raw)return null;
  const p=JSON.parse(raw);const maps=p.state?p.state.maps:p.maps;const m=maps&&maps[MID];if(!m)return null;
  const norm=s=>(s||'').trim().toLowerCase().replace(/\s+/g,' ');
  const secs=(m.sections||[]).map(s=>({key:s.key,n:s.items.length,uniq:new Set(s.items.map(i=>norm(i.text))).size}));
  let total=0,loc={};secs.forEach(s=>total+=s.n);
  for(const s of (m.sections||[]))for(const it of s.items)for(const src of (it.sources||[])){const L=src.locator||'(none)';loc[L]=(loc[L]||0)+1;}
  return {total,secs,loc,built:m.lastBuiltAt};
},MID);}
try{
  await page.click('[data-testid="spine-nav-matters"]');await page.waitForTimeout(700);
  await page.click(`[data-testid="matter-row-${MID}"]`);await page.waitForTimeout(1500);
  out.before=await counts();
  await page.click('[data-testid="hub-panel-clientmap-open"]').catch(async()=>{
    // maybe already in hub; try the inline open
    await page.click('[data-testid="clientmap-start-interview"]').catch(()=>{});
  });
  // wait for build: poll counts until total stabilizes for 3 reads or 90s
  let prev=-1,stable=0;
  for(let i=0;i<45;i++){
    await page.waitForTimeout(2000);
    const c=await counts();
    const t=c?c.total:0;
    if(t>0 && t===prev){stable++;if(stable>=3){out.after=c;break;}}else{stable=0;}
    prev=t;
    out.after=c;
  }
}catch(e){out.err=String(e.message||e).slice(0,160);}
console.log(JSON.stringify(out,null,2));
await browser.close().catch(()=>{});

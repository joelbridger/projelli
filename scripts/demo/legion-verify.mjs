#!/usr/bin/env node
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);
const out=await page.evaluate(async()=>{
  const inv=window.__TAURI__&&(window.__TAURI__.core?.invoke||window.__TAURI__.invoke);
  const ext=p=>{const m=/\.([a-z0-9]+)$/i.exec(p||'');return m?m[1].toLowerCase():'?';};
  const lc=s=>String(s||'').toLowerCase();
  const run=async(label,q,matterId,mustContain)=>{
    const scope=matterId?{kind:'matter',matterId}:{kind:'allMatters'};
    const hits=await inv('rag_retrieve',{query:q,topK:15,scope,includePrivileged:false});
    const exts={}; let leak=0; const srcs=new Set();
    for(const h of hits){ exts[ext(h.path)]=(exts[ext(h.path)]||0)+1; srcs.add(String(h.path).split(/[\\/]/).slice(-2).join('/'));
      if(mustContain && !lc(h.path).includes(lc(mustContain))) leak++; }
    return {label,count:hits.length,exts,leak,sample:[...srcs].slice(0,4)};
  };
  const r={};
  r.hollings=await run('hollings/all-types','goals retirement estate trust portfolio holdings statement tax meeting','matter_nc_hollings_family','Hollings Family');
  r.webb=await run('webb/all-types','goals retirement estate portfolio holdings statement tax meeting','matter_nc_webb_marcus_tanya','Webb, Marcus');
  r.voss=await run('voss/all-types','goals retirement estate portfolio holdings statement tax meeting','matter_nc_voss_eleanor','Voss, Eleanor');
  // isolation: Hollings-specific term scoped to Webb must NOT return Hollings
  r.isolation_webb=await run('Cascade(Hollings-only) scoped to Webb -> expect 0','Cascade Fund IV capital call Hollings business exit','matter_nc_webb_marcus_tanya');
  // Hollings demo questions
  r.q_business=await run('Q: central planning issue / business exit','business exit Hollings Capital Partners concentration deal readiness','matter_nc_hollings_family','Hollings Family');
  r.q_daf=await run('Q: DAF grants','donor advised fund DAF grant request charitable board meeting','matter_nc_hollings_family','Hollings Family');
  return r;
});
console.log(JSON.stringify(out,null,2));
await browser.close().catch(()=>{});

#!/usr/bin/env node
// Read the persisted Client Maps + report per-section item counts, near-dupes,
// pending updates, completeness, and source-locator distribution. No DOM cap.
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);
const want = process.argv[2] || 'matter_nc_hollings_family';
const result=await page.evaluate((want)=>{
  const norm=s=>(s||'').trim().toLowerCase().replace(/\s+/g,' ');
  const raw=localStorage.getItem('keepance:client-maps');
  if(!raw)return{error:'no client-maps in localStorage'};
  const parsed=JSON.parse(raw);
  const maps=parsed.state?parsed.state.maps:parsed.maps;
  const out={mattersWithMaps:Object.keys(maps||{})};
  const m=maps[want];
  if(!m){out.error='no map for '+want;return out;}
  out.target=want;
  out.lastBuiltAt=m.lastBuiltAt;
  out.pendingUpdates=(m.pendingUpdates||[]).length;
  out.completeness=m.completeness?{level:m.completeness.level,know:(m.completeness.know||[]).length,assuming:(m.completeness.assuming||[]).length,ask:(m.completeness.ask||[]).length}:null;
  out.sections=[];
  const locator={};
  for(const sec of (m.sections||[])){
    const texts=sec.items.map(i=>i.text);
    const normset=new Set(texts.map(norm));
    // near-dup: items sharing first 5 words
    const firstwords={};
    for(const t of texts){const k=norm(t).split(' ').slice(0,5).join(' ');firstwords[k]=(firstwords[k]||0)+1;}
    const nearDup=Object.entries(firstwords).filter(([k,v])=>v>1);
    for(const it of sec.items)for(const s of (it.sources||[])){const L=s.locator||'(none)';locator[L]=(locator[L]||0)+1;}
    out.sections.push({key:sec.key,title:sec.title,items:texts.length,exactUnique:normset.size,nearDupGroups:nearDup.length,nearDupExamples:nearDup.slice(0,3)});
  }
  out.locatorDist=locator;
  return out;
},want).catch(e=>({evalError:String(e)}));
console.log(JSON.stringify(result,null,2));
await browser.close().catch(()=>{});

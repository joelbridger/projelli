#!/usr/bin/env node
// Build + persist Client Maps for the deep Northcrest households via the app's
// real generator (buildClientMap) + clientMapStore.setMap.
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const DEEP=process.argv.slice(2);
const targets = DEEP.length?DEEP:[
  'matter_nc_hollings_family','matter_nc_ellison_robert_margaret','matter_nc_webb_marcus_tanya',
  'matter_nc_voss_eleanor','matter_nc_nakamura_david_susan','matter_nc_patel_priya'];
const browser=await getBrowser();const page=pickPage(browser);
page.setDefaultTimeout(0);
const out=await page.evaluate(async(targets)=>{
  const gen=await import('/src/platform/clientMap/generator.ts');
  const cms=await import('/src/platform/clientMap/clientMapStore.ts');
  const res=[];
  for(const id of targets){
    try{
      const map=await gen.buildClientMap(id);
      cms.useClientMapStore.getState().setMap(id,map);
      const secCounts={}; (map.sections||[]).forEach(s=>{secCounts[s.key||s.title]=(s.items||[]).length;});
      res.push({id,ok:true,level:map.completeness&&map.completeness.level,sections:secCounts,
        know:(map.completeness&&map.completeness.know||[]).length,
        assuming:(map.completeness&&map.completeness.assuming||[]).length,
        ask:(map.completeness&&map.completeness.ask||[]).length});
    }catch(e){ res.push({id,ok:false,err:String(e&&e.message||e)}); }
  }
  return res;
},targets);
console.log(JSON.stringify(out,null,2));
await browser.close().catch(()=>{});

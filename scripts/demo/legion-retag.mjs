#!/usr/bin/env node
// Re-tag every client file's already-indexed chunks to its matter, in place.
// For each file under Clients/<household>, try the candidate stored-path formats;
// rag_retag_matter updates only the rows whose tokenized path matches, so the
// correct format wins and the others are harmless no-ops.
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);
const out=await page.evaluate(async()=>{
  const inv=window.__TAURI__&&(window.__TAURI__.core?.invoke||window.__TAURI__.invoke);
  if(!inv)return{error:'no invoke'};
  const ROOT='C:/keepance-demo-northcrest/Northcrest Wealth Partners';
  const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  // collect all relative file paths from the fileTree
  const wsmod=await import('/src/platform/fs/workspaceStore.ts');
  const ft=wsmod.useWorkspaceStore.getState().fileTree;
  const files=[]; const walk=n=>{ if(!n)return; if(Array.isArray(n)){n.forEach(walk);return;} const isDir=n.type==='directory'||n.isDirectory||(n.children&&n.children.length>=0&&!/\.[a-z0-9]+$/i.test(n.name||'')); if(n.path&&/\.[a-z0-9]+$/i.test(n.path))files.push(n.path); if(n.children)walk(n.children); };
  walk(ft);
  const fmt={relFwd:0,absFwd:0,absMixed:0}; const perMatter={}; let clientFiles=0; let errors=0;
  for(const rel0 of files){
    const rel=rel0.replace(/^[\\/]+/,'').replace(/\\/g,'/');           // normalize to forward, no leading slash
    const m=/^Clients\/([^/]+)\//.exec(rel); if(!m)continue;            // only client files
    clientFiles++;
    const matterId='matter_nc_'+slug(m[1]);
    const relFwd=rel;
    const absFwd=ROOT+'/'+rel;
    const absMixed=ROOT+'\\'+rel.replace(/\//g,'\\');
    for(const [k,p] of [['relFwd',relFwd],['absFwd',absFwd],['absMixed',absMixed]]){
      try{ const n=await inv('rag_retag_matter',{path:p,matterId}); if(n>0){fmt[k]+=n; perMatter[matterId]=(perMatter[matterId]||0)+n;} }
      catch(e){ errors++; }
    }
  }
  return {clientFiles,fmtRowsUpdated:fmt,perMatterRows:perMatter,errors};
});
console.log(JSON.stringify(out,null,2));
await browser.close().catch(()=>{});

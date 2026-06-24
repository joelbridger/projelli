#!/usr/bin/env node
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);
const out=await page.evaluate(async()=>{
  const r={};
  // fileTree path format
  try{ const wsmod=await import('/src/platform/fs/workspaceStore.ts');
    const ft=wsmod.useWorkspaceStore.getState().fileTree;
    const paths=[]; const walk=(n)=>{ if(!n)return; if(Array.isArray(n)){n.forEach(walk);return;} if(n.path)paths.push(n.path); if(n.children)walk(n.children); };
    walk(ft); r.fileTreeSample=paths.slice(0,6); r.fileTreeCount=paths.length;
  }catch(e){ r.fileTreeErr=String(e&&e.message||e); }
  // resolver behavior with CURRENT (absolute) folderPaths
  try{ const mr=await import('/src/platform/rag/matterResolver.ts');
    const tests=[
      'C:/keepance-demo-northcrest/Northcrest Wealth Partners/Clients/Hollings Family/Tax/x.docx',
      'C:/keepance-demo-northcrest/Northcrest Wealth Partners\\\\Clients\\\\Hollings Family\\\\Tax\\\\x.docx',
      'Clients/Hollings Family/Tax/x.docx',
      'Clients/Hollings Family/Tax/x.pdf',
    ];
    r.resolverCurrent={}; for(const t of tests){ r.resolverCurrent[t]=mr.resolveMatterIdForPath(t); }
  }catch(e){ r.resolverErr=String(e&&e.message||e); }
  // current matter folderPaths sample
  try{ const ms=await import('/src/platform/matter/matterStore.ts');
    const m=ms.useMatterStore.getState().matters.find(x=>x.id==='matter_nc_hollings_family');
    r.hollingsFolderPaths=m?m.folderPaths:null;
  }catch(e){ r.msErr=String(e&&e.message||e); }
  return r;
});
console.log(JSON.stringify(out,null,2));
await browser.close().catch(()=>{});

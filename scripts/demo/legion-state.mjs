#!/usr/bin/env node
// Report workspace root + all keepance localStorage keys + sizes (to plan a clean wipe).
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);
const out=await page.evaluate(()=>{
  const keys={};
  for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);keys[k]=(localStorage.getItem(k)||'').length;}
  let wsRoot=null;
  try{const rw=JSON.parse(localStorage.getItem('keepance_recent_workspaces')||'[]');wsRoot=Array.isArray(rw)?rw:rw;}catch{}
  let matters=null;
  try{const m=JSON.parse(localStorage.getItem('keepance:matters')||'{}');const arr=m.state?m.state.matters:m.matters;matters={count:(arr||[]).length,sampleFolderPaths:(arr||[]).slice(0,2).map(x=>({id:x.id,fp:x.folderPaths}))};}catch(e){matters=String(e);}
  return {allKeys:keys, recentWorkspaces:wsRoot, matters};
});
console.log(JSON.stringify(out,null,2));
await browser.close().catch(()=>{});

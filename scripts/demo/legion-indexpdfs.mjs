#!/usr/bin/env node
// Reliably index ALL Northcrest PDFs via the app's real indexPdfFile, feeding
// bytes read from disk in Node (bypasses the flaky workspaceService.readBinary
// auto-pass). Absolute forward-slash in-app paths so the resolver tags each PDF
// to its client (matching the absolute folderPaths).
import { chromium } from 'playwright';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
const DISK_ROOT = 'C:\\keepance-demo-northcrest\\Northcrest Wealth Partners';
const APP_ROOT = 'C:/keepance-demo-northcrest/Northcrest Wealth Partners';
const BATCH = 10;

async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}

function walkPdfs(dir){
  let out=[];
  for(const name of readdirSync(dir)){
    const fp=path.join(dir,name);
    const st=statSync(fp);
    if(st.isDirectory()) out=out.concat(walkPdfs(fp));
    else if(/\.pdf$/i.test(name)) out.push(fp);
  }
  return out;
}

const pdfs=walkPdfs(DISK_ROOT);
console.error(`found ${pdfs.length} PDFs`);
const browser=await getBrowser();const page=pickPage(browser);
page.setDefaultTimeout(0);

const totals={indexed:0,failed:0,byReason:{}};
for(let i=0;i<pdfs.length;i+=BATCH){
  const slice=pdfs.slice(i,i+BATCH).map(fp=>{
    const rel=path.relative(DISK_ROOT,fp).replace(/\\/g,'/');
    return {inApp: APP_ROOT+'/'+rel, b64: readFileSync(fp).toString('base64')};
  });
  const res=await page.evaluate(async(items)=>{
    const ms=(await import('/src/platform/rag/MemoryService.ts')).MemoryService;
    const out=[];
    for(const it of items){
      try{
        const bin=atob(it.b64); const bytes=new Uint8Array(bin.length); for(let j=0;j<bin.length;j++)bytes[j]=bin.charCodeAt(j);
        const r=await ms.indexPdfFile(it.inApp,{readBinary:async()=>bytes.buffer});
        out.push({indexed:r.indexed,reason:r.reason||null});
      }catch(e){ out.push({indexed:false,reason:'throw:'+String(e&&e.message||e).slice(0,60)}); }
    }
    return out;
  },slice);
  for(const r of res){ if(r.indexed)totals.indexed++; else {totals.failed++; totals.byReason[r.reason||'?']=(totals.byReason[r.reason||'?']||0)+1;} }
  console.error(`  ${Math.min(i+BATCH,pdfs.length)}/${pdfs.length}  indexed=${totals.indexed} failed=${totals.failed}`);
}
console.log(JSON.stringify(totals,null,2));
await browser.close().catch(()=>{});

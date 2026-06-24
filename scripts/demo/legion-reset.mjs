#!/usr/bin/env node
// legion-reset.mjs — CLEAN SLATE for fresh demo/QA testing.
// Wipes ALL localStorage residue (accumulated client-maps, ai-chat threads, stale
// workspaces, etc.) THEN lays down ONLY the legit demo seed (advisor profession,
// PDF+OCR+memory on, the 26 Northcrest clients with relative folderPaths, the
// Northcrest workspace in recents). The AI key lives in the OS keychain, so it
// survives the wipe. Run this, then FORCE-kill the app and delete the workspace
// .keepance index dir before restarting (see legion-clean-reset.sh).
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
const mattersPath = process.argv.find((a) => a.endsWith('.json')) || 'C:/northcrest_matters.json';
const WS_PATH = 'C:/keepance-demo-northcrest/Northcrest Wealth Partners';
const WS_NAME = 'Northcrest Wealth Partners';
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const matters = JSON.parse(readFileSync(mattersPath,'utf8'));
const browser = await getBrowser(); const page = pickPage(browser);
if(!page){console.error('no page');process.exit(2);}
const out = await page.evaluate(({matters,wsPath,wsName})=>{
  const beforeKeys = localStorage.length;
  localStorage.clear();
  localStorage.setItem('keepance_profession','advisor');
  localStorage.setItem('keepance_onboarding_complete','true');
  localStorage.setItem('keepance:settings', JSON.stringify({state:{values:{memoryEnabled:true,includePdfsInWorkspaceIndex:true,ocrScannedPdfs:true}},version:0}));
  localStorage.setItem('keepance:matters', JSON.stringify({state:{matters:matters,activeMatterId:null},version:5}));
  localStorage.setItem('keepance_recent_workspaces', JSON.stringify([{path:wsPath,name:wsName,lastOpened:new Date().toISOString()}]));
  return {beforeKeys, afterKeys:localStorage.length, matters:matters.length};
},{matters,wsPath:WS_PATH,wsName:WS_NAME});
console.log(JSON.stringify(out,null,2));
await browser.close().catch(()=>{});

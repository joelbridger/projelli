#!/usr/bin/env node
// Surgical, DURABLE clean-slate for the in-memory session: remove ONLY accumulated
// test residue (client maps, ai-chat threads, per-workspace UI snapshots/tabs) and
// KEEP all legit config (API key, default model/provider, matters, settings, profile,
// recents). Then reload the page so the stores rehydrate from the reduced localStorage.
// No app kill => no WebView2 flush race. The .keepance vector index is untouched
// (already freshly rebuilt), so no re-index needed.
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);
const before=await page.evaluate(()=>{
  const removed=[];
  const exactKill=new Set(['keepance:client-maps','ai-chat-storage','keepance:matter-ui-snapshots','keepance:client-map-templates','workspace_versions']);
  const keys=[];for(let i=0;i<localStorage.length;i++)keys.push(localStorage.key(i));
  for(const k of keys){
    if(exactKill.has(k) || /^workspace_(tabs|expanded)_/.test(k)){ localStorage.removeItem(k); removed.push(k); }
  }
  return {removed, remaining:localStorage.length, hasKey:!!localStorage.getItem('apiKey_openai'), hasMatters:!!localStorage.getItem('keepance:matters')};
});
console.log(JSON.stringify(before,null,2));
// reload so stores rehydrate from the reduced localStorage (preview-safe; no Vite)
await page.evaluate(()=>location.reload());
await page.waitForTimeout(4000);
const after=await page.evaluate(()=>({keys:localStorage.length, clientMaps:!!localStorage.getItem('keepance:client-maps'), aiChat:!!localStorage.getItem('ai-chat-storage'), hasKey:!!localStorage.getItem('apiKey_openai')}));
console.log(JSON.stringify({afterReload:after},null,2));
await browser.close().catch(()=>{});

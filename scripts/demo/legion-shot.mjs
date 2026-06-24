#!/usr/bin/env node
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
const TESTID = process.argv[2]; const OUT = process.argv[3] || 'C:/keepance/shot.jpeg';
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);
if(TESTID){ try{ await page.evaluate((t)=>{const el=document.querySelector(`[data-testid="${t}"]`); if(el)el.scrollIntoView({block:'start'});}, TESTID); await page.waitForTimeout(800);}catch(e){} }
await page.screenshot({path:OUT,type:'jpeg',quality:80});
console.log('shot -> '+OUT);
await browser.close().catch(()=>{});

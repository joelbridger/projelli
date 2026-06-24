#!/usr/bin/env node
// Definitive Ask/B1 test: ask one grounded question, wait for it to settle,
// report the LAST turn's question, answer snippet, citation-chip count, and
// whether it shows the green attestation or the "Not cited" warning.
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
const Q = process.argv[2] || 'What is the total portfolio value for this household?';
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);
const out={asked:Q};
try{
  const before=await page.$$eval('[data-testid="ask-uncited-warning"],[data-testid="ask-cited-attestation"]',els=>els.length).catch(()=>0);
  // prefer the composer; fall back to hub input
  let sel='[data-testid="ask-composer-input"]';
  if(!(await page.$(sel))) sel='[data-testid="hub-ask-input"]';
  await page.fill(sel,Q);
  await page.press(sel,'Enter').catch(async()=>{await page.click('[data-testid="hub-ask-submit"]').catch(()=>{});});
  // wait until a new turn settles (attestation+warning total grows AND no "Answering")
  let settled=false;
  for(let i=0;i<40;i++){
    await page.waitForTimeout(1000);
    const cur=await page.$$eval('[data-testid="ask-uncited-warning"],[data-testid="ask-cited-attestation"]',els=>els.length).catch(()=>0);
    const answering=await page.evaluate(()=>/Answering…|Answering\.\.\./.test(document.body.innerText)).catch(()=>false);
    if(cur>before && !answering){settled=true;break;}
  }
  out.settled=settled;
  out.totalAttestations=await page.$$eval('[data-testid="ask-cited-attestation"]',e=>e.length).catch(()=>0);
  out.totalUncitedWarnings=await page.$$eval('[data-testid="ask-uncited-warning"]',e=>e.length).catch(()=>0);
  out.totalCitationChips=await page.$$eval('[data-testid^="ask-citation-chip-"]',e=>e.length).catch(()=>0);
  // last turn answer text: grab the last answer paragraph-ish text
  out.lastAnswer=await page.evaluate(()=>{
    const warns=[...document.querySelectorAll('[data-testid="ask-uncited-warning"],[data-testid="ask-cited-attestation"]')];
    const last=warns[warns.length-1];
    if(!last)return null;
    // the answer text is the previous sibling block in the turn
    let p=last.parentElement; let txt='';
    while(p && txt.length<400){txt=(p.innerText||'').trim();p=p.parentElement;if(txt.length>40)break;}
    return txt.slice(0,400);
  }).catch(()=>null);
}catch(e){out.err=String(e.message||e);}
console.log(JSON.stringify(out,null,2));
await browser.close().catch(()=>{});

#!/usr/bin/env node
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
async function getBrowser(){const i=await(await fetch(`${BASE}/json/version`)).json();const ws=i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//,`ws://localhost:${PORT}/`);return chromium.connectOverCDP(ws);}
function pickPage(b){const p=b.contexts().flatMap(c=>c.pages());return p.find(x=>/localhost:5173/.test(x.url())&&!/connector|account-window/i.test(x.url()))||p.find(x=>/localhost:5173/.test(x.url()))||p[0]||null;}
const browser=await getBrowser();const page=pickPage(browser);
const result=await page.evaluate(async()=>{
  const inv=window.__TAURI__&&(window.__TAURI__.core?.invoke||window.__TAURI__.invoke);
  if(!inv)return{error:'no invoke'};
  const ext=p=>{const m=/\.([a-z0-9]+)$/i.exec(p||'');return m?m[1].toLowerCase():'(none)';};
  const queries=[
    'Form ADV brochure disclosure compliance',
    'Schwab account statement account holdings',
    'tax return 1040 income deductions',
    'RightCapital financial plan retirement projection',
    'estate trust insurance beneficiary',
    'meeting notes review portfolio rebalance',
  ];
  const extTag={}; const pdfSamples=[]; let ocrCount=0; const allTag={};
  for(const q of queries){
    let hits=[];
    try{hits=await inv('rag_retrieve',{query:q,topK:40,scope:{kind:'allMatters'},includePrivileged:false});}catch(e){return{error:String(e),q};}
    for(const h of hits){
      const e=ext(h.path); const mid=h.matterId||'(none)';
      extTag[e]=(extTag[e]||0)+1; allTag[mid]=(allTag[mid]||0)+1;
      if(h.extraction==='ocr')ocrCount++;
      if(e==='pdf'&&pdfSamples.length<8)pdfSamples.push({mid,ocr:h.extraction||'native',path:String(h.path).split(/[\\/]/).slice(-2).join('/')});
    }
  }
  // scoped to Hollings, pdf-ish query
  let hollPdf=0,hollAny=0;
  try{const hs=await inv('rag_retrieve',{query:'Schwab statement holdings RightCapital plan estate trust business exit',topK:20,scope:{kind:'matter',matterId:'matter_nc_hollings_family'},includePrivileged:false});hollAny=hs.length;hollPdf=hs.filter(h=>ext(h.path)==='pdf').length;}catch(e){}
  return{extTag,tagBreakdown:allTag,ocrChunks:ocrCount,pdfSamples,hollingsScoped:{total:hollAny,pdf:hollPdf}};
}).catch(e=>({evalError:String(e)}));
console.log(JSON.stringify(result,null,2));
await browser.close().catch(()=>{});

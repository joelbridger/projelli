// Real-browser settle for the two render sinks jsdom cannot execute:
//   S3/S9 — mermaid strict-mode SVG injection (jsdom lacks SVGElement.getBBox)
//   S17   — the PDF preview iframe sandbox (does it block script yet still load a
//           PDF blob?)
//
// Run: node tests/security/browser-settle.mjs   (from the worktree root)
// Uses the installed mermaid bundle (pinned ^11.14.0) and Playwright's chromium.
// Fabricated malicious inputs only. Exits non-zero if any assertion fails.

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const MERMAID_UMD = readFileSync(path.join(ROOT, 'node_modules/mermaid/dist/mermaid.min.js'), 'utf8');

// The render-agnostic detector, inlined so it runs inside the page (same logic
// as tests/security/renderSinkInjection.ts / the S2 markdown detector).
const DETECTOR = `
function findInjections(root) {
  const problems = [];
  if (root.querySelectorAll('script').length) problems.push('<script> present');
  for (const tag of ['iframe','object','embed']) if (root.querySelectorAll(tag).length) problems.push('<'+tag+'> present');
  const all = Array.from(root.querySelectorAll('*'));
  for (const el of all) for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name)) problems.push('handler '+a.name+' on '+el.tagName.toLowerCase());
  for (const el of all) for (const name of ['href','src','xlink:href']) {
    const raw = el.getAttribute(name); if (raw == null || raw === '') continue;
    const norm = raw.replace(/[\\u0000-\\u0020\\u007F-\\u009F]+/g,'').toLowerCase();
    const scheme = /^([a-z][a-z0-9+.-]*):/.exec(norm)?.[1];
    if (scheme === undefined) continue;
    const isImg = name === 'src' || name === 'xlink:href';
    const ok = ['http','https','mailto','tel'].includes(scheme) || /^data:image\\/(png|jpe?g|gif|webp|avif|bmp);/.test(norm) || (isImg && (/^data:application\\/octet-stream;/.test(norm) || scheme==='blob'));
    if (!ok) problems.push('scheme in '+name+'="'+raw+'"');
  }
  return problems;
}
`;

const failures = [];
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name} ${detail}`); failures.push(name); }
}

const MERMAID_PAYLOADS = [
  { name: 'node label with <img onerror>', src: 'flowchart TD\n  A["<img src=x onerror=\'window.__M__=1\'>"] --> B["ok"]' },
  { name: 'node label with <script>', src: 'flowchart TD\n  A["<script>window.__M__=1</script>"] --> B["ok"]' },
  { name: 'click directive → javascript: link', src: 'flowchart TD\n  A["node"] --> B["ok"]\n  click A "javascript:window.__M__=1" _self' },
  { name: 'edge label with <img onerror>', src: 'flowchart TD\n  A -->|"<img src=x onerror=\'window.__M__=1\'>"| B' },
];

const run = async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');
  await page.addScriptTag({ content: MERMAID_UMD });
  await page.addScriptTag({ content: DETECTOR + '\nwindow.findInjections = findInjections;' });

  // ---- S3/S9: mermaid strict mode must be inert -------------------------------
  console.log('\n== S3/S9 mermaid strict-mode injection ==');
  for (const p of MERMAID_PAYLOADS) {
    const res = await page.evaluate(async ({ src, id }) => {
      window.__M__ = 0;
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      let svg = '';
      try { ({ svg } = await window.mermaid.render(id, src)); } catch (e) { return { error: String(e && e.message || e) }; }
      const host = document.getElementById('host');
      host.innerHTML = svg;
      // Fire events an injected handler might use.
      for (const el of Array.from(host.querySelectorAll('*'))) for (const t of ['error','load','click','mouseover']) { try { el.dispatchEvent(new Event(t, { bubbles: true })); } catch {} }
      const problems = window.findInjections(host);
      const canary = Number(window.__M__ || 0);
      host.innerHTML = '';
      return { problems, canary, rendered: svg.length > 0 };
    }, { src: p.src, id: 'mmd-' + Math.random().toString(36).slice(2) });

    if (res.error) { check(`strict renders "${p.name}"`, false, res.error); continue; }
    check(`strict "${p.name}" — rendered an SVG`, res.rendered);
    check(`strict "${p.name}" — no injection sinks`, res.problems.length === 0, JSON.stringify(res.problems));
    check(`strict "${p.name}" — canary did NOT fire`, res.canary === 0);
  }

  // ---- NEGATIVE CONTROL 1: detector is non-vacuous (raw injection) ------------
  console.log('\n== NEGATIVE CONTROL: detector catches a raw injection ==');
  const rawCatch = await page.evaluate(() => {
    const host = document.getElementById('host');
    host.innerHTML = '<div><img src=x onerror="window.__M__=1"><a href="javascript:1">x</a></div>';
    const problems = window.findInjections(host);
    host.innerHTML = '';
    return problems;
  });
  check('detector flags raw <img onerror> + javascript: link', rawCatch.length >= 2, JSON.stringify(rawCatch));

  // ---- NEGATIVE CONTROL 2: loose mode (guard neutered) — report contrast ------
  console.log('\n== NEGATIVE CONTROL: mermaid loose mode (securityLevel neutered) ==');
  const loose = await page.evaluate(async () => {
    window.__M__ = 0;
    window.mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
    let svg = '';
    try { ({ svg } = await window.mermaid.render('loosemmd', 'flowchart TD\n  A["node"] --> B\n  click A "javascript:window.__M__=1" _self')); } catch (e) { return { error: String(e && e.message || e) }; }
    const host = document.getElementById('host');
    host.innerHTML = svg;
    const problems = window.findInjections(host);
    host.innerHTML = '';
    return { problems };
  });
  // In loose, mermaid binds the click as a javascript: href (or an on* handler) —
  // the detector should catch it. If it does, we have a clean strict-vs-loose
  // contrast proving strict is what neutralizes the payload.
  check('loose mode surfaces the click-directive injection (strict does not)', (loose.problems || []).length > 0, JSON.stringify(loose.problems || loose.error));

  // ---- S17: PDF iframe sandbox blocks script yet does not regress blob loading -
  // NOTE: headless chromium does not run the built-in PDF plugin, so a PDF blob's
  // iframe `onload` is unreliable here. We therefore prove the two things that
  // actually matter and ARE reliable headless: (1) `allow-same-origin` lets a
  // same-origin blob LOAD (via a text/html blob, whose onload is reliable) while
  // (2) BLOCKING its script (no allow-scripts); and (3) adding the sandbox does
  // not change the PDF blob's load outcome vs. the current no-sandbox iframe.
  // Visible PDF pixels are confirmed on the packaged bench (headless can't).
  console.log('\n== S17 PDF iframe sandbox="allow-same-origin" ==');
  const pdf = await page.evaluate(async () => {
    const PDF = '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
    const pdfBlobUrl = URL.createObjectURL(new Blob([PDF], { type: 'application/pdf' }));
    const htmlBlobUrl = URL.createObjectURL(new Blob(['<script>window.parent.__PDFX__=1</script>'], { type: 'text/html' }));
    window.__PDFX__ = 0;

    function frame(src, sandbox) {
      return new Promise((resolve) => {
        const f = document.createElement('iframe');
        if (sandbox !== null) f.setAttribute('sandbox', sandbox);
        let done = false;
        const finish = (r) => { if (!done) { done = true; resolve(r); } };
        f.onload = () => finish('load');
        f.onerror = () => finish('error');
        f.src = src;
        document.body.appendChild(f);
        setTimeout(() => finish('timeout'), 1500);
      });
    }

    const htmlLoad = await frame(htmlBlobUrl, 'allow-same-origin');
    await new Promise((r) => setTimeout(r, 100));
    const pdfNoSandbox = await frame(pdfBlobUrl, null);
    const pdfSandbox = await frame(pdfBlobUrl, 'allow-same-origin');
    return { htmlLoad, scriptRan: Number(window.__PDFX__ || 0), pdfNoSandbox, pdfSandbox };
  });
  check('sandbox="allow-same-origin" LOADS a same-origin blob (html onload fires)', pdf.htmlLoad === 'load', pdf.htmlLoad);
  check('a hostile text/html blob CANNOT run script (no allow-scripts)', pdf.scriptRan === 0, 'scriptRan=' + pdf.scriptRan);
  check('adding sandbox does NOT change the PDF blob load outcome vs no-sandbox', pdf.pdfNoSandbox === pdf.pdfSandbox, `noSandbox=${pdf.pdfNoSandbox} sandbox=${pdf.pdfSandbox}`);

  await browser.close();

  console.log('\n==============================');
  if (failures.length) { console.log(`RESULT: ${failures.length} FAILURE(S): ${failures.join('; ')}`); process.exit(1); }
  console.log('RESULT: ALL BROWSER SETTLES PASSED');
};

run().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(2); });

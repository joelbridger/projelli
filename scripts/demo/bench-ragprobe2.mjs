import { getPage } from '../robot/connection.mjs';
const page = await getPage();
const Q = process.env.Q || 'What did Thomas Brennan email me about his retirement accounts?';
const res = await page.evaluate(async (q) => {
  const out = {};
  for (const tk of [20, 60]) {
    const hits = await window.__TAURI__.core.invoke('rag_retrieve', {
      query: q, topK: tk, scope: { kind: 'allMatters' }, includePrivileged: true,
    });
    const mail = hits.filter((h) => h.sourceType === 'mail' || (h.path || '').startsWith('mail:'));
    out['topK_' + tk] = {
      total: hits.length, mailCount: mail.length,
      mailHits: mail.slice(0, 10).map((h) => ({ path: (h.path || '').slice(0, 60), score: h.score, text: (h.text || h.snippet || '').replace(/\s+/g, ' ').slice(0, 90) })),
    };
  }
  return out;
}, Q);
console.log(JSON.stringify(res, null, 2));
process.exit(0);

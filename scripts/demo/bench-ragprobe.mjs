import { getPage } from '../robot/connection.mjs';
const page = await getPage();
const Q = process.env.Q || 'Thomas Brennan Roth conversion retirement IRA';
const res = await page.evaluate(async (q) => {
  try {
    const hits = await window.__TAURI__.core.invoke('rag_retrieve', {
      query: q, topK: 12, scope: { kind: 'allMatters' }, includePrivileged: true,
    });
    return {
      ok: true, n: hits.length,
      mail: hits.filter((h) => h.sourceType === 'mail' || (h.path || '').startsWith('mail:')).length,
      sample: hits.slice(0, 8).map((h) => ({ st: h.sourceType, path: (h.path || '').slice(0, 50), score: h.score, text: (h.text || h.snippet || '').slice(0, 70) })),
    };
  } catch (e) { return { ok: false, err: String(e) }; }
}, Q);
console.log(JSON.stringify(res, null, 2));
process.exit(0);

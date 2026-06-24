// scripts/robot/verbs/isolation.mjs
// Verb: verify_isolation — prove RAG retrieval stays inside each matter scope.
//
// matter_id is the security isolation key (the Rust layer hard-filters by it).
// Codex review caught that the old check could pass on an EMPTY index (zero hits =
// zero leaks = vacuous green). This version requires:
//   - every positive case to actually retrieve >= minHits AND leak nothing, and
//   - an adversarial case: a HOLLINGS-only query scoped to WEBB returns ZERO
//     Hollings docs, with a CONTROL proving that same query DOES return Hollings
//     docs when scoped to Hollings (so "zero leak" is meaningful, not vacuous).

export const POSITIVE_CASES = [
  { key: 'hollings', label: 'hollings/all-types', query: 'goals retirement estate trust portfolio holdings statement tax meeting', matterId: 'matter_nc_hollings_family', mustContain: 'Hollings Family', minHits: 1 },
  { key: 'webb', label: 'webb/all-types', query: 'goals retirement estate portfolio holdings statement tax meeting', matterId: 'matter_nc_webb_marcus_tanya', mustContain: 'Webb, Marcus', minHits: 1 },
  { key: 'voss', label: 'voss/all-types', query: 'goals retirement estate portfolio holdings statement tax meeting', matterId: 'matter_nc_voss_eleanor', mustContain: 'Voss, Eleanor', minHits: 1 },
  { key: 'q_business', label: 'Q: business exit', query: 'business exit Hollings Capital Partners concentration deal readiness', matterId: 'matter_nc_hollings_family', mustContain: 'Hollings Family', minHits: 1 },
  { key: 'q_daf', label: 'Q: DAF grants', query: 'donor advised fund DAF grant request charitable board meeting', matterId: 'matter_nc_hollings_family', mustContain: 'Hollings Family', minHits: 1 },
];

export const ADVERSARIAL = {
  key: 'isolation_webb',
  query: 'Cascade Fund IV capital call Hollings business exit',
  webbMatter: 'matter_nc_webb_marcus_tanya',
  controlMatter: 'matter_nc_hollings_family',
  foreign: 'Hollings', // path substring identifying the OTHER client's docs
};

/**
 * @param {import('playwright').Page} page
 * @param {{ cases?: any[], adversarial?: any }} args
 */
export async function verifyIsolation(page, args = {}) {
  const positiveCases = args.cases ?? POSITIVE_CASES;
  const adv = args.adversarial ?? ADVERSARIAL;

  const data = await page.evaluate(
    async ({ positiveCases, adv }) => {
      const inv = window.__TAURI__ && (window.__TAURI__.core?.invoke || window.__TAURI__.invoke);
      if (!inv) throw new Error('window.__TAURI__.invoke is not available');
      const lc = (s) => String(s || '').toLowerCase();
      const ext = (p) => { const m = /\.([a-z0-9]+)$/i.exec(p || ''); return m ? m[1].toLowerCase() : '?'; };

      const retrieve = (query, matterId) =>
        inv('rag_retrieve', {
          query,
          topK: 15,
          scope: matterId ? { kind: 'matter', matterId } : { kind: 'allMatters' },
          includePrivileged: false,
        });

      const summarize = (hits, mustContain, foreign) => {
        const exts = {}; const srcs = new Set(); let leak = 0; let foreignHits = 0;
        for (const h of hits) {
          exts[ext(h.path)] = (exts[ext(h.path)] || 0) + 1;
          srcs.add(String(h.path).split(/[\\/]/).slice(-2).join('/'));
          if (mustContain && !lc(h.path).includes(lc(mustContain))) leak++;
          if (foreign && lc(h.path).includes(lc(foreign))) foreignHits++;
        }
        return { count: hits.length, leak, foreignHits, exts, sample: [...srcs].slice(0, 4) };
      };

      const positives = {};
      for (const c of positiveCases) {
        const key = c.key || c.label;
        try { positives[key] = { label: c.label, minHits: c.minHits ?? 1, ...summarize(await retrieve(c.query, c.matterId), c.mustContain) }; }
        catch (e) { positives[key] = { label: c.label, err: String(e.message || e) }; }
      }

      let adversarial;
      try {
        const webb = summarize(await retrieve(adv.query, adv.webbMatter), null, adv.foreign);
        const control = summarize(await retrieve(adv.query, adv.controlMatter), null, adv.foreign);
        adversarial = { webb, control };
      } catch (e) { adversarial = { err: String(e.message || e) }; }

      return { positives, adversarial };
    },
    { positiveCases, adv },
  );

  // ok requires: every positive case actually retrieved (>= minHits) AND leaked
  // nothing; AND the adversarial Webb scope returned hits but ZERO Hollings docs;
  // AND the control proves the Hollings term is genuinely retrievable (>=1 Hollings
  // doc under Hollings scope) — so "zero leak under Webb" is a real guarantee.
  const positivesOk = Object.values(data.positives).every(
    (r) => !r.err && r.count >= (r.minHits ?? 1) && r.leak === 0,
  );
  const a = data.adversarial;
  const adversarialOk =
    !!a && !a.err && a.webb && a.control &&
    a.webb.count >= 1 && a.webb.foreignHits === 0 && a.control.foreignHits >= 1;

  return { ok: positivesOk && adversarialOk, positivesOk, adversarialOk, ...data };
}

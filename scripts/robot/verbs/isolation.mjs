export const DEFAULT_CASES = [
  {
    key: 'hollings',
    label: 'hollings/all-types',
    query: 'goals retirement estate trust portfolio holdings statement tax meeting',
    matterId: 'matter_nc_hollings_family',
    mustContain: 'Hollings Family',
  },
  {
    key: 'webb',
    label: 'webb/all-types',
    query: 'goals retirement estate portfolio holdings statement tax meeting',
    matterId: 'matter_nc_webb_marcus_tanya',
    mustContain: 'Webb, Marcus',
  },
  {
    key: 'voss',
    label: 'voss/all-types',
    query: 'goals retirement estate portfolio holdings statement tax meeting',
    matterId: 'matter_nc_voss_eleanor',
    mustContain: 'Voss, Eleanor',
  },
  {
    // The strict adversarial isolation case: a HOLLINGS-only query scoped to
    // Webb must return ZERO Hollings docs. mustContain:'Webb, Marcus' makes the
    // leak metric real — leak counts any returned hit NOT belonging to Webb
    // (i.e. any cross-matter leak). Without it, leak would be trivially 0 and
    // the check would assert nothing. (matter_id hard-filter is the guarantee.)
    key: 'isolation_webb',
    label: 'Cascade(Hollings-only) scoped to Webb -> expect 0 Hollings leak',
    query: 'Cascade Fund IV capital call Hollings business exit',
    matterId: 'matter_nc_webb_marcus_tanya',
    mustContain: 'Webb, Marcus',
  },
  {
    key: 'q_business',
    label: 'Q: central planning issue / business exit',
    query: 'business exit Hollings Capital Partners concentration deal readiness',
    matterId: 'matter_nc_hollings_family',
    mustContain: 'Hollings Family',
  },
  {
    key: 'q_daf',
    label: 'Q: DAF grants',
    query: 'donor advised fund DAF grant request charitable board meeting',
    matterId: 'matter_nc_hollings_family',
    mustContain: 'Hollings Family',
  },
];

/**
 * Verify RAG retrieval stays inside each requested matter scope.
 *
 * @param {import('playwright').Page} page
 * @param {{ cases?: { key?: string, label: string, query: string, matterId?: string, topK?: number, mustContain?: string }[] }} args
 * @returns {Promise<{ ok: boolean, results: Record<string, { label: string, count?: number, exts?: Record<string, number>, leak?: number, sample?: string[], err?: string }> }>}
 */
export async function verifyIsolation(page, args = {}) {
  const cases = args.cases ?? DEFAULT_CASES;

  const results = await page.evaluate(async (cases) => {
    const inv = window.__TAURI__ && (window.__TAURI__.core?.invoke || window.__TAURI__.invoke);
    if (!inv) throw new Error('window.__TAURI__.invoke is not available');

    const ext = (p) => {
      const m = /\.([a-z0-9]+)$/i.exec(p || '');
      return m ? m[1].toLowerCase() : '?';
    };
    const lc = (s) => String(s || '').toLowerCase();

    const run = async (c) => {
      const scope = c.matterId ? { kind: 'matter', matterId: c.matterId } : { kind: 'allMatters' };
      const hits = await inv('rag_retrieve', {
        query: c.query,
        topK: c.topK ?? 15,
        scope,
        includePrivileged: false,
      });
      const exts = {};
      let leak = 0;
      const srcs = new Set();

      for (const h of hits) {
        exts[ext(h.path)] = (exts[ext(h.path)] || 0) + 1;
        srcs.add(String(h.path).split(/[\\/]/).slice(-2).join('/'));
        if (c.mustContain && !lc(h.path).includes(lc(c.mustContain))) leak++;
      }

      return {
        label: c.label,
        count: hits.length,
        exts,
        leak,
        sample: [...srcs].slice(0, 4),
      };
    };

    const out = {};
    for (const c of cases) {
      const key = c.key || c.label;
      try {
        out[key] = await run(c);
      } catch (e) {
        out[key] = {
          label: c.label,
          err: String(e.message || e),
          leak: Number.POSITIVE_INFINITY,
        };
      }
    }
    return out;
  }, cases);

  return {
    ok: Object.values(results).every((result) => result.leak === 0),
    results,
  };
}

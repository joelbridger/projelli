/**
 * WS1 truth-reconciliation guard (added 2026-06-17).
 *
 * Single-source-of-truth backstop: every LIVE buyer-facing surface must state
 * the same truth about price and trust posture as `src/config/pricing.ts` and
 * `website/security/index.html`. Historical/dated surfaces (blog, changelog,
 * archive) are intentionally excluded — rewriting them would be revisionist.
 *
 * If this fails, the printed list IS the worklist. Plan:
 * docs/superpowers/plans/2026-06-17-ws1-truth-reconciliation.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PRICING_TIERS } from '../../src/config/pricing';

const ROOT = path.resolve(__dirname, '../..');

// Retired pricing — one-time $49/$129/$399, the old $49/$149/$499 + $99/yr
// founding rate. None may appear on a live surface. (Careful: "$49/mo" and
// "$99/mo" are CANONICAL monthly rates and must NOT match.)
const RETIRED = [
  /\$49\s*(one-time|once)/i,
  /\$129\s*one-time/i,
  /\$399\s*one-time/i,
  /\$149\s*\/\s*yr/i,
  /\$499\s*\/\s*yr/i,
  /founding[^.]{0,40}\$99\s*\/\s*yr/i,
];

// Features removed in the 3.0 pivot that must never be advertised as current on
// a live surface (these exact phrasings have zero benign use). Locks the WS1
// removed-feature cleanup so it can't silently regress.
const REMOVED_FEATURES = [
  /plugin marketplace/i,
  /plugin runtime/i,
  /day-one plugins/i,
  /Built-in \(Whiteboards?\)/i,
  /use the whiteboard/i,
  /create-keepance-plugin/i,
  /community-plugins/i,
  /\.whiteboard\b/,
];

function htmlFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) {
      // Node returns backslashes on Windows, so split on either separator.
      // These dated pages are historical records, not live buyer-facing copy.
      if (/(^|[\\/])(blog|changelog|archive)$/.test(p)) continue;
      htmlFiles(p, acc);
    } else if (e.endsWith('.html')) acc.push(p);
  }
  return acc;
}

describe('WS1 truth guard', () => {
  const surfaces = [...htmlFiles(path.join(ROOT, 'website')), path.join(ROOT, 'README.md')];

  it('canonical Solo annual price is 468 (sanity on the source of truth)', () => {
    expect(PRICING_TIERS.find((t) => t.code === 'personal')?.annualPerYear).toBe(468);
  });

  it('no live surface shows retired pricing', () => {
    const hits: string[] = [];
    for (const f of surfaces) {
      const txt = readFileSync(f, 'utf8');
      for (const re of RETIRED) if (re.test(txt)) hits.push(`${path.relative(ROOT, f)} :: ${re}`);
    }
    expect(hits, `\nRetired pricing still live:\n${hits.join('\n')}\n`).toEqual([]);
  });

  it('in-app pricing.ts makes no delivered SOC2/DPA/trust-center claim', () => {
    const txt = readFileSync(path.join(ROOT, 'src/config/pricing.ts'), 'utf8');
    expect(/SOC 2 readiness|signed DPA|trust center/i.test(txt)).toBe(false);
  });

  it('README shows canonical subscription pricing, not the retired one-time prices', () => {
    const txt = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    expect(txt).toMatch(/\$468/);
    expect(/\$49\s*(one-time|once)/i.test(txt)).toBe(false);
  });

  it('no live surface advertises a removed 3.0 feature (plugin marketplace, whiteboard, etc.)', () => {
    const hits: string[] = [];
    for (const f of surfaces) {
      const txt = readFileSync(f, 'utf8');
      for (const re of REMOVED_FEATURES) if (re.test(txt)) hits.push(`${path.relative(ROOT, f)} :: ${re}`);
    }
    expect(hits, `\nRemoved-feature claims still live:\n${hits.join('\n')}\n`).toEqual([]);
  });
});

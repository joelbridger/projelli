import { attachConsoleAndNetwork, captureBundle } from '../artifacts.mjs';

export const DEFAULT_SURFACES = [
  ['spine-nav-settings', 'settings'],
  ['spine-nav-privacy', 'privacy'],
  ['spine-nav-audit', 'audit'],
  ['spine-nav-workflows', 'workflows'],
  ['spine-nav-email', 'email'],
  ['spine-nav-files', 'files'],
];

/**
 * Visit each top-level Keepance surface and capture a quick proof packet.
 *
 * @param {import('playwright').Page} page
 * @param {{ surfaces?: [string, string][], dir?: string }} args
 * @returns {Promise<{ ok: boolean, surfaces: Record<string, { ok: boolean, textHead?: string, err?: string, shot?: string }> }>}
 */
export async function runSurfaceSweep(page, args = {}) {
  const surfaces = args.surfaces ?? DEFAULT_SURFACES;
  const report = {};
  const buffers = attachConsoleAndNetwork(page);

  for (const [testid, name] of surfaces) {
    try {
      await page.click(`[data-testid="${testid}"]`, { timeout: 5000 });
      await page.waitForTimeout(1200);

      let shot;
      if (args.dir) {
        const written = await captureBundle(page, {
          dir: args.dir,
          label: `sw-${name}`,
          buffers,
        });
        shot = written.find((p) => p.endsWith('.jpeg'));
      }

      const txt = await page
        .evaluate(() => document.querySelector('main')?.innerText || document.body.innerText)
        .catch(() => '');

      report[name] = {
        ok: true,
        textHead: txt.replace(/\s+/g, ' ').slice(0, 500),
        ...(shot ? { shot } : {}),
      };
    } catch (e) {
      report[name] = {
        ok: false,
        err: String(e.message || e).slice(0, 120),
      };
    }
  }

  return {
    ok: Object.values(report).every((surface) => surface.ok === true),
    surfaces: report,
  };
}

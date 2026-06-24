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
 * Visit each top-level Keepance surface and prove it actually rendered.
 *
 * Codex review caught that a successful nav CLICK does not prove the target
 * surface rendered (a click that leaves you on the previous surface still
 * "succeeds"). The active spine-nav button carries aria-current="page", so a
 * surface is only ok when its nav item becomes the current page.
 *
 * @param {import('playwright').Page} page
 * @param {{ surfaces?: [string, string][], dir?: string }} args
 */
export async function runSurfaceSweep(page, args = {}) {
  const surfaces = args.surfaces ?? DEFAULT_SURFACES;
  const report = {};
  const buffers = attachConsoleAndNetwork(page);

  for (const [testid, name] of surfaces) {
    try {
      await page.click(`[data-testid="${testid}"]`, { timeout: 5000 });
      // Render proof: the clicked nav item must become the current page.
      const rendered = await page
        .locator(`[data-testid="${testid}"][aria-current="page"]`)
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      await page.waitForTimeout(600);

      let shot;
      if (args.dir) {
        const written = await captureBundle(page, { dir: args.dir, label: `sw-${name}`, buffers });
        shot = written.find((p) => p.endsWith('.jpeg'));
      }

      const txt = await page
        .evaluate(() => document.querySelector('main')?.innerText || document.body.innerText)
        .catch(() => '');

      report[name] = {
        ok: rendered,
        rendered,
        textHead: txt.replace(/\s+/g, ' ').slice(0, 500),
        ...(shot ? { shot } : {}),
      };
    } catch (e) {
      report[name] = { ok: false, err: String(e.message || e).slice(0, 120) };
    }
  }

  return {
    ok: Object.values(report).every((surface) => surface.ok === true),
    surfaces: report,
  };
}

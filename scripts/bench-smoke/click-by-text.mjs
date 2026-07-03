// scripts/bench-smoke/click-by-text.mjs — click an element that was matched by
// visible text rather than a data-testid, built on desktop-drive.mjs's
// existing `eval` command (same reuse rule as console-watch.mjs: no new CDP
// connection). Needed because desktop-drive.mjs's own `click` command only
// accepts a data-testid, but several checks match their target via
// findByText() (parse.mjs) against elements that may not carry a testid at
// all (plain buttons/links with only visible text).
export function clickByTextScript(needle) {
  const escaped = String(needle)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, ' ');
  return (
    "(() => {" +
    `const needle = '${escaped}'.toLowerCase();` +
    "const els = [...document.querySelectorAll('[data-testid], button, a, [role=\"button\"], input, textarea')];" +
    "const match = els.find(e => {" +
    "const t = (e.textContent || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim().toLowerCase();" +
    "return t.includes(needle);" +
    "});" +
    "if (!match) return 'not-found';" +
    "match.click();" +
    "return 'clicked';" +
    "})()"
  );
}

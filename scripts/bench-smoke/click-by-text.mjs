// scripts/bench-smoke/click-by-text.mjs — click an element that was matched by
// visible text rather than a data-testid, built on desktop-drive.mjs's
// existing `eval` command (same reuse rule as console-watch.mjs: no new CDP
// connection). Needed because desktop-drive.mjs's own `click` command only
// accepts a data-testid, but several checks match their target via
// findByText() (parse.mjs) against elements that may not carry a testid at
// all (plain buttons/links with only visible text).
//
// Two-tier search, found necessary live on the Legion bench: interactive
// controls (buttons/links/inputs) are tried first — same restrictive
// selector as desktop-drive.mjs's own snapshot(), so behavior for anything
// snapshot() can already see is unchanged. File-tree rows in the Documents
// view, though, render as plain unstyled <div>/<span> leaves with no
// data-testid and no button/role — snapshot() can't see them at all, so a
// second pass over every leaf element (no element children, i.e. the node
// that actually owns the visible text) is needed to click those. `.click()`
// on any element dispatches a real, bubbling click event, so this reaches
// an ancestor's onClick handler exactly as a user's click would.
export function clickByTextScript(needle, { double = false } = {}) {
  const escaped = String(needle)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, ' ');
  // Live on the Legion bench, a single .click() found and "clicked" a file-tree
  // row (it's a real DOM click, correctly bubbling) but did not open the file
  // — this app's file tree opens on double-click, same as a native file
  // manager. A plain .click() doesn't synthesize the browser's native
  // dblclick-from-two-clicks detection, so double-click needs its own
  // MouseEvent('dblclick') with real coordinates (some libraries key off
  // clientX/clientY rather than trusting the event alone).
  const dispatch = double
    ? "const r = match.getBoundingClientRect();" +
      "match.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));"
    : 'match.click();';
  return (
    "(() => {" +
    `const needle = '${escaped}'.toLowerCase();` +
    "const textOf = (e) => (e.textContent || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim().toLowerCase();" +
    "const controls = [...document.querySelectorAll('[data-testid], button, a, [role=\"button\"], input, textarea')];" +
    "let match = controls.find(e => textOf(e).includes(needle));" +
    "if (!match) {" +
    "const leaves = [...document.querySelectorAll('body *')].filter(e => e.children.length === 0);" +
    "match = leaves.find(e => textOf(e).includes(needle));" +
    "}" +
    "if (!match) return 'not-found';" +
    dispatch +
    "return 'clicked';" +
    "})()"
  );
}

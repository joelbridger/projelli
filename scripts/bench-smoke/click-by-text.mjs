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
  // — Tree view's rows are plain unstyled leaves (no button semantics) and
  // open on double-click, same as a native file manager. A plain .click()
  // doesn't synthesize the browser's native dblclick-from-two-clicks
  // detection, so that path needs its own MouseEvent('dblclick') with real
  // coordinates (some libraries key off clientX/clientY rather than trusting
  // the event alone).
  //
  // Grid view is a DIFFERENT case, found live via an independent Codex
  // review: its file cards ARE real <button> elements that open on a single
  // click (a normal onClick handler). Those match in the `controls` tier
  // below, not the leaf-node fallback — dispatching only a synthetic
  // 'dblclick' at a real button never fires the native 'click' event React's
  // onClick listens for, so the file silently never opens and a caller
  // (openSmokeClientNote) times out waiting for it, misreporting a visible,
  // working file as SETUP-BLOCKED. So `double` is only ever honored for the
  // leaf-node fallback; a matched interactive control always gets a real
  // single click, since that's how every semantic control (buttons, Grid
  // cards, links) actually opens.
  const dblclickDispatch =
    "const r = match.getBoundingClientRect();" +
    "match.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));";
  return (
    "(() => {" +
    `const needle = '${escaped}'.toLowerCase();` +
    "const textOf = (e) => (e.textContent || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim().toLowerCase();" +
    // Root-caused live during the 2026-07-04 bench-full pass: textOf() reads
    // textContent, which cascades up through every ancestor — so a big
    // structural wrapper like `app-container` (data-testid'd, and the FIRST
    // such element in document order) trivially "contains" any needle that
    // appears ANYWHERE on the page, and .find() returned it before ever
    // reaching the real target. That single-click on a giant wrapper is a
    // no-op, silently breaking clickByText/doubleClickByText for nearly any
    // needle that matches real page content (which is most of them) — this
    // is why file-open navigation (openSmokeClientNote and everything
    // downstream of it) was failing. Excluding candidates that have their
    // own nested data-testid descendants filters out structural containers
    // while still matching genuine small controls (a button/link/badge whose
    // own label IS the needle, e.g. Grid view's file-card buttons).
    "const controls = [...document.querySelectorAll('[data-testid], button, a, [role=\"button\"], input, textarea')]" +
    ".filter(e => e.querySelectorAll('[data-testid]').length === 0);" +
    "let match = controls.find(e => textOf(e).includes(needle));" +
    "let isControl = !!match;" +
    "if (!match) {" +
    "const leaves = [...document.querySelectorAll('body *')].filter(e => e.children.length === 0);" +
    "match = leaves.find(e => textOf(e).includes(needle));" +
    "}" +
    "if (!match) return 'not-found';" +
    `if (isControl || !${JSON.stringify(double)}) { match.click(); } else { ${dblclickDispatch} }` +
    "return 'clicked';" +
    "})()"
  );
}

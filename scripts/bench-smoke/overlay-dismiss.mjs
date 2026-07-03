// scripts/bench-smoke/overlay-dismiss.mjs — best-effort dismissal of a
// blocking modal/overlay left open from a PRIOR session (found live: the
// Legion bench can persist a client-management dialog or onboarding tour
// across app restarts, and its backdrop div intercepts every click meant for
// the app underneath — every click-based check would otherwise time out).
// Built on the existing `eval` command (same reuse pattern as console-watch.mjs
// and click-by-text.mjs): dispatches a real Escape keydown/keyup, which every
// dialog primitive this app uses (Radix-based, per package.json) closes on.
export function dismissOverlayScript() {
  return (
    "(() => {" +
    "const before = document.querySelectorAll('[data-state=\"open\"]').length;" +
    "const opts = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true };" +
    "document.dispatchEvent(new KeyboardEvent('keydown', opts));" +
    "document.dispatchEvent(new KeyboardEvent('keyup', opts));" +
    // Fallback, confirmed necessary live: this app's "Draft follow-up" modal
    // does NOT close on Escape (it's not the same Radix-based dialog
    // primitive the [data-state="open"] overlays above are) but stayed open
    // across checks and blocked a later check's click. Its first <button> is
    // the icon-only close (X) control, confirmed by clicking it and seeing
    // the modal disappear. Best-effort, bounded to modal/dialog CONTAINERS
    // only (never the whole page) — worst case on an unfamiliar modal this
    // clicks something other than close, but this is priming-step hygiene to
    // unblock automation between checks, not a user-facing action.
    "const dialogs = [...document.querySelectorAll('[role=\"dialog\"], [data-testid$=\"-modal\"]')];" +
    "for (const d of dialogs) { const btn = d.querySelector('button'); if (btn) btn.click(); }" +
    "const after = document.querySelectorAll('[data-state=\"open\"]').length;" +
    "return { before, after, dialogsClosed: dialogs.length };" +
    "})()"
  );
}

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
    //
    // Prefer a button explicitly labeled as a close control (aria-label
    // matching /close/i) over blindly taking the first button. Root-caused
    // live (2026-07-04): the Account modal's first button in DOM order is
    // "Upload photo" — a real native OS file-picker trigger, not a close
    // action — and blindly clicking it opened a native file dialog that
    // silently blocked CDP from seeing the app's true state for the rest of
    // the session. The Account modal's actual close control is a later,
    // icon-only button with aria-label="Close". Falls back to the first
    // button (old behavior) when no aria-label="Close" button exists, which
    // is what the Draft-follow-up modal above still needs.
    "const dialogs = [...document.querySelectorAll('[role=\"dialog\"], [data-testid$=\"-modal\"]')];" +
    "for (const d of dialogs) {" +
    "const buttons = [...d.querySelectorAll('button')];" +
    "const btn = buttons.find(b => /close/i.test(b.getAttribute('aria-label') || '')) || buttons[0];" +
    "if (btn) btn.click();" +
    "}" +
    "const after = document.querySelectorAll('[data-state=\"open\"]').length;" +
    "return { before, after, dialogsClosed: dialogs.length };" +
    "})()"
  );
}

/**
 * Notice Card — Microsoft Teams web-client join adapter.
 *
 * Drives the Teams web prejoin screen as an anonymous guest: fill the display
 * name, mute the mic, click "Join now", then read whether we're in the lobby,
 * admitted, or declined.
 *
 * SELECTORS ARE GROUNDED IN A REAL CAPTURE (2026-07-06) of today's Teams web
 * join page — see `coordination/qa-campaign/evidence/qa91b-teams-adapter/`.
 * That capture fixed QA-91b: the previous selectors no longer matched, so
 * `detectPhase` sat in `loading` and the in-page runner reported
 * `page-unrecognized` after ~29s without ever knocking on the host's lobby.
 *
 * The current prejoin lives under a single region container
 * `[data-tid="calling-prejoin-screen"]`; the mic is now a `role="switch"`
 * checkbox (`toggle-mute`, state in `data-cid="toggle-mute-<bool>"` /
 * `aria-checked`), and the join control is still `[data-tid="prejoin-join-button"]`.
 * We recognize the prejoin by the CONTAINER (not the name field) so a drift in
 * the name input degrades to `ready-to-join` (still clicks Join) instead of a
 * hard `page-unrecognized`. Old selectors are kept as secondary fallbacks
 * because Teams web ships variants.
 *
 * VERIFY-LIVE: the lobby / admitted / denied states could not be driven from the
 * server bench (single shared signed-in profile + passcode-gated link), so those
 * use multi-signal detection (data-tid + aria-label + text) with the old
 * selectors retained; the Legion live retest confirms them end-to-end.
 *
 * Every method is self-contained (DOM-only, no imports, no module closures) so
 * the exact source can be serialized into the injected webview script.
 */
import type { JoinAdapter } from './adapterTypes';

// Prejoin recognizer — the region that wraps the whole prejoin. Primary is the
// current `calling-prejoin-screen`; the bare `prejoin-join-button` and the
// legacy `prejoin-screen` are kept so either variant is recognized.
const PREJOIN_SELECTOR =
  '[data-tid="calling-prejoin-screen"], [data-tid="prejoin-join-button"], [data-tid="prejoin-screen"]';
// Guest name field — current + legacy tids; anonymous flow only.
const NAME_SELECTOR =
  '[data-tid="prejoin-display-name-input"], input[data-tid="prejoin-display-name-input"], [data-tid="calling-prejoin-display-name-input"]';
const JOIN_SELECTOR = '[data-tid="prejoin-join-button"]';
const MUTE_SELECTOR = '[data-tid="toggle-mute"]';
const LOBBY_SELECTOR =
  '[data-tid="calling-lobby-screen"], [data-tid="lobby-screen-title"], [data-tid="lobby-screen"], [data-tid="calling-lobby"]';
const ADMITTED_SELECTOR =
  '[data-tid="hangup-button"], [data-tid="call-hangup"], [data-tid="calling-retention-banner"], [data-tid="calling-composite-inner-container"]';
const DENIED_SELECTOR =
  '[data-tid="rejoin-title"], [data-tid="cannot-join-title"], [data-tid="calling-declined-screen"]';

export const teamsAdapter: JoinAdapter = {
  platform: 'teams',

  detectPhase(doc) {
    // Terminal / late states win over a lingering prejoin form.
    if (
      doc.querySelector(
        '[data-tid="hangup-button"], [data-tid="call-hangup"], [data-tid="calling-retention-banner"], [data-tid="calling-composite-inner-container"]',
      )
    ) {
      return 'admitted';
    }
    if (
      doc.querySelector(
        '[data-tid="rejoin-title"], [data-tid="cannot-join-title"], [data-tid="calling-declined-screen"]',
      )
    ) {
      return 'denied';
    }
    // Lobby: a dedicated tid, or the unambiguous "let you in" waiting copy.
    if (
      doc.querySelector(
        '[data-tid="calling-lobby-screen"], [data-tid="lobby-screen-title"], [data-tid="lobby-screen"], [data-tid="calling-lobby"]',
      ) ||
      /someone (?:in the meeting )?(?:should|will) let you in|waiting for the host|when the meeting starts, we[’']?ll let/i.test(
        (doc.body && (doc.body.innerText || doc.body.textContent)) || '',
      )
    ) {
      return 'lobby';
    }
    // Prejoin recognized by its container (survives a name-field drift), OR by
    // the join button, OR the legacy prejoin container.
    const inPrejoin = doc.querySelector(
      '[data-tid="calling-prejoin-screen"], [data-tid="prejoin-join-button"], [data-tid="prejoin-screen"]',
    );
    if (inPrejoin) {
      // MUST use the SAME name-field lookup as fillGuestName, or a drifted name
      // tid would read as ready-to-join here and the card would JOIN NAMELESS
      // (the runner only fills the name during 'name-entry'). The helper is
      // duplicated locally on purpose: these methods are serialized standalone
      // into the webview (see injectionScript.ts), so a module-scope helper
      // would be undefined there — keep it inline, keep it identical.
      const findNameField = (d: Document): HTMLInputElement | null => {
        const byTid = d.querySelector(
          '[data-tid="prejoin-display-name-input"], input[data-tid="prejoin-display-name-input"], [data-tid="calling-prejoin-display-name-input"]',
        );
        if (byTid instanceof HTMLInputElement) return byTid;
        const region = d.querySelector('[data-tid="calling-prejoin-screen"], [data-tid="prejoin-screen"]');
        const scope = region || d;
        const candidates = scope.querySelectorAll('input[type="text"], input:not([type])');
        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i];
          if (!(c instanceof HTMLInputElement)) continue;
          const hint = (
            (c.getAttribute('aria-label') || '') +
            ' ' +
            (c.getAttribute('placeholder') || '')
          ).toLowerCase();
          if (hint.includes('name')) return c;
        }
        return null;
      };
      const name = findNameField(doc);
      if (name) {
        return name.value.trim() ? 'ready-to-join' : 'name-entry';
      }
      // No name field found at all — the signed-in account flow uses the account
      // card by design, so the page is still a ready-to-join prejoin.
      return 'ready-to-join';
    }
    return 'loading';
  },

  fillGuestName(doc, displayName) {
    // Identical name-field lookup to detectPhase (see the note there): kept inline
    // and in sync so both agree on where the "Recording Notice" name goes.
    const findNameField = (d: Document): HTMLInputElement | null => {
      const byTid = d.querySelector(
        '[data-tid="prejoin-display-name-input"], input[data-tid="prejoin-display-name-input"], [data-tid="calling-prejoin-display-name-input"]',
      );
      if (byTid instanceof HTMLInputElement) return byTid;
      const region = d.querySelector('[data-tid="calling-prejoin-screen"], [data-tid="prejoin-screen"]');
      const scope = region || d;
      const candidates = scope.querySelectorAll('input[type="text"], input:not([type])');
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (!(c instanceof HTMLInputElement)) continue;
        const hint = (
          (c.getAttribute('aria-label') || '') +
          ' ' +
          (c.getAttribute('placeholder') || '')
        ).toLowerCase();
        if (hint.includes('name')) return c;
      }
      return null;
    };
    const input = findNameField(doc);
    if (!input) return false;
    // React controls the value; set via the native setter, then fire `input`
    // so React's onChange sees it (a plain assignment is silently overwritten).
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc && desc.set) {
      desc.set.call(input, displayName);
    } else {
      input.value = displayName;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },

  ensureMuted(doc) {
    const toggle = doc.querySelector('[data-tid="toggle-mute"]');
    if (!(toggle instanceof HTMLElement)) return false;
    // A disabled toggle (e.g. no mic device) can't be actioned; report handled.
    const disabled =
      (toggle instanceof HTMLInputElement && toggle.disabled) ||
      toggle.getAttribute('aria-disabled') === 'true';
    // Read the current state from, in order of reliability:
    //  1. data-cid="toggle-mute-<bool>"  (-true = muted, -false = unmuted)
    //  2. aria-checked on the role="switch" (false = mic off = muted)
    //  3. legacy aria-pressed / an "unmute" label
    const cid = (toggle.getAttribute('data-cid') || '').toLowerCase();
    const ariaChecked = toggle.getAttribute('aria-checked');
    const label = (toggle.getAttribute('aria-label') ?? '').toLowerCase();
    let muted: boolean;
    if (cid === 'toggle-mute-true') {
      muted = true;
    } else if (cid === 'toggle-mute-false') {
      muted = false;
    } else if (ariaChecked === 'false') {
      // switch "off" = mic disabled = already muted
      muted = true;
    } else if (ariaChecked === 'true') {
      muted = false;
    } else {
      // legacy button: aria-pressed=true or an "unmute" label means muted
      muted = toggle.getAttribute('aria-pressed') === 'true' || label.includes('unmute');
    }
    if (!muted && !disabled) toggle.click();
    return true;
  },

  clickJoin(doc) {
    let btn = doc.querySelector('[data-tid="prejoin-join-button"]');
    // Fallback: a button labelled "Join now" / "Join" inside the prejoin region.
    if (!(btn instanceof HTMLButtonElement)) {
      const region = doc.querySelector('[data-tid="calling-prejoin-screen"], [data-tid="prejoin-screen"]');
      const scope = region || doc;
      const buttons = scope.querySelectorAll('button');
      for (let i = 0; i < buttons.length; i++) {
        const b = buttons[i];
        if (!b) continue;
        const text = (
          (b.textContent || '') +
          ' ' +
          (b.getAttribute('aria-label') || '')
        ).toLowerCase();
        if (/\bjoin\b/.test(text)) {
          btn = b;
          break;
        }
      }
    }
    if (!(btn instanceof HTMLButtonElement) || btn.disabled) return false;
    btn.click();
    return true;
  },
};

// Referenced only to keep the selector constants documented + tree-shake-safe;
// the injected script uses the inline selectors above (closure-free methods).
export const TEAMS_SELECTORS = {
  PREJOIN_SELECTOR,
  NAME_SELECTOR,
  JOIN_SELECTOR,
  MUTE_SELECTOR,
  LOBBY_SELECTOR,
  ADMITTED_SELECTOR,
  DENIED_SELECTOR,
} as const;

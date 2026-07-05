/**
 * Notice Card — Microsoft Teams web-client join adapter.
 *
 * Drives the Teams web prejoin screen as an anonymous guest: fill the display
 * name, mute the mic, click "Join now", then read whether we're in the lobby,
 * admitted, or declined. Selectors target Teams' `data-tid` hooks and prejoin
 * copy. VERIFY-LIVE: confirm against the real client on the bench; the runner
 * fails soft (verbal-notice fallback) if the page drifts, so a stale selector
 * degrades gracefully and never breaks the recording.
 *
 * Every method is self-contained (DOM-only, no imports, no module closures) so
 * the exact source can be serialized into the injected webview script.
 */
import type { JoinAdapter } from './adapterTypes';

const NAME_SELECTOR = '[data-tid="prejoin-display-name-input"]';
const JOIN_SELECTOR = '[data-tid="prejoin-join-button"]';
const MUTE_SELECTOR = '[data-tid="toggle-mute"]';
const LOBBY_SELECTOR = '[data-tid="lobby-screen-title"], [data-tid="lobby-screen"]';
const ADMITTED_SELECTOR = '[data-tid="call-hangup"], [data-tid="calling-retention-banner"]';
const DENIED_SELECTOR = '[data-tid="rejoin-title"], [data-tid="cannot-join-title"]';

export const teamsAdapter: JoinAdapter = {
  platform: 'teams',

  detectPhase(doc) {
    // Terminal / late states win over a lingering prejoin form.
    if (doc.querySelector('[data-tid="call-hangup"], [data-tid="calling-retention-banner"]')) {
      return 'admitted';
    }
    if (doc.querySelector('[data-tid="rejoin-title"], [data-tid="cannot-join-title"]')) {
      return 'denied';
    }
    if (doc.querySelector('[data-tid="lobby-screen-title"], [data-tid="lobby-screen"]')) {
      return 'lobby';
    }
    const name = doc.querySelector('[data-tid="prejoin-display-name-input"]');
    if (name instanceof HTMLInputElement) {
      return name.value.trim() ? 'ready-to-join' : 'name-entry';
    }
    return 'loading';
  },

  fillGuestName(doc, displayName) {
    const input = doc.querySelector('[data-tid="prejoin-display-name-input"]');
    if (!(input instanceof HTMLInputElement)) return false;
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
    const label = (toggle.getAttribute('aria-label') ?? '').toLowerCase();
    const pressed = toggle.getAttribute('aria-pressed') === 'true';
    // "Unmute" label or aria-pressed=true means the mic is already muted.
    const alreadyMuted = pressed || label.includes('unmute');
    if (!alreadyMuted) toggle.click();
    return true;
  },

  clickJoin(doc) {
    const btn = doc.querySelector('[data-tid="prejoin-join-button"]');
    if (!(btn instanceof HTMLButtonElement) || btn.disabled) return false;
    btn.click();
    return true;
  },
};

// Referenced only to keep the selector constants documented + tree-shake-safe;
// the injected script uses the inline selectors above (closure-free methods).
export const TEAMS_SELECTORS = {
  NAME_SELECTOR,
  JOIN_SELECTOR,
  MUTE_SELECTOR,
  LOBBY_SELECTOR,
  ADMITTED_SELECTOR,
  DENIED_SELECTOR,
} as const;

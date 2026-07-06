/**
 * Notice Card — Zoom web-client join adapter.
 *
 * Drives the Zoom web prejoin screen as an anonymous guest: fill the display
 * name, mute the mic, click "Join", then read whether we're in the lobby,
 * admitted, or removed. Selectors target Zoom's web-client IDs, footer hooks,
 * and waiting-room/removal copy. VERIFY-LIVE: confirm against the real client
 * on the bench; the runner fails soft (verbal-notice fallback) if the page
 * drifts, so a stale selector degrades gracefully and never breaks the recording.
 *
 * Every method is self-contained (DOM-only, no imports, no module closures) so
 * the exact source can be serialized into the injected webview script.
 */
import type { JoinAdapter } from './adapterTypes';

const NAME_SELECTOR = '#input-for-name, #inputname';
const JOIN_SELECTOR = '#joinBtn';
const MUTE_SELECTOR = '[aria-label*="mute" i]';
const LOBBY_SELECTOR = '.waiting-room-container';
const ADMITTED_SELECTOR = '#wc-footer, .footer-button__leave-btn, [aria-label="Leave meeting"]';
const DENIED_SELECTOR = '.error-message, [role="alert"]';

export const zoomAdapter: JoinAdapter = {
  platform: 'zoom',

  detectPhase(doc) {
    // Terminal / late states win over a lingering prejoin form.
    if (doc.querySelector('#wc-footer, .footer-button__leave-btn, [aria-label="Leave meeting"]')) {
      return 'admitted';
    }
    const bodyText = (doc.body.textContent ?? '').toLowerCase();
    const deniedText = bodyText.includes('removed') || bodyText.includes('you have been removed');
    const deniedNode = doc.querySelector('.error-message, [role="alert"]');
    const deniedNodeText = (deniedNode?.textContent ?? '').toLowerCase();
    if (deniedText || deniedNodeText.includes('removed') || deniedNodeText.includes('you have been removed')) {
      return 'denied';
    }
    const lobbyText = bodyText.includes('the meeting host will let you in') || bodyText.includes('please wait');
    if (doc.querySelector('.waiting-room-container') || lobbyText) {
      return 'lobby';
    }
    const name = doc.querySelector('#input-for-name, #inputname');
    if (name instanceof HTMLInputElement) {
      return name.value.trim() ? 'ready-to-join' : 'name-entry';
    }
    return 'loading';
  },

  dismissLauncher() {
    // Zoom's web client has its own "Launch Meeting / Join from your browser" step,
    // but it is not captured/grounded here (QA-91c scope is Teams). No-op for now so
    // the shared JoinAdapter contract is satisfied; detectPhase never returns
    // 'launcher' for Zoom, so the runner never calls this.
    return false;
  },

  fillGuestName(doc, displayName) {
    const input = doc.querySelector('#input-for-name, #inputname');
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
    const controls = Array.from(doc.querySelectorAll('[aria-label]'));
    const toggle = controls.find((control) => (control.getAttribute('aria-label') ?? '').toLowerCase().includes('mute'));
    if (!(toggle instanceof HTMLElement)) return false;
    const label = (toggle.getAttribute('aria-label') ?? '').toLowerCase();
    const pressed = toggle.getAttribute('aria-pressed') === 'true';
    // "Unmute" label or aria-pressed=true means the mic is already muted.
    const alreadyMuted = pressed || label.includes('unmute');
    if (!alreadyMuted) toggle.click();
    return true;
  },

  clickJoin(doc) {
    const btn = doc.querySelector('#joinBtn');
    if (!(btn instanceof HTMLButtonElement) || btn.disabled) return false;
    btn.click();
    return true;
  },
};

// Referenced only to keep the selector constants documented + tree-shake-safe;
// the injected script uses the inline selectors above (closure-free methods).
export const ZOOM_SELECTORS = {
  NAME_SELECTOR,
  JOIN_SELECTOR,
  MUTE_SELECTOR,
  LOBBY_SELECTOR,
  ADMITTED_SELECTOR,
  DENIED_SELECTOR,
} as const;

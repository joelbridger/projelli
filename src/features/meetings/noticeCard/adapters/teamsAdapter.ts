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
 * ADMITTED / in-meeting is ALSO grounded in a real live capture (2026-07-06) — see
 * `coordination/qa-campaign/evidence/qa91d-teams-admitted/`. That fixed QA-82: the old
 * admitted selectors (`hangup-button` / `calling-retention-banner` / …) matched NONE of
 * today's in-call DOM, so the runner soft-failed `page-unrecognized` ~28s AFTER a genuine
 * admission and the card was force-closed on stage. Admitted now keys on the real in-call
 * anchors (`hangup-main-btn` / `call-duration` / the `ubar-*` calling controls / the
 * `calling-screen-*` stage) with an aria-label="Leave" fallback; old tids kept as legacy.
 *
 * VERIFY-LIVE: the lobby / denied states still could not be driven from the server bench
 * (single shared signed-in profile — no anonymous second identity), so those use
 * multi-signal detection (data-tid + aria-label + text) with the old selectors retained;
 * the Legion live retest confirmed lobby end-to-end (the card reached the lobby + was
 * admitted). Admission is additionally a one-way latch (supervisor.ts / injectionScript.ts):
 * brief post-admission DOM drift can never force-close an admitted card, while a genuine
 * exit (a recognized non-call page, or in-call anchors gone past a heartbeat window) is
 * still reported honestly so the consent evidence never lies about presence.
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
// ADMITTED / in-meeting anchors — GROUNDED in a real live capture (2026-07-06) of the
// post-admission Teams web page, see `coordination/qa-campaign/evidence/qa91d-teams-admitted/`.
// This fixed QA-82: the OLD selectors (kept below as legacy fallbacks) matched NONE of
// today's in-call DOM, so `detectPhase` sat in `loading` and the runner soft-failed
// `page-unrecognized` ~28s AFTER a genuine admission → the card was force-closed on stage.
// The real in-call-only signals: the `hangup-main-btn` Leave button (also `#hangup-button`
// / `data-inp="hangup-button"`), the running `call-duration` timer, the `ubar-*`
// calling/meeting controls (by tid AND by aria-label), and the `calling-screen-*` /
// `stage-layouts-renderer` stage. Old tids retained last so legacy variants still match.
const ADMITTED_SELECTOR =
  '[data-tid="hangup-main-btn"], #hangup-button, [data-inp="hangup-button"], ' +
  '[data-tid="call-duration"], [data-tid="ubar-horizontal-end"], [data-tid="ubar-horizontal-middle-end"], ' +
  '[data-tid="ubar-toolbar-wrapper"], [data-tid="stage-layouts-renderer"], [data-tid="calling-screen-background"], ' +
  '[data-tid="hangup-button"], [data-tid="call-hangup"], [data-tid="calling-retention-banner"], [data-tid="calling-composite-inner-container"]';
const DENIED_SELECTOR =
  '[data-tid="rejoin-title"], [data-tid="cannot-join-title"], [data-tid="calling-declined-screen"]';
// Launcher / "browser or app?" chooser — the continue-in-browser control. Grounded
// in a real capture (2026-07-06) of `teams.live.com/dl/launcher/launcher.html`: the
// primary button is `[data-tid="joinOnWeb"]` (text "Continue on this browser",
// aria-label "Join meeting from this browser"). The desktop-app button is
// `[data-tid="joinInApp"]` — we must NEVER click that. See
// `coordination/qa-campaign/evidence/qa91c-teams-launcher/`.
const LAUNCHER_JOIN_WEB_SELECTOR = '[data-tid="joinOnWeb"]';

export const teamsAdapter: JoinAdapter = {
  platform: 'teams',

  detectPhase(doc) {
    // The launcher chooser is the FIRST page a fresh, cookieless webview lands on:
    // "Continue on this browser / Join on the Teams app". The companion webview
    // (a Tauri WebView2, a desktop-style UA) hits it every time, so it MUST be
    // recognized and clicked through BEFORE anything else, or detectPhase would
    // sit in `loading` and the runner would soft-fail `page-unrecognized` at ~29s.
    // Keyed on the grounded `joinOnWeb` control, with text/aria/URL fallbacks.
    // Inlined (not a module helper) because these methods are serialized
    // standalone into the webview — a module-scope helper would be undefined there.
    const findLauncherWebButton = (d: Document): HTMLElement | null => {
      const primary = d.querySelector('[data-tid="joinOnWeb"]');
      if (primary instanceof HTMLElement) return primary;
      // Fallbacks: a button whose text/aria says "continue in this browser" / "join
      // from this browser". Deliberately excludes the "Teams app" control so a tid
      // drift never makes us click "Open the app" by accident.
      const buttons = d.querySelectorAll('button, a[role="button"], [role="button"]');
      for (let i = 0; i < buttons.length; i++) {
        const b = buttons[i];
        if (!(b instanceof HTMLElement)) continue;
        const hint = (
          (b.textContent || '') +
          ' ' +
          (b.getAttribute('aria-label') || '')
        ).toLowerCase();
        if (/\bapp\b/.test(hint)) continue; // never the "open the Teams app" button
        if (
          /continue (?:on|in) this browser|continue in (?:the )?browser|join (?:meeting )?(?:from|in|on) (?:this |the |your )?browser|join on the web/.test(
            hint,
          )
        ) {
          return b;
        }
      }
      return null;
    };
    // `doc.URL` is a plain string (about:blank in jsdom fixtures), so no
    // nullable guard is needed. Secondary signal only — the button is primary.
    const onLauncherUrl = /\/dl\/launcher\/launcher\.html/i.test(doc.URL);
    if (findLauncherWebButton(doc) || onLauncherUrl) {
      return 'launcher';
    }
    // Terminal / late states win over a lingering prejoin form.
    // ADMITTED / in-meeting: grounded on the real live capture (QA-91d). Multi-signal
    // so a single tid drift can't re-open the ~28s-after-admit self-destruct bug:
    //  1. the real in-call anchors (hangup-main-btn / #hangup-button / call-duration /
    //     the ubar calling+meeting controls / the calling-screen stage), PLUS the old
    //     tids as legacy fallbacks — all in ADMITTED_SELECTOR-equivalent form here; and
    //  2. a button whose aria-label is exactly "Leave" / "Leave meeting" / "Hang up"
    //     (the in-call hang-up control), which the left-nav app bar never has.
    // Inlined (not the module const) because detectPhase is serialized standalone into
    // the webview — a module-scope reference would be undefined there.
    const inMeeting = () => {
      if (
        doc.querySelector(
          '[data-tid="hangup-main-btn"], #hangup-button, [data-inp="hangup-button"], ' +
            '[data-tid="call-duration"], [data-tid="ubar-horizontal-end"], [data-tid="ubar-horizontal-middle-end"], ' +
            '[data-tid="ubar-toolbar-wrapper"], [data-tid="stage-layouts-renderer"], [data-tid="calling-screen-background"], ' +
            '[data-tid="hangup-button"], [data-tid="call-hangup"], [data-tid="calling-retention-banner"], [data-tid="calling-composite-inner-container"]',
        )
      ) {
        return true;
      }
      // aria-label fallback: the in-call hang-up button. Scoped to real hang-up copy
      // so it can never match a left-nav "People"/"Meet" app-bar control.
      const buttons = doc.querySelectorAll('button, [role="button"]');
      for (let i = 0; i < buttons.length; i++) {
        const b = buttons[i];
        if (!(b instanceof HTMLElement)) continue;
        const label = (b.getAttribute('aria-label') || '').trim().toLowerCase();
        if (label === 'leave' || label === 'leave meeting' || label === 'hang up' || label === 'hangup') {
          return true;
        }
      }
      return false;
    };
    if (inMeeting()) {
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

  dismissLauncher(doc) {
    // Click "Continue on this browser" on the launcher chooser so the join proceeds
    // to the real prejoin. Grounded on `[data-tid="joinOnWeb"]`; falls back to a
    // button whose text/aria says "continue/join ... in this browser". The
    // "Join on the Teams app" control (`joinInApp`, text/aria containing "app") is
    // explicitly excluded so we never dead-end into a desktop-app handoff. Inlined
    // (see detectPhase) because this method is serialized standalone into the webview.
    const findLauncherWebButton = (d: Document): HTMLElement | null => {
      const primary = d.querySelector('[data-tid="joinOnWeb"]');
      if (primary instanceof HTMLElement) return primary;
      const buttons = d.querySelectorAll('button, a[role="button"], [role="button"]');
      for (let i = 0; i < buttons.length; i++) {
        const b = buttons[i];
        if (!(b instanceof HTMLElement)) continue;
        const hint = (
          (b.textContent || '') +
          ' ' +
          (b.getAttribute('aria-label') || '')
        ).toLowerCase();
        if (/\bapp\b/.test(hint)) continue; // never the "open the Teams app" button
        if (
          /continue (?:on|in) this browser|continue in (?:the )?browser|join (?:meeting )?(?:from|in|on) (?:this |the |your )?browser|join on the web/.test(
            hint,
          )
        ) {
          return b;
        }
      }
      return null;
    };
    const btn = findLauncherWebButton(doc);
    if (!(btn instanceof HTMLElement)) return false;
    if (btn instanceof HTMLButtonElement && btn.disabled) return false;
    btn.click();
    return true;
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
  LAUNCHER_JOIN_WEB_SELECTOR,
  PREJOIN_SELECTOR,
  NAME_SELECTOR,
  JOIN_SELECTOR,
  MUTE_SELECTOR,
  LOBBY_SELECTOR,
  ADMITTED_SELECTOR,
  DENIED_SELECTOR,
} as const;

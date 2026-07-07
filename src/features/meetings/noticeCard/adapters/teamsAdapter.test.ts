import { describe, it, expect } from 'vitest';
import { teamsAdapter } from './teamsAdapter';

/**
 * Teams web-client prejoin/meeting DOM fixtures.
 *
 * The CURRENT_* fixtures are built from a real capture of today's Teams web join
 * page (2026-07-06) — see `coordination/qa-campaign/evidence/qa91b-teams-adapter/`.
 * That capture is what fixed QA-91b: the join page moved to a
 * `[data-tid="calling-prejoin-screen"]` region with a `role="switch"` mic toggle,
 * so the old selectors matched nothing and `detectPhase` never left `loading`
 * (the ~29s `page-unrecognized` soft-fail seen on the Legion bench).
 *
 * The LEGACY_* fixtures are the older Teams variant; they must keep passing
 * because the adapter retains the old selectors as secondary fallbacks (Teams
 * web ships variants).
 */
function dom(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function requireFixtureElement(doc: Document, selector: string): Element {
  const element = doc.querySelector(selector);
  if (!element) throw new Error(`Missing fixture element: ${selector}`);
  return element;
}

function requireFixtureInput(doc: Document, selector: string): HTMLInputElement {
  const element = requireFixtureElement(doc, selector);
  if (!(element instanceof HTMLInputElement)) throw new Error(`Fixture element is not an input: ${selector}`);
  return element;
}

/* ------------------------------------------------------------------ */
/* LAUNCHER chooser — captured from live Teams (2026-07-06)             */
/* teams.live.com/dl/launcher/launcher.html — the "browser or app?" page */
/* the cookieless companion webview lands on BEFORE the prejoin.        */
/* See coordination/qa-campaign/evidence/qa91c-teams-launcher/.         */
/* ------------------------------------------------------------------ */

// Real captured buttons: joinOnWeb ("Continue on this browser") is the click
// target; joinInApp ("Join on the Teams app") must NEVER be clicked.
const CURRENT_LAUNCHER = `
  <div class="mainActionsContent">
    <h1>Join your Teams meeting</h1>
    <button aria-label="Join meeting from this browser" class="btn primary" data-tid="joinOnWeb">
      <div class="btnIcon"><div class="text"><h3>Continue on this browser</h3></div></div>
    </button>
    <button aria-label="Open Teams app to join a meeting" class="btn secondary" data-tid="joinInApp">
      <div class="btnIcon"><div class="text"><h3>Join on the Teams app</h3></div></div>
    </button>
    <a data-tid="download" aria-label="Download Teams application" href="#">Download it now</a>
  </div>`;

// Launcher with the primary data-tid drifted away — text/aria fallback must still
// recognize it and still avoid the "Teams app" control.
const LAUNCHER_TID_DRIFT = `
  <div class="mainActionsContent">
    <h1>Join your Teams meeting</h1>
    <button aria-label="Join meeting from this browser" class="btn primary">
      <h3>Continue on this browser</h3>
    </button>
    <button aria-label="Open Teams app to join a meeting" class="btn secondary">
      <h3>Join on the Teams app</h3>
    </button>
  </div>`;

/* ------------------------------------------------------------------ */
/* CURRENT variant — captured from live Teams web (2026-07-06)         */
/* ------------------------------------------------------------------ */

// Anonymous guest prejoin: name field present + empty, mic switch on (unmuted).
const CURRENT_NAME_ENTRY = `
  <div data-tid="calling-prejoin-screen" role="region">
    <div data-tid="prejoin-header-content">
      <span data-tid="meeting-header-title" title="Microsoft Teams meeting">Microsoft Teams meeting</span>
    </div>
    <div data-tid="calling-prejoin-render-content-container">
      <div data-tid="prejoin-v2-video-preview-container">
        <input id="switch-r1b" role="switch" type="checkbox" aria-label="Camera is off"
               data-tid="toggle-video" data-cid="toggle-video-false" aria-checked="false" />
      </div>
      <input data-tid="prejoin-display-name-input" type="text" value="" aria-label="Type your name" />
      <input id="switch-r1f" role="switch" type="checkbox" title="Mic"
             data-tid="toggle-mute" data-cid="toggle-mute-false" aria-checked="true" />
    </div>
    <button data-tid="prejoin-cancel-button">Cancel</button>
    <button data-tid="prejoin-join-button" aria-label="Join now">Join now</button>
  </div>`;

// Same prejoin with the name filled → ready-to-join.
const CURRENT_READY = CURRENT_NAME_ENTRY.replace('value=""', 'value="⏺ Recording Notice — Sarah"');

// Signed-in prejoin (the exact shape captured on the bench): the account card
// replaces the name field. Prejoin is recognized by its container, so this must
// read ready-to-join (not name-entry, not loading/unrecognized).
const CURRENT_SIGNEDIN = `
  <div data-tid="calling-prejoin-screen" role="region">
    <button data-tid="account-selection-change-account-button" aria-label="Change to another account">Change</button>
    <div data-tid="prejoin-header-content">
      <span data-tid="meeting-header-title">Microsoft Teams meeting</span>
    </div>
    <input id="switch-r1f" role="switch" type="checkbox"
           data-tid="toggle-mute" data-cid="toggle-mute-false" aria-checked="true" />
    <button data-tid="prejoin-join-button" aria-label="Join now">Join now</button>
  </div>`;

const CURRENT_LOBBY = `
  <div id="app"><div data-tid="calling-lobby-screen">Someone in the meeting should let you in soon</div></div>`;

// Lobby recognized by copy alone, if the tid drifts.
const CURRENT_LOBBY_TEXT_ONLY = `
  <div id="app"><div class="waiting">Someone will let you in soon.</div></div>`;

const CURRENT_ADMITTED = `
  <div id="app"><div data-tid="calling-composite-inner-container"></div>
    <button data-tid="hangup-button" aria-label="Leave"></button></div>`;

/* ------------------------------------------------------------------ */
/* REAL ADMITTED / in-meeting DOM — captured live 2026-07-06           */
/* coordination/qa-campaign/evidence/qa91d-teams-admitted/.            */
/* The bug QA-82: none of the OLD admitted selectors matched this page, */
/* so detectPhase never returned 'admitted' → ~28s page-unrecognized   */
/* AFTER a real admission → the card was force-closed on stage.         */
/* ------------------------------------------------------------------ */

// The real in-call calling composite: the ubar controls toolbar, the Leave
// (hangup-main-btn) button, the running call-duration timer, the stage. This is
// the exact page a Notice Card guest lands on the moment the host admits it —
// and it contains NONE of the old hangup-button/calling-retention-banner tids.
const REAL_ADMITTED = `
  <div id="app">
    <div data-tid="ubar-toolbar-wrapper">
      <div data-tid="ubar-indicators" aria-label="Calling indicators">
        <span dir="auto" data-tid="call-duration">00:51</span>
      </div>
      <div role="toolbar" aria-label="Meeting controls" data-tid="ubar-horizontal-middle-end" id="horizontalMiddleEnd">
        <button data-inp="recording-button" aria-label="Record">Record</button>
        <button data-tid="reaction-menu-button-without-raise-hand" aria-label="React">React</button>
        <button data-tid="view-mode-button" aria-label="View">View</button>
      </div>
      <div role="group" aria-label="Calling controls" data-tid="ubar-horizontal-end" id="horizontalEnd">
        <button type="button" data-tid="hangup-main-btn" data-inp="hangup-button"
                aria-keyshortcuts="Ctrl+Shift+H" aria-label="Leave" id="hangup-button">Leave</button>
        <button data-tid="hangup-toggle-more-options-btn" aria-label="More options"></button>
      </div>
    </div>
    <div data-tid="stage-layouts-renderer">
      <div data-tid="calling-screen-avatar" data-person-mri="8:live:.cid.50f0c28861a90997">
        <span data-tid="participant-avatar"></span>
      </div>
    </div>
    <div data-tid="calling-screen-background"></div>
  </div>`;

// Same in-call page with the primary hangup tid drifted away — the aria-label
// "Leave" button + the call-duration timer + the calling controls group must
// still classify it as admitted (multi-signal, survives a single tid drift).
const REAL_ADMITTED_TID_DRIFT = `
  <div id="app">
    <div data-tid="ubar-toolbar-wrapper">
      <span dir="auto" data-tid="call-duration">02:14</span>
      <div role="group" aria-label="Calling controls">
        <button type="button" aria-label="Leave">Leave</button>
      </div>
    </div>
  </div>`;

const CURRENT_DENIED = `
  <div id="app"><div data-tid="calling-declined-screen">You weren't admitted to the meeting</div></div>`;

/* ------------------------------------------------------------------ */
/* LEGACY variant — older Teams web (kept alive by fallback selectors)  */
/* ------------------------------------------------------------------ */

const LEGACY_NAME_ENTRY = `
  <div id="app">
    <div data-tid="prejoin-screen">
      <input data-tid="prejoin-display-name-input" type="text" value="" aria-label="Type your name" />
      <button data-tid="toggle-mute" aria-label="Mute microphone" aria-pressed="false"></button>
      <button data-tid="prejoin-join-button">Join now</button>
    </div>
  </div>`;

const LEGACY_READY = LEGACY_NAME_ENTRY.replace('value=""', 'value="⏺ Recording Notice — Sarah"');

const LEGACY_LOBBY = `
  <div id="app"><div data-tid="lobby-screen-title">Someone in the meeting should let you in soon</div></div>`;

const LEGACY_ADMITTED = `
  <div id="app"><div data-tid="calling-retention-banner"></div>
    <button data-tid="call-hangup" aria-label="Leave"></button></div>`;

const LEGACY_DENIED = `
  <div id="app"><div data-tid="rejoin-title">You've been removed from this meeting</div></div>`;

/* ================================================================== */

describe('teamsAdapter — launcher "browser or app?" chooser (QA-91c)', () => {
  it('detectPhase reads launcher from the joinOnWeb chooser page', () => {
    expect(teamsAdapter.detectPhase(dom(CURRENT_LAUNCHER))).toBe('launcher');
  });

  it('detectPhase reads launcher even when the joinOnWeb tid drifts (text/aria fallback)', () => {
    expect(teamsAdapter.detectPhase(dom(LAUNCHER_TID_DRIFT))).toBe('launcher');
  });

  it('launcher wins over everything else — it must be handled FIRST (before loading)', () => {
    // The reported bug: detectPhase sat in loading on this page and the runner
    // soft-failed page-unrecognized at ~29s. It must NOT read loading here.
    const phase = teamsAdapter.detectPhase(dom(CURRENT_LAUNCHER));
    expect(phase).not.toBe('loading');
    expect(phase).toBe('launcher');
  });

  it('dismissLauncher clicks "Continue on this browser" (joinOnWeb)', () => {
    const doc = dom(CURRENT_LAUNCHER);
    let webClicks = 0;
    let appClicks = 0;
    doc.querySelector('[data-tid="joinOnWeb"]')?.addEventListener('click', () => {
      webClicks += 1;
    });
    doc.querySelector('[data-tid="joinInApp"]')?.addEventListener('click', () => {
      appClicks += 1;
    });
    expect(teamsAdapter.dismissLauncher(doc)).toBe(true);
    expect(webClicks).toBe(1);
    expect(appClicks).toBe(0); // NEVER the Teams-app control
  });

  it('dismissLauncher clicks the browser control via fallback and still avoids the app control', () => {
    const doc = dom(LAUNCHER_TID_DRIFT);
    const buttons = Array.from(doc.querySelectorAll('button'));
    const clicked: string[] = [];
    buttons.forEach((b) => {
      b.addEventListener('click', () => {
        clicked.push((b.getAttribute('aria-label') || '').toLowerCase());
      });
    });
    expect(teamsAdapter.dismissLauncher(doc)).toBe(true);
    expect(clicked).toEqual(['join meeting from this browser']);
    expect(clicked.join(' ')).not.toContain('app');
  });

  it('dismissLauncher returns false when no chooser is present (e.g. the prejoin)', () => {
    expect(teamsAdapter.dismissLauncher(dom(CURRENT_NAME_ENTRY))).toBe(false);
  });

  it('reads launcher by URL even when the continue-in-browser control is absent, and then dismissLauncher fails (drift → runner must fast-fail)', () => {
    // The page still IS the launcher (its URL), but the joinOnWeb control is gone/
    // renamed, so there is nothing to click. detectPhase must still classify it as
    // launcher (URL signal), and dismissLauncher must honestly return false so the
    // runner counts it toward the unrecognized give-up instead of hanging.
    const doc = dom('<div class="mainActionsContent"><h1>Join your Teams meeting</h1></div>');
    Object.defineProperty(doc, 'URL', {
      value: 'https://teams.live.com/dl/launcher/launcher.html?url=%2Fmeet%2F1',
      configurable: true,
    });
    expect(teamsAdapter.detectPhase(doc)).toBe('launcher');
    expect(teamsAdapter.dismissLauncher(doc)).toBe(false);
  });

  it('dismissLauncher returns false for a DISABLED continue-in-browser button (can\'t act)', () => {
    const doc = dom(`
      <div class="mainActionsContent">
        <button data-tid="joinOnWeb" disabled aria-label="Join meeting from this browser">Continue on this browser</button>
      </div>`);
    expect(teamsAdapter.detectPhase(doc)).toBe('launcher'); // still the launcher
    expect(teamsAdapter.dismissLauncher(doc)).toBe(false); // but not actionable
  });

  it('the prejoin is NOT mistaken for the launcher', () => {
    // "Join now" on the prejoin must never read as launcher / trigger a launcher click.
    expect(teamsAdapter.detectPhase(dom(CURRENT_NAME_ENTRY))).not.toBe('launcher');
    expect(teamsAdapter.detectPhase(dom(CURRENT_SIGNEDIN))).not.toBe('launcher');
    expect(teamsAdapter.detectPhase(dom(LEGACY_NAME_ENTRY))).not.toBe('launcher');
  });

  it('after clicking through the launcher, the prejoin fixtures still drive normally', () => {
    // Sequence proof: launcher → click → the page becomes the prejoin, which the
    // existing QA-91b flow recognizes as name-entry (then ready-to-join once filled).
    expect(teamsAdapter.detectPhase(dom(CURRENT_LAUNCHER))).toBe('launcher');
    expect(teamsAdapter.detectPhase(dom(CURRENT_NAME_ENTRY))).toBe('name-entry');
    expect(teamsAdapter.detectPhase(dom(CURRENT_READY))).toBe('ready-to-join');
  });
});

describe('teamsAdapter.detectPhase — current Teams web (captured 2026-07-06)', () => {
  it('reads name-entry from the calling-prejoin-screen with an empty name field', () => {
    expect(teamsAdapter.detectPhase(dom(CURRENT_NAME_ENTRY))).toBe('name-entry');
  });
  it('reads ready-to-join once the name is filled', () => {
    expect(teamsAdapter.detectPhase(dom(CURRENT_READY))).toBe('ready-to-join');
  });
  it('reads ready-to-join for the signed-in account prejoin (no name field)', () => {
    // This is the exact bench capture — the account card replaces the name input.
    // Recognizing the prejoin by its container is what fixes page-unrecognized.
    expect(teamsAdapter.detectPhase(dom(CURRENT_SIGNEDIN))).toBe('ready-to-join');
  });
  it('reads lobby from calling-lobby-screen', () => {
    expect(teamsAdapter.detectPhase(dom(CURRENT_LOBBY))).toBe('lobby');
  });
  it('reads lobby from the "let you in" copy when the tid drifts', () => {
    expect(teamsAdapter.detectPhase(dom(CURRENT_LOBBY_TEXT_ONLY))).toBe('lobby');
  });
  it('reads admitted from the hangup button / in-call container', () => {
    expect(teamsAdapter.detectPhase(dom(CURRENT_ADMITTED))).toBe('admitted');
  });
  it('reads admitted from the REAL captured in-meeting DOM (QA-91d ground truth)', () => {
    // The reported bug: the OLD selectors matched none of this page, so detectPhase
    // returned 'loading' and the runner soft-failed page-unrecognized ~28s AFTER a
    // genuine admission. It MUST read admitted here.
    const phase = teamsAdapter.detectPhase(dom(REAL_ADMITTED));
    expect(phase).not.toBe('loading');
    expect(phase).toBe('admitted');
  });
  it('reads admitted from the real in-meeting page even when the hangup tid drifts', () => {
    // Multi-signal: the aria-label "Leave" button + the call-duration timer must
    // still be recognized as in-meeting if data-tid="hangup-main-btn" ever changes.
    expect(teamsAdapter.detectPhase(dom(REAL_ADMITTED_TID_DRIFT))).toBe('admitted');
  });
  it('reads admitted from the call-duration timer alone (in-call-only signal)', () => {
    const doc = dom('<div id="app"><span data-tid="call-duration">10:03</span></div>');
    expect(teamsAdapter.detectPhase(doc)).toBe('admitted');
  });
  it('reads denied from the declined screen', () => {
    expect(teamsAdapter.detectPhase(dom(CURRENT_DENIED))).toBe('denied');
  });
});

describe('teamsAdapter.detectPhase — regression guard for QA-91b', () => {
  it('does NOT return loading/unrecognized for the current prejoin (the reported bug)', () => {
    // The old adapter returned "loading" here → 40 ticks → "unrecognized".
    const phase = teamsAdapter.detectPhase(dom(CURRENT_NAME_ENTRY));
    expect(phase).not.toBe('loading');
    expect(['name-entry', 'ready-to-join']).toContain(phase);
  });
});

describe('teamsAdapter — name-tid drift must not join nameless (review round 2)', () => {
  // Primary name data-tid gone, but a labeled name box is still present. If
  // detectPhase treated this as ready-to-join, the runner would clickJoin
  // without ever filling the "Recording Notice" name → a nameless card.
  const DRIFTED_NAME_TID = `
    <div data-tid="calling-prejoin-screen" role="region">
      <input type="text" aria-label="Enter your name" value="" />
      <input role="switch" type="checkbox" data-tid="toggle-mute" data-cid="toggle-mute-false" aria-checked="true" />
      <button data-tid="prejoin-join-button" aria-label="Join now">Join now</button>
    </div>`;

  it('detectPhase reads name-entry when only a labeled name box remains (empty)', () => {
    expect(teamsAdapter.detectPhase(dom(DRIFTED_NAME_TID))).toBe('name-entry');
  });

  it('detectPhase flips to ready-to-join after the labeled box is filled', () => {
    const doc = dom(DRIFTED_NAME_TID);
    expect(teamsAdapter.detectPhase(doc)).toBe('name-entry');
    // Runner would call fillGuestName during name-entry:
    expect(teamsAdapter.fillGuestName(doc, '⏺ Recording Notice — Sarah')).toBe(true);
    expect(requireFixtureInput(doc, 'input[aria-label="Enter your name"]').value).toBe(
      '⏺ Recording Notice — Sarah',
    );
    expect(teamsAdapter.detectPhase(doc)).toBe('ready-to-join');
  });
});

describe('teamsAdapter.detectPhase — legacy Teams web (fallback selectors)', () => {
  it('still reads name-entry from the legacy prejoin', () => {
    expect(teamsAdapter.detectPhase(dom(LEGACY_NAME_ENTRY))).toBe('name-entry');
  });
  it('still reads ready-to-join once the legacy name is filled', () => {
    expect(teamsAdapter.detectPhase(dom(LEGACY_READY))).toBe('ready-to-join');
  });
  it('still reads lobby / admitted / denied from legacy tids', () => {
    expect(teamsAdapter.detectPhase(dom(LEGACY_LOBBY))).toBe('lobby');
    expect(teamsAdapter.detectPhase(dom(LEGACY_ADMITTED))).toBe('admitted');
    expect(teamsAdapter.detectPhase(dom(LEGACY_DENIED))).toBe('denied');
  });
  it('reads loading for an empty / not-yet-rendered page', () => {
    expect(teamsAdapter.detectPhase(dom('<div id="app"></div>'))).toBe('loading');
  });
  it('prioritizes admitted/denied over a lingering prejoin form', () => {
    const mixed = CURRENT_ADMITTED + `<input data-tid="prejoin-display-name-input" value="" />`;
    expect(teamsAdapter.detectPhase(dom(mixed))).toBe('admitted');
  });
});

describe('teamsAdapter.fillGuestName', () => {
  it('sets the name field and fires an input event (current DOM, React-controlled)', () => {
    const doc = dom(CURRENT_NAME_ENTRY);
    let fired = false;
    requireFixtureElement(doc, '[data-tid="prejoin-display-name-input"]').addEventListener('input', () => {
      fired = true;
    });
    expect(teamsAdapter.fillGuestName(doc, '⏺ Recording Notice — Sarah')).toBe(true);
    const input = requireFixtureInput(doc, '[data-tid="prejoin-display-name-input"]');
    expect(input.value).toBe('⏺ Recording Notice — Sarah');
    expect(fired).toBe(true);
  });
  it('still fills the legacy name field', () => {
    const doc = dom(LEGACY_NAME_ENTRY);
    expect(teamsAdapter.fillGuestName(doc, 'x')).toBe(true);
  });
  it('falls back to an aria-labelled name input inside the prejoin when the tid drifts', () => {
    const drifted = `
      <div data-tid="calling-prejoin-screen">
        <input type="text" aria-label="Enter your name" value="" />
        <button data-tid="prejoin-join-button">Join now</button>
      </div>`;
    const doc = dom(drifted);
    expect(teamsAdapter.fillGuestName(doc, 'Sarah')).toBe(true);
    expect(requireFixtureInput(doc, 'input[aria-label="Enter your name"]').value).toBe('Sarah');
  });
  it('returns false when there is no name field', () => {
    expect(teamsAdapter.fillGuestName(dom(CURRENT_LOBBY), 'x')).toBe(false);
  });
});

describe('teamsAdapter.ensureMuted — current switch toggle', () => {
  it('clicks the mic switch when unmuted (data-cid=toggle-mute-false)', () => {
    const doc = dom(CURRENT_NAME_ENTRY);
    let clicks = 0;
    requireFixtureElement(doc, '[data-tid="toggle-mute"]').addEventListener('click', () => {
      clicks += 1;
    });
    expect(teamsAdapter.ensureMuted(doc)).toBe(true);
    expect(clicks).toBe(1);
  });
  it('does not click when already muted (data-cid=toggle-mute-true)', () => {
    const html = CURRENT_NAME_ENTRY.replace('data-cid="toggle-mute-false" aria-checked="true"', 'data-cid="toggle-mute-true" aria-checked="false"');
    const doc = dom(html);
    let clicks = 0;
    requireFixtureElement(doc, '[data-tid="toggle-mute"]').addEventListener('click', () => {
      clicks += 1;
    });
    expect(teamsAdapter.ensureMuted(doc)).toBe(true);
    expect(clicks).toBe(0);
  });
  it('treats aria-checked="false" (switch off) as already muted when no data-cid', () => {
    const html = `
      <div data-tid="calling-prejoin-screen">
        <input role="switch" type="checkbox" data-tid="toggle-mute" aria-checked="false" />
      </div>`;
    const doc = dom(html);
    let clicks = 0;
    requireFixtureElement(doc, '[data-tid="toggle-mute"]').addEventListener('click', () => {
      clicks += 1;
    });
    expect(teamsAdapter.ensureMuted(doc)).toBe(true);
    expect(clicks).toBe(0);
  });
  it('does not click a disabled mic toggle (no mic device)', () => {
    const html = CURRENT_NAME_ENTRY.replace('data-tid="toggle-mute"', 'data-tid="toggle-mute" disabled');
    const doc = dom(html);
    let clicks = 0;
    requireFixtureElement(doc, '[data-tid="toggle-mute"]').addEventListener('click', () => {
      clicks += 1;
    });
    expect(teamsAdapter.ensureMuted(doc)).toBe(true);
    expect(clicks).toBe(0);
  });
  it('still handles the legacy aria-pressed button', () => {
    const doc = dom(LEGACY_NAME_ENTRY);
    let clicks = 0;
    requireFixtureElement(doc, '[data-tid="toggle-mute"]').addEventListener('click', () => {
      clicks += 1;
    });
    expect(teamsAdapter.ensureMuted(doc)).toBe(true);
    expect(clicks).toBe(1);
  });
  it('does not click a legacy toggle already showing an Unmute label', () => {
    const html = LEGACY_NAME_ENTRY.replace('aria-label="Mute microphone" aria-pressed="false"', 'aria-label="Unmute microphone" aria-pressed="true"');
    const doc = dom(html);
    let clicks = 0;
    requireFixtureElement(doc, '[data-tid="toggle-mute"]').addEventListener('click', () => {
      clicks += 1;
    });
    expect(teamsAdapter.ensureMuted(doc)).toBe(true);
    expect(clicks).toBe(0);
  });

  it('can briefly unmute for the spoken announcement and then mute again', () => {
    const doc = dom(CURRENT_NAME_ENTRY);
    const toggle = requireFixtureElement(doc, '[data-tid="toggle-mute"]');
    let muted = false;
    toggle.addEventListener('click', () => {
      muted = !muted;
      toggle.setAttribute('data-cid', muted ? 'toggle-mute-true' : 'toggle-mute-false');
    });

    expect(teamsAdapter.ensureMuted(doc)).toBe(true);
    expect(toggle.getAttribute('data-cid')).toBe('toggle-mute-true');
    expect(teamsAdapter.setMuted(doc, false)).toBe(true);
    expect(toggle.getAttribute('data-cid')).toBe('toggle-mute-false');
    expect(teamsAdapter.setMuted(doc, true)).toBe(true);
    expect(toggle.getAttribute('data-cid')).toBe('toggle-mute-true');
  });
});

describe('teamsAdapter.clickJoin', () => {
  it('clicks the current join button', () => {
    const doc = dom(CURRENT_READY);
    let clicks = 0;
    requireFixtureElement(doc, '[data-tid="prejoin-join-button"]').addEventListener('click', () => {
      clicks += 1;
    });
    expect(teamsAdapter.clickJoin(doc)).toBe(true);
    expect(clicks).toBe(1);
  });
  it('falls back to a "Join" button when the tid drifts', () => {
    const drifted = `
      <div data-tid="calling-prejoin-screen">
        <button aria-label="Join now">Join now</button>
      </div>`;
    const doc = dom(drifted);
    let clicks = 0;
    requireFixtureElement(doc, 'button').addEventListener('click', () => {
      clicks += 1;
    });
    expect(teamsAdapter.clickJoin(doc)).toBe(true);
    expect(clicks).toBe(1);
  });
  it('returns false when no join button is present', () => {
    expect(teamsAdapter.clickJoin(dom(CURRENT_LOBBY))).toBe(false);
  });
  it('returns false for a disabled join button', () => {
    const html = CURRENT_READY.replace('data-tid="prejoin-join-button"', 'data-tid="prejoin-join-button" disabled');
    expect(teamsAdapter.clickJoin(dom(html))).toBe(false);
  });
});

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
    expect(doc.querySelector<HTMLInputElement>('input[aria-label="Enter your name"]')!.value).toBe(
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
    doc.querySelector('[data-tid="prejoin-display-name-input"]')!.addEventListener('input', () => {
      fired = true;
    });
    expect(teamsAdapter.fillGuestName(doc, '⏺ Recording Notice — Sarah')).toBe(true);
    const input = doc.querySelector<HTMLInputElement>('[data-tid="prejoin-display-name-input"]')!;
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
    expect(doc.querySelector<HTMLInputElement>('input[aria-label="Enter your name"]')!.value).toBe('Sarah');
  });
  it('returns false when there is no name field', () => {
    expect(teamsAdapter.fillGuestName(dom(CURRENT_LOBBY), 'x')).toBe(false);
  });
});

describe('teamsAdapter.ensureMuted — current switch toggle', () => {
  it('clicks the mic switch when unmuted (data-cid=toggle-mute-false)', () => {
    const doc = dom(CURRENT_NAME_ENTRY);
    let clicks = 0;
    doc.querySelector('[data-tid="toggle-mute"]')!.addEventListener('click', () => {
      clicks += 1;
    });
    expect(teamsAdapter.ensureMuted(doc)).toBe(true);
    expect(clicks).toBe(1);
  });
  it('does not click when already muted (data-cid=toggle-mute-true)', () => {
    const html = CURRENT_NAME_ENTRY.replace('data-cid="toggle-mute-false" aria-checked="true"', 'data-cid="toggle-mute-true" aria-checked="false"');
    const doc = dom(html);
    let clicks = 0;
    doc.querySelector('[data-tid="toggle-mute"]')!.addEventListener('click', () => {
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
    doc.querySelector('[data-tid="toggle-mute"]')!.addEventListener('click', () => {
      clicks += 1;
    });
    expect(teamsAdapter.ensureMuted(doc)).toBe(true);
    expect(clicks).toBe(0);
  });
  it('does not click a disabled mic toggle (no mic device)', () => {
    const html = CURRENT_NAME_ENTRY.replace('data-tid="toggle-mute"', 'data-tid="toggle-mute" disabled');
    const doc = dom(html);
    let clicks = 0;
    doc.querySelector('[data-tid="toggle-mute"]')!.addEventListener('click', () => {
      clicks += 1;
    });
    expect(teamsAdapter.ensureMuted(doc)).toBe(true);
    expect(clicks).toBe(0);
  });
  it('still handles the legacy aria-pressed button', () => {
    const doc = dom(LEGACY_NAME_ENTRY);
    let clicks = 0;
    doc.querySelector('[data-tid="toggle-mute"]')!.addEventListener('click', () => {
      clicks += 1;
    });
    expect(teamsAdapter.ensureMuted(doc)).toBe(true);
    expect(clicks).toBe(1);
  });
  it('does not click a legacy toggle already showing an Unmute label', () => {
    const html = LEGACY_NAME_ENTRY.replace('aria-label="Mute microphone" aria-pressed="false"', 'aria-label="Unmute microphone" aria-pressed="true"');
    const doc = dom(html);
    let clicks = 0;
    doc.querySelector('[data-tid="toggle-mute"]')!.addEventListener('click', () => {
      clicks += 1;
    });
    expect(teamsAdapter.ensureMuted(doc)).toBe(true);
    expect(clicks).toBe(0);
  });
});

describe('teamsAdapter.clickJoin', () => {
  it('clicks the current join button', () => {
    const doc = dom(CURRENT_READY);
    let clicks = 0;
    doc.querySelector('[data-tid="prejoin-join-button"]')!.addEventListener('click', () => {
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
    doc.querySelector('button')!.addEventListener('click', () => {
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

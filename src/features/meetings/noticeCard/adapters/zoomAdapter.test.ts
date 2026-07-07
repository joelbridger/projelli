import { describe, it, expect } from 'vitest';
import { zoomAdapter } from './zoomAdapter';

/**
 * Recorded Zoom web-client prejoin/meeting DOM fixtures. Minimal but keyed off
 * the SAME selectors/text the adapter targets. VERIFY-LIVE: the live bench pass
 * confirms these selectors still match the real Zoom web client after any
 * platform update (the adapter fails soft to the verbal-notice fallback if
 * they drift, so a mismatch degrades, never breaks the recording).
 */
function dom(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const NAME_ENTRY = `
  <div id="app">
    <div class="preview-meeting-info">
      <input id="input-for-name" type="text" value="" aria-label="Your name" />
      <button aria-label="Mute microphone" aria-pressed="false"></button>
      <button id="joinBtn">Join</button>
    </div>
  </div>`;

const READY = NAME_ENTRY.replace('value=""', 'value="⏺ Recording Notice — Sarah"');

const LOBBY = `
  <div id="app"><div class="waiting-room-container">Please wait, the meeting host will let you in soon.</div></div>`;

const ADMITTED = `
  <div id="app"><div id="wc-footer"></div>
    <button class="footer-button__leave-btn" aria-label="Leave meeting"></button></div>`;

const DENIED = `
  <div id="app"><div class="error-message">The host has removed you from this meeting.</div></div>`;

describe('zoomAdapter.detectPhase', () => {
  it('reads name-entry when the guest-name field is empty', () => {
    expect(zoomAdapter.detectPhase(dom(NAME_ENTRY))).toBe('name-entry');
  });
  it('reads ready-to-join once the name is filled', () => {
    expect(zoomAdapter.detectPhase(dom(READY))).toBe('ready-to-join');
  });
  it('reads lobby while waiting for the host', () => {
    expect(zoomAdapter.detectPhase(dom(LOBBY))).toBe('lobby');
  });
  it('reads admitted once in the call (footer / leave control present)', () => {
    expect(zoomAdapter.detectPhase(dom(ADMITTED))).toBe('admitted');
  });
  it('reads denied when removed / declined', () => {
    expect(zoomAdapter.detectPhase(dom(DENIED))).toBe('denied');
  });
  it('reads loading for an empty / not-yet-rendered page', () => {
    expect(zoomAdapter.detectPhase(dom('<div id="app"></div>'))).toBe('loading');
  });
  it('prioritizes admitted over a lingering prejoin form', () => {
    // A stale name input still in the DOM must not mask the in-call state.
    const mixed = ADMITTED + `<input id="input-for-name" value="" />`;
    expect(zoomAdapter.detectPhase(dom(mixed))).toBe('admitted');
  });
  it('prioritizes denied over a lingering prejoin form', () => {
    // A stale name input still in the DOM must not mask the removed state.
    const mixed = DENIED + `<input id="input-for-name" value="" />`;
    expect(zoomAdapter.detectPhase(dom(mixed))).toBe('denied');
  });
});

describe('zoomAdapter.fillGuestName', () => {
  it('sets the name field and fires input/change events (React-controlled)', () => {
    const doc = dom(NAME_ENTRY);
    let inputFired = false;
    let changeFired = false;
    doc.querySelector('#input-for-name')!.addEventListener('input', () => {
      inputFired = true;
    });
    doc.querySelector('#input-for-name')!.addEventListener('change', () => {
      changeFired = true;
    });
    expect(zoomAdapter.fillGuestName(doc, '⏺ Recording Notice — Sarah')).toBe(true);
    const input = doc.querySelector<HTMLInputElement>('#input-for-name')!;
    expect(input.value).toBe('⏺ Recording Notice — Sarah');
    expect(inputFired).toBe(true);
    expect(changeFired).toBe(true);
  });
  it('sets the fallback name field', () => {
    const doc = dom(NAME_ENTRY.replace('id="input-for-name"', 'id="inputname"'));
    expect(zoomAdapter.fillGuestName(doc, 'Recording Notice')).toBe(true);
    expect(doc.querySelector<HTMLInputElement>('#inputname')!.value).toBe('Recording Notice');
  });
  it('returns false when there is no name field', () => {
    expect(zoomAdapter.fillGuestName(dom(LOBBY), 'x')).toBe(false);
  });
});

describe('zoomAdapter.ensureMuted', () => {
  it('clicks the mic toggle when currently unmuted', () => {
    const doc = dom(NAME_ENTRY);
    let clicks = 0;
    doc.querySelector('[aria-label="Mute microphone"]')!.addEventListener('click', () => {
      clicks += 1;
    });
    expect(zoomAdapter.ensureMuted(doc)).toBe(true);
    expect(clicks).toBe(1);
  });
  it('does not click when already muted', () => {
    const html = NAME_ENTRY.replace('aria-label="Mute microphone" aria-pressed="false"', 'aria-label="Unmute microphone" aria-pressed="true"');
    const doc = dom(html);
    let clicks = 0;
    doc.querySelector('[aria-label="Unmute microphone"]')!.addEventListener('click', () => {
      clicks += 1;
    });
    expect(zoomAdapter.ensureMuted(doc)).toBe(true);
    expect(clicks).toBe(0);
  });
  it('returns false when no mic toggle is present', () => {
    expect(zoomAdapter.ensureMuted(dom(LOBBY))).toBe(false);
  });
  it('can briefly unmute for the spoken announcement and then mute again', () => {
    const doc = dom(NAME_ENTRY);
    const toggle = doc.querySelector('[aria-label="Mute microphone"]');
    if (!(toggle instanceof HTMLElement)) throw new Error('missing Zoom mic toggle');
    let muted = false;
    toggle.addEventListener('click', () => {
      muted = !muted;
      toggle.setAttribute('aria-label', muted ? 'Unmute microphone' : 'Mute microphone');
      toggle.setAttribute('aria-pressed', muted ? 'true' : 'false');
    });

    expect(zoomAdapter.ensureMuted(doc)).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe('Unmute microphone');
    expect(zoomAdapter.setMuted(doc, false)).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe('Mute microphone');
    expect(zoomAdapter.setMuted(doc, true)).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe('Unmute microphone');
  });
});

describe('zoomAdapter.clickJoin', () => {
  it('clicks the join button', () => {
    const doc = dom(READY);
    let clicks = 0;
    doc.querySelector('#joinBtn')!.addEventListener('click', () => {
      clicks += 1;
    });
    expect(zoomAdapter.clickJoin(doc)).toBe(true);
    expect(clicks).toBe(1);
  });
  it('returns false when the join button is disabled', () => {
    const doc = dom(READY.replace('<button id="joinBtn">', '<button id="joinBtn" disabled>'));
    expect(zoomAdapter.clickJoin(doc)).toBe(false);
  });
  it('returns false when no join button is present', () => {
    expect(zoomAdapter.clickJoin(dom(LOBBY))).toBe(false);
  });
});

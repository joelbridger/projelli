import { describe, it, expect } from 'vitest';
import { teamsAdapter } from './teamsAdapter';

/**
 * Recorded Teams web-client prejoin/meeting DOM fixtures. Minimal but keyed off
 * the SAME selectors/text the adapter targets. VERIFY-LIVE: the live bench pass
 * confirms these selectors still match the real Teams web client after any
 * platform update (the adapter fails soft to the verbal-notice fallback if
 * they drift, so a mismatch degrades, never breaks the recording).
 */
function dom(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const NAME_ENTRY = `
  <div id="app">
    <div data-tid="prejoin-screen">
      <input data-tid="prejoin-display-name-input" type="text" value="" aria-label="Type your name" />
      <button data-tid="toggle-mute" aria-label="Mute microphone" aria-pressed="false"></button>
      <button data-tid="prejoin-join-button">Join now</button>
    </div>
  </div>`;

const READY = NAME_ENTRY.replace('value=""', 'value="⏺ Recording Notice — Sarah"');

const LOBBY = `
  <div id="app"><div data-tid="lobby-screen-title">Someone in the meeting should let you in soon</div></div>`;

const ADMITTED = `
  <div id="app"><div data-tid="calling-retention-banner"></div>
    <button data-tid="call-hangup" aria-label="Leave"></button></div>`;

const DENIED = `
  <div id="app"><div data-tid="rejoin-title">You've been removed from this meeting</div></div>`;

describe('teamsAdapter.detectPhase', () => {
  it('reads name-entry when the guest-name field is empty', () => {
    expect(teamsAdapter.detectPhase(dom(NAME_ENTRY))).toBe('name-entry');
  });
  it('reads ready-to-join once the name is filled', () => {
    expect(teamsAdapter.detectPhase(dom(READY))).toBe('ready-to-join');
  });
  it('reads lobby while waiting for the host', () => {
    expect(teamsAdapter.detectPhase(dom(LOBBY))).toBe('lobby');
  });
  it('reads admitted once in the call (hangup control present)', () => {
    expect(teamsAdapter.detectPhase(dom(ADMITTED))).toBe('admitted');
  });
  it('reads denied when removed / declined', () => {
    expect(teamsAdapter.detectPhase(dom(DENIED))).toBe('denied');
  });
  it('reads loading for an empty / not-yet-rendered page', () => {
    expect(teamsAdapter.detectPhase(dom('<div id="app"></div>'))).toBe('loading');
  });
  it('prioritizes admitted/denied over a lingering prejoin form', () => {
    // A stale name input still in the DOM must not mask the in-call state.
    const mixed = ADMITTED + `<input data-tid="prejoin-display-name-input" value="" />`;
    expect(teamsAdapter.detectPhase(dom(mixed))).toBe('admitted');
  });
});

describe('teamsAdapter.fillGuestName', () => {
  it('sets the name field and fires an input event (React-controlled)', () => {
    const doc = dom(NAME_ENTRY);
    let fired = false;
    doc.querySelector('[data-tid="prejoin-display-name-input"]')!.addEventListener('input', () => {
      fired = true;
    });
    expect(teamsAdapter.fillGuestName(doc, '⏺ Recording Notice — Sarah')).toBe(true);
    const input = doc.querySelector<HTMLInputElement>('[data-tid="prejoin-display-name-input"]')!;
    expect(input.value).toBe('⏺ Recording Notice — Sarah');
    expect(fired).toBe(true);
  });
  it('returns false when there is no name field', () => {
    expect(teamsAdapter.fillGuestName(dom(LOBBY), 'x')).toBe(false);
  });
});

describe('teamsAdapter.ensureMuted', () => {
  it('clicks the mic toggle when currently unmuted', () => {
    const doc = dom(NAME_ENTRY);
    let clicks = 0;
    doc.querySelector('[data-tid="toggle-mute"]')!.addEventListener('click', () => {
      clicks += 1;
    });
    expect(teamsAdapter.ensureMuted(doc)).toBe(true);
    expect(clicks).toBe(1);
  });
  it('does not click when already muted', () => {
    const html = NAME_ENTRY.replace('aria-label="Mute microphone" aria-pressed="false"', 'aria-label="Unmute microphone" aria-pressed="true"');
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
  it('clicks the join button', () => {
    const doc = dom(READY);
    let clicks = 0;
    doc.querySelector('[data-tid="prejoin-join-button"]')!.addEventListener('click', () => {
      clicks += 1;
    });
    expect(teamsAdapter.clickJoin(doc)).toBe(true);
    expect(clicks).toBe(1);
  });
  it('returns false when no join button is present', () => {
    expect(teamsAdapter.clickJoin(dom(LOBBY))).toBe(false);
  });
});

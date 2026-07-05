import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { dismissOverlayScript } from '../overlay-dismiss.mjs';

/** Actually EXECUTE the generated script against a minimal fake DOM (same
 * pattern as click-by-text.test.mjs) to catch the real regression this
 * covers: the fallback must prefer a button labeled aria-label="Close" over
 * blindly clicking the first button in the dialog. */
function runAgainstFakeDom(js, { dialogButtons }) {
  const clicked = [];
  const makeButton = (text, ariaLabel) => ({
    tagName: 'BUTTON',
    textContent: text,
    getAttribute: (name) => (name === 'aria-label' ? ariaLabel ?? null : null),
    click: () => clicked.push({ text, ariaLabel }),
  });
  const buttons = dialogButtons.map(([text, ariaLabel]) => makeButton(text, ariaLabel));
  const dialog = { querySelectorAll: (sel) => (sel === 'button' ? buttons : []) };
  const context = vm.createContext({
    document: {
      querySelectorAll: (selector) => (selector === '[data-state="open"]' ? [] : [dialog]),
      dispatchEvent: () => {},
    },
    KeyboardEvent: function KeyboardEvent(type, opts) {
      this.type = type;
      Object.assign(this, opts);
    },
  });
  const result = vm.runInContext(js, context);
  return { result, clicked };
}

describe('dismissOverlayScript', () => {
  it('dispatches a real Escape keydown and keyup and reports open-element counts before/after', () => {
    const js = dismissOverlayScript();
    expect(js).toContain("key: 'Escape'");
    expect(js).toContain("new KeyboardEvent('keydown'");
    expect(js).toContain("new KeyboardEvent('keyup'");
    expect(js).toContain('data-state="open"');
    expect(js).toContain('before');
    expect(js).toContain('after');
  });

  it('also falls back to clicking a button inside any still-open dialog/modal container', () => {
    const js = dismissOverlayScript();
    expect(js).toContain('role="dialog"');
    expect(js).toContain('data-testid$="-modal"');
    expect(js).toContain("querySelectorAll('button')");
  });

  it('prefers a button labeled aria-label="Close" over the first button in the dialog', () => {
    // Root-caused live (2026-07-04): the Account modal's first button in DOM
    // order is "Upload photo" — a real native OS file-picker trigger, not a
    // close action. Blindly clicking the first button opened a native file
    // dialog that silently broke CDP visibility for the rest of the bench
    // session. The Account modal's real close control is a later, icon-only
    // button with aria-label="Close".
    const js = dismissOverlayScript();
    const { clicked } = runAgainstFakeDom(js, {
      dialogButtons: [
        ['Upload photo', null],
        ['', 'Close'],
        ['Account', null],
      ],
    });
    expect(clicked).toEqual([{ text: '', ariaLabel: 'Close' }]);
  });

  it('falls back to the first button when no aria-label="Close" button exists (Draft follow-up modal case)', () => {
    // Confirmed live: this custom modal does not close on Escape, but its
    // first button IS the icon-only close control (no aria-label though).
    const js = dismissOverlayScript();
    const { clicked } = runAgainstFakeDom(js, {
      dialogButtons: [
        ['', null],
        ['Draft follow-up', null],
      ],
    });
    expect(clicked).toEqual([{ text: '', ariaLabel: null }]);
  });

  it('is syntactically valid JS', () => {
    // Test-only syntax check on our own generated script, never on
    // untrusted/external input — see the same note in click-by-text.test.mjs.
    expect(() => new Function(`return ${dismissOverlayScript()}`)).not.toThrow();
  });
});

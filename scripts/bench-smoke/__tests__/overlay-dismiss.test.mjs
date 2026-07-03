import { describe, it, expect } from 'vitest';
import { dismissOverlayScript } from '../overlay-dismiss.mjs';

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

  it('also falls back to clicking the first button inside any still-open dialog/modal container', () => {
    // Confirmed live: a custom "Draft follow-up" modal does not close on
    // Escape, but its first button IS the icon-only close control.
    const js = dismissOverlayScript();
    expect(js).toContain('role="dialog"');
    expect(js).toContain('data-testid$="-modal"');
    expect(js).toContain('d.querySelector(\'button\')');
  });

  it('is syntactically valid JS', () => {
    // Test-only syntax check on our own generated script, never on
    // untrusted/external input — see the same note in click-by-text.test.mjs.
    expect(() => new Function(`return ${dismissOverlayScript()}`)).not.toThrow();
  });
});

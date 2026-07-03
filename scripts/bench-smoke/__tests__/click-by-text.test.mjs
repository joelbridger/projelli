import { describe, it, expect } from 'vitest';
import { clickByTextScript } from '../click-by-text.mjs';

describe('clickByTextScript', () => {
  it('builds a self-contained script that searches, clicks, and reports outcome', () => {
    const js = clickByTextScript('Sync now');
    expect(js).toContain("'Sync now'.toLowerCase()");
    expect(js).toContain('querySelectorAll');
    expect(js).toContain('match.click()');
    expect(js).toContain("'not-found'");
    expect(js).toContain("'clicked'");
  });

  it('escapes embedded single quotes and backslashes so the script stays syntactically valid', () => {
    const js = clickByTextScript("it's a \\test");
    // Must not contain an unescaped `'s ` that would terminate the string early.
    expect(js).toContain("it\\'s a \\\\test");
    // new Function() here only parses our OWN generated script (never
    // untrusted/external input) to prove it's syntactically valid JS — this
    // is a test-only syntax check, not code run against user-controlled data.
    expect(() => new Function(`return ${js}`)).not.toThrow();
  });

  it('collapses newlines in the needle to spaces', () => {
    const js = clickByTextScript('line one\nline two');
    expect(js).not.toContain('\n');
  });
});

import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { clickByTextScript } from '../click-by-text.mjs';

/**
 * Actually EXECUTE the generated script against a minimal fake DOM (via
 * Node's vm module), rather than only asserting on its source text — needed
 * to catch the real regression this covers: a matched real <button> (Grid
 * view's file cards, which open on a single click via onClick) must always
 * get match.click(), never a bare dblclick dispatch, even when double:true
 * was requested for the OTHER case (Tree view's plain-text rows, which have
 * no button semantics and do need a dblclick). Faking a DOM here means this
 * test would have failed against the pre-fix version of click-by-text.mjs.
 */
function runAgainstFakeDom(js, { controlTexts = [], leafTexts = [] }) {
  const clicked = [];
  const dispatched = [];
  const makeEl = (text) => ({
    children: [],
    textContent: text,
    getAttribute: () => null,
    click: () => clicked.push(text),
    dispatchEvent: (ev) => dispatched.push({ text, type: ev.type }),
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
  });
  const controlEls = controlTexts.map(makeEl);
  const leafEls = leafTexts.map(makeEl);
  class FakeMouseEvent {
    constructor(type, opts) {
      this.type = type;
      Object.assign(this, opts);
    }
  }
  const context = vm.createContext({
    document: {
      querySelectorAll: (selector) => {
        if (selector === 'body *') return leafEls;
        return controlEls; // the controls-tier selector string
      },
    },
    window: {},
    MouseEvent: FakeMouseEvent,
  });
  const result = vm.runInContext(js, context);
  return { result, clicked, dispatched };
}

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

  it('falls back to a leaf-element (no element children) text search when no control matches', () => {
    // Needed for file-tree rows: plain divs/spans with no data-testid, button,
    // role, or link semantics — desktop-drive.mjs's own snapshot() can't see
    // them either, so this is a deliberately separate second pass.
    const js = clickByTextScript('Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx');
    expect(js).toContain('children.length === 0');
    expect(js).toContain("document.querySelectorAll('body *')");
  });

  describe('double:true routing (Grid-card vs Tree-row regression)', () => {
    const FILE_NAME = 'Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx';

    it('single-clicks a matched interactive control (Documents Grid view file card) even when double:true', () => {
      // The bug: Grid view's file cards are real <button>s that open on a
      // single click (onClick). A prior version always dispatched a bare
      // 'dblclick' when double:true, which never fires 'click' on a real
      // button — the file silently never opened.
      const js = clickByTextScript(FILE_NAME, { double: true });
      const { result, clicked, dispatched } = runAgainstFakeDom(js, { controlTexts: [FILE_NAME] });
      expect(result).toBe('clicked');
      expect(clicked).toEqual([FILE_NAME]);
      expect(dispatched).toEqual([]);
    });

    it('dispatches a real dblclick for a leaf-node match (Documents Tree view row) when double:true', () => {
      const js = clickByTextScript(FILE_NAME, { double: true });
      const { result, clicked, dispatched } = runAgainstFakeDom(js, { leafTexts: [FILE_NAME] });
      expect(result).toBe('clicked');
      expect(clicked).toEqual([]);
      expect(dispatched).toEqual([{ text: FILE_NAME, type: 'dblclick' }]);
    });

    it('single-clicks a control when double is not requested at all', () => {
      const js = clickByTextScript(FILE_NAME);
      const { clicked, dispatched } = runAgainstFakeDom(js, { controlTexts: [FILE_NAME] });
      expect(clicked).toEqual([FILE_NAME]);
      expect(dispatched).toEqual([]);
    });

    it('single-clicks a leaf-node match when double is not requested (existing single-click behavior unchanged)', () => {
      const js = clickByTextScript(FILE_NAME);
      const { clicked, dispatched } = runAgainstFakeDom(js, { leafTexts: [FILE_NAME] });
      expect(clicked).toEqual([FILE_NAME]);
      expect(dispatched).toEqual([]);
    });
  });
});

import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement `scrollIntoView` — polyfill it so components
// that auto-scroll (AIChatViewer's messages-end ref, for example) don't
// throw during render in tests.
if (typeof window !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () { /* noop */ };
}

// jsdom's Range implementation returns null from `getClientRects()`.
// CodeMirror uses `textRange(...).getClientRects()` during its measure
// phase; without this polyfill the measure loop throws uncaught.
// Q12 smart-paste tests mount real CodeMirror views to exercise the
// paste path — this shim keeps those from crashing.
if (typeof window !== 'undefined') {
  const proto = (window as unknown as { Range: { prototype: Range } }).Range
    ?.prototype;
  if (proto) {
    if (typeof proto.getBoundingClientRect !== 'function') {
      // @ts-expect-error — patching prototype at test setup
      proto.getBoundingClientRect = function () {
        return {
          x: 0, y: 0, width: 0, height: 0,
          top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}),
        } as DOMRect;
      };
    }
    if (typeof proto.getClientRects !== 'function') {
      // @ts-expect-error — patching prototype at test setup
      proto.getClientRects = function () {
        return { length: 0, item: () => null, [Symbol.iterator]: function*() {} } as unknown as DOMRectList;
      };
    }
  }
}

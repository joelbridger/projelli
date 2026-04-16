import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement `scrollIntoView` — polyfill it so components
// that auto-scroll (AIChatViewer's messages-end ref, for example) don't
// throw during render in tests.
if (typeof window !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () { /* noop */ };
}

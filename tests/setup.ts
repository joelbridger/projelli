import '@testing-library/jest-dom/vitest';

// Initialize i18next so components calling useTranslation() render real
// English strings under test instead of returning the raw key. Tests assert
// against visible copy ("Mobile", "Plugins", etc.) so this has to run before
// any component is rendered. Stream E (i18n) added this — keeps the existing
// test corpus working without modification.
import '../src/i18n';

// pdfjs-dist 5.x uses Promise.withResolvers() which was added in Node 22.
// Node 20 (used in CI and dev) doesn't have it. Polyfill it here.
if (typeof Promise.withResolvers === 'undefined') {
  // @ts-expect-error - polyfill for Node 20
  Promise.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// pdfjs-dist 5.x in Node/jsdom test environment:
// The standard build tries to spawn a web Worker which fails in Node.
// vitest.config.ts aliases 'pdfjs-dist' -> legacy build (handles Node 20).
// We pre-configure GlobalWorkerOptions.workerSrc to the legacy worker file
// using a file:// URL so the fake-worker in-thread import resolves correctly.
// This must run BEFORE any test file imports pdf-extract.ts (setupFiles runs first).
//
// We compute the path using Node's fileURLToPath + process.cwd() to avoid
// relying on import.meta.url (which Vite resolves to http:// in test mode).
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const _pdfjsWorkerAbsPath = resolve(
  process.cwd(),
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
);
const _pdfjsWorkerFileUrl = pathToFileURL(_pdfjsWorkerAbsPath).href;
// Configure pdfjs-dist's GlobalWorkerOptions so the fake-worker import works.
import('pdfjs-dist').then((pdfjsLib) => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = _pdfjsWorkerFileUrl;
}).catch(() => { /* ignore if pdfjs-dist is not available */ });

// pdfjs-dist uses DOMMatrix internally (canvas path transform). jsdom does
// not include DOMMatrix. Provide a minimal stub so PDF.js module loading
// succeeds in the test environment. The stub is not used in extraction logic
// (PDF.js only calls it in its canvas rendering path, which is not exercised
// during text extraction).
if (typeof globalThis.DOMMatrix === 'undefined') {
  // @ts-expect-error - minimal stub sufficient for pdfjs-dist import to succeed
  globalThis.DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true;
    isIdentity = true;
    constructor() {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static fromMatrix(m: any) { return new DOMMatrix(); }
    multiply() { return new DOMMatrix(); }
    translate() { return new DOMMatrix(); }
    scale() { return new DOMMatrix(); }
    rotate() { return new DOMMatrix(); }
    inverse() { return new DOMMatrix(); }
    flipX() { return new DOMMatrix(); }
    flipY() { return new DOMMatrix(); }
    transformPoint() { return { x: 0, y: 0, z: 0, w: 0 }; }
    toFloat32Array() { return new Float32Array(16); }
    toFloat64Array() { return new Float64Array(16); }
    toString() { return 'matrix(1, 0, 0, 1, 0, 0)'; }
  };
}

// jsdom doesn't implement `scrollIntoView` — polyfill it so components
// that auto-scroll (AIChatViewer's messages-end ref, for example) don't
// throw during render in tests.
if (typeof window !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () { /* noop */ };
}

// jsdom's Blob doesn't implement .arrayBuffer(). Production environments
// (modern browsers + Tauri's WebView) have it natively. The `docx`
// library's Packer.toBlob output needs arrayBuffer() to round-trip
// bytes. Patch via a FileReader-based fallback so tests exercising
// docx serialization work under jsdom.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  // @ts-expect-error — patching prototype at test setup
  Blob.prototype.arrayBuffer = function arrayBufferShim(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
      reader.readAsArrayBuffer(this);
    });
  };
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

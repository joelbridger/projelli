// Cross-platform asset copy for the build (replaces Unix-only `mkdir -p` + `cp`,
// which broke the Windows release build — cmd.exe's mkdir rejects `-p`).
// Copies the pdf.js worker and the tesseract-wasm OCR runtime into public/.
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';

const copies = [
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/pdf.worker.min.mjs'],
  ['node_modules/tesseract-wasm/dist/tesseract-worker.js', 'public/ocr/tesseract-worker.js'],
  ['node_modules/tesseract-wasm/dist/tesseract-core.wasm', 'public/ocr/tesseract-core.wasm'],
  ['node_modules/tesseract-wasm/dist/tesseract-core-fallback.wasm', 'public/ocr/tesseract-core-fallback.wasm'],
];

for (const [src, dest] of copies) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`copied ${src} -> ${dest}`);
}

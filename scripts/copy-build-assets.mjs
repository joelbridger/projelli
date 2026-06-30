// Cross-platform asset copy for the build (replaces Unix-only `mkdir -p` + `cp`,
// which broke the Windows release build — cmd.exe's mkdir rejects `-p`).
// Copies the pdf.js worker, tesseract-wasm OCR runtime, and OCR language model
// into public/. These files are gitignored (generated) and must be present before
// Vite runs — predev/prebuild both invoke this script automatically.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createWriteStream } from 'node:fs';
import https from 'node:https';

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

// The English OCR language model is not bundled in the npm package — download it
// from tessdata_fast on first use and cache in public/ocr/. Skipped if already present.
const TRAINEDDATA = 'public/ocr/eng.traineddata';
const TRAINEDDATA_URL =
  'https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata';

if (!existsSync(TRAINEDDATA)) {
  console.log(`downloading ${TRAINEDDATA} from tessdata_fast...`);
  mkdirSync(dirname(TRAINEDDATA), { recursive: true });
  await new Promise((resolve, reject) => {
    function get(url, depth = 0) {
      if (depth > 5) { reject(new Error('too many redirects')); return; }
      https.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          get(res.headers.location, depth + 1);
        } else if (res.statusCode === 200) {
          const out = createWriteStream(TRAINEDDATA);
          res.pipe(out);
          out.on('finish', resolve);
          out.on('error', reject);
        } else {
          reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        }
      }).on('error', reject);
    }
    get(TRAINEDDATA_URL);
  });
  console.log(`downloaded ${TRAINEDDATA}`);
} else {
  console.log(`skipped ${TRAINEDDATA} (already present)`);
}

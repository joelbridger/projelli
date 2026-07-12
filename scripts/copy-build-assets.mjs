// Cross-platform asset copy for the build (replaces Unix-only `mkdir -p` + `cp`,
// which broke the Windows release build — cmd.exe's mkdir rejects `-p`).
// Copies the pdf.js worker, tesseract-wasm OCR runtime, and OCR language model
// into public/. These files are gitignored (generated) and must be present before
// Vite or Vitest runs — predev/prebuild/pretest all invoke this script.
import { mkdirSync, copyFileSync, existsSync, createReadStream, createWriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
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

// The English OCR language model is not bundled in the npm package.
// Pinned to tessdata_fast tag 4.1.0 (same version benchmarked in spikes/ocr-engine/DECISION.md).
// SHA-256 is verified after download so a corrupt or different file is rejected.
const TRAINEDDATA = 'public/ocr/eng.traineddata';
const TRAINEDDATA_URL =
  'https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/eng.traineddata';
const TRAINEDDATA_SHA256 =
  '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2';

async function sha256file(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

if (existsSync(TRAINEDDATA)) {
  const actual = await sha256file(TRAINEDDATA);
  if (actual === TRAINEDDATA_SHA256) {
    console.log(`skipped ${TRAINEDDATA} (present, checksum OK)`);
  } else {
    // Stale or corrupt file — re-download below
    console.warn(`${TRAINEDDATA} checksum mismatch (got ${actual}), re-downloading...`);
    await download();
  }
} else {
  await download();
}

async function download() {
  console.log(`downloading ${TRAINEDDATA} from tessdata_fast@4.1.0...`);
  mkdirSync(dirname(TRAINEDDATA), { recursive: true });
  // Node keeps HTTPS sockets alive by default. A build has no reason to retain
  // this one-off download connection, and a retained socket can otherwise keep
  // `prebuild` alive long after the file and checksum are complete.
  const agent = new https.Agent({ keepAlive: false });
  try {
    await new Promise((resolve, reject) => {
      function get(url, depth = 0) {
        if (depth > 5) { reject(new Error('too many redirects')); return; }
        https.get(url, { agent }, (res) => {
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
  } finally {
    agent.destroy();
  }
  const actual = await sha256file(TRAINEDDATA);
  if (actual !== TRAINEDDATA_SHA256) {
    throw new Error(
      `eng.traineddata checksum mismatch after download — expected ${TRAINEDDATA_SHA256}, got ${actual}. ` +
        'Do not use this file; delete it and re-run the build.'
    );
  }
  console.log(`downloaded ${TRAINEDDATA} (checksum verified)`);
}

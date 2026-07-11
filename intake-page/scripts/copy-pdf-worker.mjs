// Keep the PDF.js worker inside this independently built client app. The
// intake page's CSP permits workers from its own origin only.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerSource = fileURLToPath(new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url));
const workerDestination = fileURLToPath(new URL('../public/pdf.worker.min.mjs', import.meta.url));

mkdirSync(dirname(workerDestination), { recursive: true });
copyFileSync(workerSource, workerDestination);
console.log(`copied PDF.js worker to ${workerDestination}`);

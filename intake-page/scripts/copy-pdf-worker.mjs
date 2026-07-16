// Keep the PDF.js worker inside this independently built client app. The
// intake page's CSP permits workers from its own origin only.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the package through Node instead of assuming this standalone app has
// its own node_modules directory. npm may hoist pdfjs-dist to the repository
// root, while an independent intake-page install keeps it local.
const workerSource = fileURLToPath(
  import.meta.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
);
const workerDestination = fileURLToPath(new URL('../public/pdf.worker.min.mjs', import.meta.url));

mkdirSync(dirname(workerDestination), { recursive: true });
copyFileSync(workerSource, workerDestination);
console.log(`copied PDF.js worker to ${workerDestination}`);

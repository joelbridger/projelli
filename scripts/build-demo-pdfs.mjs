#!/usr/bin/env node
/**
 * build-demo-pdfs.mjs — regenerate the web-demo PDF sample documents.
 *
 * The advisor web demo (keepance.com/try) seeds a fictional client household
 * (the Webbs) whose source files are realistic PDFs and Word docs, not `.md`
 * (see docs/quality/DEMO-RECS-TRACKER.md, rec #1). Word docs are generated at
 * seed time in the browser from the sample-workspace text (the `docx` library
 * runs in-browser). PDFs cannot be generated in the browser — there is no
 * JS PDF *writer* in the bundle — so we pre-build them here as committed binary
 * assets that the seeder fetches and writes to OPFS.
 *
 * Source of truth for each PDF is the matching `*.html` in
 * src/web-demo/sample-docs/. This script renders each to a real, paginated PDF
 * with headless Chrome (the only renderer on the box that produces fonts +
 * tables faithfully). The committed `*.pdf` is a build artifact of the `*.html`.
 *
 * Run from the repo root:  node scripts/build-demo-pdfs.mjs
 * Requires: google-chrome (or chromium) on PATH.
 *
 * Keep the PDF text in sync with the plain-text `content` for the same file in
 * src/web-demo/sample-workspace-advisor.json — that text is what the demo's Ask
 * retriever indexes and cites, so the cited fact must appear in both.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(HERE, '..', 'src', 'web-demo', 'sample-docs');

// One entry per PDF we ship. Add a row here + an HTML file to add a new PDF.
const DOCS = [
  { html: 'beneficiary-designations.html', pdf: 'beneficiary-designations.pdf' },
  { html: 'client-intake.html', pdf: 'client-intake.pdf' },
];

function findChrome() {
  const candidates = ['google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable'];
  for (const bin of candidates) {
    try {
      execFileSync('bash', ['-lc', `command -v ${bin}`], { stdio: 'pipe' });
      return bin;
    } catch {
      /* try next */
    }
  }
  throw new Error('No Chrome/Chromium found on PATH (need google-chrome or chromium).');
}

function main() {
  const chrome = findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'kp-pdf-'));
  try {
    for (const { html, pdf } of DOCS) {
      const htmlPath = join(DOCS_DIR, html);
      const pdfPath = join(DOCS_DIR, pdf);
      if (!existsSync(htmlPath)) throw new Error(`Missing source HTML: ${htmlPath}`);
      execFileSync(
        chrome,
        [
          '--headless=new',
          '--no-sandbox',
          '--disable-gpu',
          ...(process.platform === 'linux' ? ['--password-store=basic'] : []),
          `--user-data-dir=${profile}`,
          '--no-pdf-header-footer',
          `--print-to-pdf=${pdfPath}`,
          `file://${htmlPath}`,
        ],
        { stdio: 'pipe' },
      );
      const size = statSync(pdfPath).size;
      console.log(`  ✓ ${pdf}  (${size.toLocaleString()} bytes)`);
    }
    console.log(`Built ${DOCS.length} demo PDF(s) in ${DOCS_DIR}`);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

main();

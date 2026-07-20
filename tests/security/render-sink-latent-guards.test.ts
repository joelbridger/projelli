// PART 3 — GUARD the two LATENT render sinks so the class cannot silently reopen.
//
// The render-sink sweep (prep/RENDER-SINK-SWEEP-c34.md) found two HTML producers
// whose output is INERT today only because of WHERE it currently goes:
//   S10 — mammoth's `.html` (extractDocxText().html): computed but every caller
//         uses `.plainText`; the `.html` (unfiltered, like docx-preview's hrefs)
//         is never rendered.
//   S11/S12 — docx-io's `markdownToHtml` / `markdownToDocxBytes` and pptx-io's
//         `markdownToHtml`: they serialize to `.docx` / `.pptx` FILE BYTES, never
//         to the live DOM.
// The day a future caller pipes one of these into a DOM sink, it re-opens the S2
// injection class. This guard is a TRIPWIRE: it fails if any production file both
// (a) uses one of those latent producers AND (b) contains a raw-HTML DOM sink.
//
// It is a real mechanism, not a comment: the negative-control block writes a
// deliberately-vulnerable fixture and REQUIRES the scanner to catch it, so a
// green "no violations" on the real tree can never be vacuous.

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SRC = join(__dirname, '..', '..', 'src');

// A raw-HTML DOM sink — the specific syntax, so a comment merely NAMING the sink
// (e.g. "renders as React text, never dangerouslySetInnerHTML") does not match.
const DOM_SINK =
  /dangerouslySetInnerHTML\s*=|\.innerHTML\s*=(?!=)|\.outerHTML\s*=(?!=)|insertAdjacentHTML\s*\(|document\.write\s*\(|createContextualFragment\s*\(/;

// An import (static or dynamic) from the file-serialization converters.
const IMPORTS_DOCX_PPTX = /from\s+['"][^'"]*(docx-io|pptx-io)['"]|import\(\s*['"][^'"]*(docx-io|pptx-io)['"]/;

/**
 * Does this source use one of the LATENT unsafe-HTML producers?
 *  - extractDocxText / markdownToDocxBytes / markdownToRedlineBlocks / mammoth
 *    .convertToHtml — names unique to the docx pipeline.
 *  - markdownToHtml — scoped to files that import it from docx-io/pptx-io, so the
 *    markdown-preview component's OWN local markdownToHtml is not mis-flagged.
 */
function usesLatentProducer(src: string): string[] {
  const hits: string[] = [];
  if (/\bextractDocxText\b/.test(src)) hits.push('extractDocxText().html');
  if (/\bmarkdownToDocxBytes\b/.test(src)) hits.push('markdownToDocxBytes');
  if (/\bmarkdownToRedlineBlocks\b/.test(src)) hits.push('markdownToRedlineBlocks');
  if (/mammoth\.convertToHtml\b/.test(src)) hits.push('mammoth.convertToHtml');
  if (/\bmarkdownToHtml\b/.test(src) && IMPORTS_DOCX_PPTX.test(src)) hits.push('markdownToHtml(docx/pptx)');
  return hits;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

interface Violation {
  file: string;
  producers: string[];
}

/** Files that both use a latent producer AND host a raw-HTML DOM sink. */
function scanForLatentSinkWiring(root: string): Violation[] {
  const violations: Violation[] = [];
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    if (!DOM_SINK.test(src)) continue;
    const producers = usesLatentProducer(src);
    if (producers.length > 0) violations.push({ file, producers });
  }
  return violations;
}

describe('render-sink latent-producer guard (S10 mammoth .html, S11/S12 md→file)', () => {
  it('no production file routes a latent HTML producer into a DOM sink', () => {
    const violations = scanForLatentSinkWiring(SRC);
    expect(
      violations,
      `A latent HTML producer (mammoth .html / docx|pptx markdownToHtml) now reaches a raw-HTML DOM sink.\n` +
        `That re-opens the S2/S7 injection class. Route the output through a sanitizer\n` +
        `(src/platform/security/urlAllowlist.ts + a DOM allow-list pass) before it renders.\n` +
        `Offending files:\n${violations.map((v) => `  ${v.file} — ${v.producers.join(', ')}`).join('\n')}`,
    ).toEqual([]);
  });

  // ── NEGATIVE CONTROLS: the scanner is NOT vacuous ────────────────────────────
  it('CATCHES a file that renders extractDocxText().html (S10 reopened)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'latent-guard-neg-'));
    try {
      writeFileSync(
        join(dir, 'Vulnerable.tsx'),
        [
          `import { extractDocxText } from '@/platform/utils/docx-io';`,
          `export async function Bad({ bytes }: { bytes: ArrayBuffer }) {`,
          `  const { html } = await extractDocxText(bytes);`,
          `  return <div dangerouslySetInnerHTML={{ __html: html }} />;`,
          `}`,
        ].join('\n'),
      );
      const violations = scanForLatentSinkWiring(dir);
      expect(violations.length, 'scanner must flag the vulnerable extractDocxText render').toBe(1);
      expect(violations[0]!.producers).toContain('extractDocxText().html');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CATCHES a file that innerHTMLs docx markdownToHtml output (S11 reopened)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'latent-guard-neg-'));
    try {
      writeFileSync(
        join(dir, 'Vulnerable2.ts'),
        [
          `import { markdownToHtml } from '@/platform/utils/docx-io';`,
          `export function bad(md: string, el: HTMLElement) {`,
          `  el.innerHTML = markdownToHtml(md);`,
          `}`,
        ].join('\n'),
      );
      const violations = scanForLatentSinkWiring(dir);
      expect(violations.length, 'scanner must flag the innerHTML markdownToHtml wiring').toBe(1);
      expect(violations[0]!.producers).toContain('markdownToHtml(docx/pptx)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT flag a file that only serializes to file bytes (no DOM sink)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'latent-guard-pos-'));
    try {
      writeFileSync(
        join(dir, 'Safe.ts'),
        [
          `import { markdownToDocxBytes } from '@/platform/utils/docx-io';`,
          `export async function ok(md: string) {`,
          `  const bytes = await markdownToDocxBytes(md, 'x.docx');`,
          `  return bytes; // file bytes only — never rendered`,
          `}`,
        ].join('\n'),
      );
      expect(scanForLatentSinkWiring(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT flag the markdown-preview component (its local markdownToHtml is not a docx/pptx import)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'latent-guard-pos-'));
    try {
      writeFileSync(
        join(dir, 'LocalMd.tsx'),
        [
          `function markdownToHtml(md: string) { return md; }`,
          `export function Preview({ md }: { md: string }) {`,
          `  return <div dangerouslySetInnerHTML={{ __html: markdownToHtml(md) }} />;`,
          `}`,
        ].join('\n'),
      );
      // No import from docx-io/pptx-io → the scoped markdownToHtml rule does not
      // fire. (This file is the S2 sink's shape; it is out of THIS guard's scope.)
      expect(scanForLatentSinkWiring(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

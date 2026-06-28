/**
 * Corpus manifest drift guard.
 *
 * `corpus/manifest.json` is the SINGLE SOURCE OF TRUTH for which matter (and
 * privilege) each eval-corpus document is indexed under. Two consumers read it:
 *   - the TypeScript eval (`corpus.ts` mirrors it as `DOC_MATTER`),
 *   - the Rust retrieval-quality baseline (`src-tauri/tests/rag_retrieval_quality.rs`),
 * so both languages index the SAME corpus under the SAME matters.
 *
 * This test fails the moment the two TS views diverge — e.g. someone adds a doc
 * to `CORPUS_DOCS` but forgets the manifest, or edits one matter map and not the
 * other. The Rust side reads the JSON directly, so keeping JSON ⇄ `DOC_MATTER`
 * locked here keeps all three in sync.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS_DOCS, DOC_MATTER, corpusManifest, paragraphCount } from './corpus';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(HERE, 'corpus');

describe('eval corpus manifest', () => {
  it('lists exactly the documents in CORPUS_DOCS', () => {
    const manifest = corpusManifest();
    expect(new Set(Object.keys(manifest))).toEqual(new Set(CORPUS_DOCS));
  });

  it('agrees with DOC_MATTER on every document’s matter (no TS↔JSON drift)', () => {
    const manifest = corpusManifest();
    for (const doc of CORPUS_DOCS) {
      expect(manifest[doc], `manifest missing ${doc}`).toBeDefined();
      expect(manifest[doc]!.matterId, `matter mismatch for ${doc}`).toBe(DOC_MATTER[doc]);
    }
  });

  it('uses only valid privilege values', () => {
    const manifest = corpusManifest();
    const valid = new Set(['none', 'attorney-client', 'work-product']);
    for (const [doc, entry] of Object.entries(manifest)) {
      expect(valid.has(entry.privilege), `bad privilege for ${doc}: ${entry.privilege}`).toBe(true);
    }
  });

  it('every listed document exists on disk and has paragraphs', () => {
    for (const doc of CORPUS_DOCS) {
      expect(existsSync(join(CORPUS_DIR, doc)), `${doc} missing on disk`).toBe(true);
      expect(paragraphCount(doc), `${doc} has no paragraphs`).toBeGreaterThan(0);
    }
  });

  it('includes the WS3b distractor documents (confusable client + company)', () => {
    // These are what make the retrieval eval able to catch "wrong document"
    // bugs; if they vanish, the distractor coverage silently disappears.
    for (const doc of [
      'johnston-deposition.md',
      'johnston-engagement-letter.md',
      'nexus-diagnostics-nda.md',
    ] as const) {
      expect(CORPUS_DOCS).toContain(doc);
    }
    // The confusable client lives in its OWN matter, distinct from Johnson.
    expect(DOC_MATTER['johnston-deposition.md']).not.toBe(DOC_MATTER['johnson-deposition.md']);
  });
});

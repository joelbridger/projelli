/**
 * Q11 (Wave 1.5) — Sample workspace seed files.
 *
 * Verifies the three Markdown samples under src/platform/matter/samples exist on
 * disk, contain no em dashes (Lantern voice rule — see
 * `feedback_no_em_dashes.md`), and each begins with a `# Sample:` heading as
 * required by the spec.
 *
 * Kept as a file-system test rather than an import-based one so we catch
 * regressions even if the index.ts file happens to stay in sync.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SAMPLES_DIR = resolve(__dirname, '../../src/platform/matter/samples');

const SAMPLE_FILENAMES = [
  'Sample - Pricing Strategy.md',
  'Sample - Client Intake.md',
  'Sample - Weekly Review.md',
] as const;

describe('onboarding samples', () => {
  for (const filename of SAMPLE_FILENAMES) {
    describe(filename, () => {
      const fullPath = resolve(SAMPLES_DIR, filename);

      it('exists on disk', () => {
        expect(existsSync(fullPath)).toBe(true);
      });

      it('contains no em dashes (U+2014)', () => {
        const contents = readFileSync(fullPath, 'utf-8');
        expect(contents).not.toContain('\u2014');
      });

      it('has a `# Sample:` top-level heading', () => {
        const contents = readFileSync(fullPath, 'utf-8');
        // Spec: top heading must start with `# Sample:` (colon, not em dash).
        expect(contents).toMatch(/^# Sample:\s+/m);
      });

      it('is non-trivial (> 500 chars)', () => {
        const contents = readFileSync(fullPath, 'utf-8');
        expect(contents.length).toBeGreaterThan(500);
      });
    });
  }

  it('exports exactly 3 samples from the index', async () => {
    const mod = await import('../../src/platform/matter/samples/index');
    expect(mod.SAMPLE_FILES).toHaveLength(3);
    const names = mod.SAMPLE_FILES.map((s) => s.filename).sort();
    expect(names).toEqual([...SAMPLE_FILENAMES].sort());
  });

  it('no sample content contains an em dash when imported as raw', async () => {
    const mod = await import('../../src/platform/matter/samples/index');
    for (const sample of mod.SAMPLE_FILES) {
      expect(sample.content, `${sample.filename} should contain no em dashes`).not.toContain('\u2014');
    }
  });
});

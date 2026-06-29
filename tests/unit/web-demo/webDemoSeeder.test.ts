import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeAllSampleFiles, type SampleFile } from '@/web-demo/WebDemoSeeder';

/**
 * Partial-seed safety (the demo must never boot a state that can cite a file
 * which was never written). `writeAllSampleFiles` is the unit that decides
 * whether the seed is complete; `main.tsx` gates retrieval + Client Map seeding
 * on its `ok` result via `seedWebDemoWorkspace().ready`.
 */
describe('writeAllSampleFiles — partial-seed readiness', () => {
  const files: SampleFile[] = [
    { path: '/Webb Household/Webb Financial Plan.docx', content: 'plan', format: 'docx' },
    { path: '/Webb Household/Beneficiary Designations.pdf', content: 'bene', format: 'pdf' },
    { path: '/README.md', content: 'readme', format: 'text' },
  ];

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports ok when every file writes', async () => {
    const written: string[] = [];
    const res = await writeAllSampleFiles(files, async (f) => {
      written.push(f.path);
    });
    expect(res.ok).toBe(true);
    expect(res.failedPaths).toEqual([]);
    expect(written).toHaveLength(3);
  });

  it('reports NOT ok (and names the file) when a write fails on every attempt', async () => {
    const bad = '/Webb Household/Beneficiary Designations.pdf';
    const res = await writeAllSampleFiles(files, async (f) => {
      if (f.path === bad) throw new Error('PDF fetch failed');
    });
    expect(res.ok).toBe(false);
    expect(res.failedPaths).toEqual([bad]);
  });

  it('recovers (ok) when a transient failure succeeds on the one retry', async () => {
    const flaky = '/Webb Household/Beneficiary Designations.pdf';
    const attempts = new Map<string, number>();
    const res = await writeAllSampleFiles(files, async (f) => {
      const n = (attempts.get(f.path) ?? 0) + 1;
      attempts.set(f.path, n);
      if (f.path === flaky && n === 1) throw new Error('transient OPFS write error');
    });
    expect(res.ok).toBe(true);
    expect(res.failedPaths).toEqual([]);
    expect(attempts.get(flaky)).toBe(2); // failed once, retried once, succeeded
  });

  it('retries each failed file only once (a persistent failure is not retried forever)', async () => {
    const bad = '/README.md';
    const attempts = new Map<string, number>();
    const res = await writeAllSampleFiles(files, async (f) => {
      attempts.set(f.path, (attempts.get(f.path) ?? 0) + 1);
      if (f.path === bad) throw new Error('persistent');
    });
    expect(res.ok).toBe(false);
    expect(res.failedPaths).toEqual([bad]);
    expect(attempts.get(bad)).toBe(2); // initial attempt + exactly one retry
  });
});

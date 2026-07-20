/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mergeConfig } from 'vite';
import base from '../../vitest.config';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

/**
 * The clock-sweep config: the project's own vitest config plus a whole-`Date`
 * OFFSET clock, appended AFTER `tests/setup.ts` so it shifts the clock the test
 * itself observes. Driven by `scripts/sweep-test-clock-bombs.mjs`; never the
 * default config, because a suite must also be proven green on the real clock.
 */
export default mergeConfig(base, {
  root: ROOT,
  test: {
    setupFiles: [
      resolve(ROOT, 'tests/setup.ts'),
      resolve(HERE, 'whole-date-offset-clock.setup.ts'),
    ],
  },
});

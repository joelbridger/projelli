// scripts/bench-smoke/vitest.config.mjs — runs the harness's pure-logic unit
// tests in Node, separate from the main jsdom/coverage suite (same pattern as
// scripts/robot/vitest.config.mjs). Run: npm run bench-smoke:test
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['scripts/bench-smoke/**/*.test.mjs'],
  },
});

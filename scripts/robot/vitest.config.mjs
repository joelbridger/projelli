// scripts/robot/vitest.config.mjs — runs the robot's pure-logic unit tests in a
// Node environment, SEPARATE from the main jsdom/coverage suite. The robot is
// standalone .mjs tooling; its tests must not be dragged into src/** coverage
// floors or the jsdom setup. Run:
//   npx vitest run --config scripts/robot/vitest.config.mjs
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['scripts/robot/**/*.test.mjs'],
  },
});

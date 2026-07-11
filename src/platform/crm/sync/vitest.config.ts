import { defineConfig } from 'vitest/config';

/** Keeps this platform-only lane runnable when the app-wide browser setup is unavailable. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/platform/crm/sync/**/*.test.ts'],
  },
});

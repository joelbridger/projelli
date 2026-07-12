import { defineConfig } from 'vitest/config';
import path from 'node:path';

/** Keeps this platform-only lane runnable when the app-wide browser setup is unavailable. */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../..'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/platform/crm/sync/**/*.test.ts'],
  },
});

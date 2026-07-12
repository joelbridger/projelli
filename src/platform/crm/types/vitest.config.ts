import { defineConfig } from 'vitest/config';

// Data-contract tests do not need the app's browser-only PDF setup.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/platform/crm/types/types.test.ts'],
  },
});

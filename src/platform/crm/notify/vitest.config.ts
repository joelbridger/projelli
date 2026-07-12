import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Focused lane runner: avoids unrelated application setup for crypto-only tests. */
export default defineConfig({
  test: {
    environment: 'node',
    include: [path.join(here, 'NotificationClient.test.ts')],
  },
  resolve: {
    alias: {
      '@': path.resolve(here, '../../..'),
    },
  },
});

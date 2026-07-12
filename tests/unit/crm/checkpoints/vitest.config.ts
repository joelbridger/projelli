import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../..');

/** Runs the crypto-only checkpoint tests without the app-wide PDF/browser setup. */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(root, 'src') },
  },
  test: {
    environment: 'node',
    include: [path.resolve(directory, 'checkpointService.test.ts')],
  },
});

import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** CRM engine tests run in Node, without the browser application's setup file. */
export default defineConfig({
  test: {
    environment: 'node',
    include: [path.join(here, '*.test.ts')],
  },
  resolve: { alias: { '@': path.resolve(here, '../../src') } },
});

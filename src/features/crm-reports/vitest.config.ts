import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Focused report checks avoid unrelated document-viewer setup dependencies. */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(here, '../..') } },
  test: {
    environment: 'node',
    include: [path.resolve(here, '*.test.ts')],
  },
});

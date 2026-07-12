import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Focused lane test runner. It avoids unrelated global setup dependencies. */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(here, '../..') } },
  test: {
    environment: 'jsdom',
    include: [path.resolve(here, '*.test.ts'), path.resolve(here, '*.test.tsx')],
    setupFiles: [path.resolve(here, 'testSetup.ts')],
  },
});

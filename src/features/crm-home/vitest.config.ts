import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/** Focused lane test runner. It avoids unrelated global setup dependencies. */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, '../..') } },
  test: { environment: 'jsdom', setupFiles: [path.resolve(__dirname, 'testSetup.ts')] },
});

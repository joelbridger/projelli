import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/** Focused runner for saved CRM views without unrelated app setup. */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, '../..') } },
  test: {
    environment: 'jsdom',
    include: [path.resolve(__dirname, '*.test.tsx')],
    setupFiles: [path.resolve(__dirname, '../crm-home/testSetup.ts')],
  },
});

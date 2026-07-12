import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, '../..') } },
  test: {
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, '../crm-home/testSetup.ts')],
    maxWorkers: Number(process.env['VITEST_MAX_FORKS'] ?? 4),
  },
});

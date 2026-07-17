import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Focused lane runner: intentionally avoids the repository-wide PDF test bootstrap. */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(here, '../..') } },
  test: {
    environment: 'jsdom',
    include: [
      path.resolve(here, 'crmClients.test.tsx'),
      path.resolve(here, '../../foundation-contracts/crm-clients/doorways.test.tsx'),
    ],
  },
});

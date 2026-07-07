/**
 * Stream D-web Group II · Task 2.1
 *
 * Vite build target for the lantern.com/try web demo.
 *
 * Outputs to `dist-web-demo/`. Sets `__LANTERN_DEMO__` so the demo-only
 * surfaces (`src/web-demo/*`) are tree-shaken into the desktop build only
 * when this flag is true. Base path is `/try/` so the bundle resolves
 * assets correctly when Caddy serves it under `lantern.com/try/`.
 *
 * Mounts a separate entry (`src/web-demo/main.tsx`) and a separate
 * `index.demo.html` so the desktop build's index.html stays untouched.
 */

import { defineConfig, mergeConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import baseConfig from './vite.config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'),
) as { version: string };

export default mergeConfig(
  baseConfig,
  defineConfig({
    base: '/try/',
    define: {
      __LANTERN_DEMO__: 'true',
      __LANTERN_DESKTOP__: 'false',
      __LANTERN_VERSION__: JSON.stringify(packageJson.version),
    },
    build: {
      outDir: 'dist-web-demo',
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, 'index.demo.html'),
      },
    },
    // The post-build `mv` lives in the package.json script (`build:web-demo`)
    // so the dist root contains `index.html` for Caddy's default try_files.
  }),
);

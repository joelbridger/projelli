/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // A full Windows run can also launch the intake-page fallback build; leave it process headroom.
    maxWorkers: process.platform === 'win32' ? 2 : undefined,
    setupFiles: ['./tests/setup.ts'],
    // `vitest --changed` follows static imports. These files shape tests at
    // runtime or globally, so any change must re-run the whole suite.
    forceRerunTriggers: [
      '**/package.json',
      '**/package-lock.json',
      '**/vitest.config.ts',
      '**/vite.config*.ts',
      '**/tests/setup.ts',
      '**/tsconfig*.json',
      '**/scripts/test-impact-map.json',
    ],
    include: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'tests/campaign/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
      // ─────────────────────────────────────────────────────────────────────
      // FRONTEND COVERAGE FLOORS — src/** (TypeScript/React) only.
      // These thresholds do NOT cover the Rust engine in src-tauri/.
      // Rust coverage is a separate, later task (see ci.yml rust job).
      //
      // Global floors are set ~2-3 points below the measured overall values
      // (measured 2026-06-19: Lines 49.56 / Funcs 48.52 / Stmts 48.29 / Branches 42.97).
      // Per-area floors are set just below measured per-directory values for
      // sensitive code paths (privacy, licensing, firm, audit, rag).
      //
      // KNOWN GAP: src/platform/providers (Lines ~60, Branches ~47) — provider
      //   egress code has moderate coverage; branch coverage too variable to
      //   floor safely without flapping CI.
      // KNOWN GAP: src/platform/fs (Lines ~34) — filesystem abstraction layer
      //   mostly exercised via integration paths, not unit tests.
      // KNOWN GAP: src/platform/state (Lines ~26) — Zustand store code;
      //   low direct unit coverage, exercised indirectly. Floor deferred.
      // ─────────────────────────────────────────────────────────────────────
      thresholds: {
        // Global floors (all src/**)
        lines: 47,
        functions: 46,
        statements: 46,
        branches: 40,

        // Per-area floors for sensitive code: privacy / licensing / firm / audit / rag
        // NOTE: glob thresholds aggregate ALL files under the path (including
        // subdirs like privacy/ui/**) so the effective numbers are lower than
        // the per-directory row shown in the text report. Floors below are set
        // ~2-3 points below the actual measured glob-aggregate values.
        'src/platform/privacy/**': {
          // Measured glob-aggregate: Lines 63.79 / Funcs 71.42 / Stmts 64.54 / Branches 75.43
          // NOTE: src/platform/privacy/ui has very low coverage and pulls these down;
          // the core egress.ts itself is at ~91%. See KNOWN GAP note above for ui sub-dir.
          lines: 61,
          functions: 68,
          statements: 62,
          branches: 72,
        },
        'src/platform/licensing/**': {
          // Measured: Lines ~95 / Funcs 100 / Stmts ~96 / Branches ~95 (no ui subdir)
          lines: 92,
          functions: 97,
          statements: 93,
          branches: 92,
        },
        'src/platform/firm/**': {
          // Measured glob-aggregate: Lines ~73 / Funcs ~69 / Stmts ~71 / Branches ~60
          lines: 70,
          functions: 66,
          statements: 68,
          branches: 57,
        },
        'src/platform/audit/**': {
          // Measured glob-aggregate: Lines ~67 / Funcs ~62 / Stmts ~65 / Branches ~60
          lines: 64,
          functions: 59,
          statements: 62,
          branches: 57,
        },
        'src/platform/rag/**': {
          // Measured glob-aggregate: Lines 85.48 / Funcs 85.18 / Stmts 83.04 / Branches 72.5
          // NOTE: rag/ui sub-dir pulls lines/funcs down from the rag core's ~95%.
          lines: 83,
          functions: 82,
          statements: 80,
          branches: 70,
        },
      },
    },
  },
  resolve: {
    alias: {
      // Single catch-all for the 5-layer tree (app/features/platform/ui/lib).
      '@': path.resolve(__dirname, './src'),
      // Stream A2: pdfjs-dist standard build requires a web worker and browser
      // canvas APIs. In the Vitest jsdom environment (Node 20), use the legacy
      // build instead, which runs in-thread without a web worker.
      'pdfjs-dist': path.resolve(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'),
    },
  },
});

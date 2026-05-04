import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Bundles the plugin to a single-file IIFE at dist/index.js. The Projelli
// plugin runner loads this file via a blob URL inside a sandboxed worker, so
// the bundle must be self-contained (no external imports left behind).
//
// Mermaid is loaded at render time inside the sidebar iframe via a CDN <script>
// tag (see src/index.ts for why), so it's NOT bundled into this artifact.
// That keeps the worker bundle small and avoids running a DOM-heavy library
// in a Web Worker context.
export default defineConfig({
  build: {
    target: 'es2022',
    minify: false,
    sourcemap: false,
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'MermaidPreviewPlugin',
      formats: ['iife'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: [],
      output: {
        extend: false,
      },
    },
  },
});

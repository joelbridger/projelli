import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Bundles the plugin to a single-file ES module at dist/index.js. The Keepance
// plugin runner loads this file via a blob URL and dynamic `import()` inside
// a sandboxed worker, then reads the module's `default` export, so the bundle
// must be a real ES module (not IIFE) and self-contained.
export default defineConfig({
  build: {
    target: 'es2022',
    minify: false,
    sourcemap: false,
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // No externals: the bundle is self-contained for the runtime.
      external: [],
    },
  },
});

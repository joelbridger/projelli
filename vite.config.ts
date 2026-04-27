import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json once at config-load time so the in-app About panel
// can show the same version the bundle was built with.
const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')
) as { version: string };

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Surfaced via `import.meta.env.VITE_APP_VERSION` in the renderer.
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version),
    // Marketing-capture bridge gate. When unset at build time, Rollup
    // statically evaluates the condition to false and tree-shakes the
    // dynamic import of marketing-capture-bridge.ts out of the bundle.
    'import.meta.env.VITE_MARKETING_CAPTURE': JSON.stringify(
      process.env['VITE_MARKETING_CAPTURE'] ?? ''
    ),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/components': path.resolve(__dirname, './src/components'),
      '@/modules': path.resolve(__dirname, './src/modules'),
      '@/stores': path.resolve(__dirname, './src/stores'),
      '@/hooks': path.resolve(__dirname, './src/hooks'),
      '@/types': path.resolve(__dirname, './src/types'),
      '@/utils': path.resolve(__dirname, './src/utils'),
      '@/lib': path.resolve(__dirname, './src/lib'),
      '@/tools': path.resolve(__dirname, './src/tools'),
    },
  },
  // Vite dev server configuration
  server: {
    port: 5173,
    strictPort: true,
    // For Tauri development
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    // Proxy API requests to bypass CORS in development
    // These proxies forward requests from the browser to the AI API servers
    proxy: {
      // Anthropic Claude API proxy
      '/api/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
        headers: {
          // Remove origin header to prevent API rejection
          'Origin': '',
        },
      },
      // OpenAI API proxy
      '/api/openai': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/openai/, ''),
        headers: {
          'Origin': '',
        },
      },
      // Google Gemini API proxy
      '/api/google': {
        target: 'https://generativelanguage.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/google/, ''),
        headers: {
          'Origin': '',
        },
      },
    },
  },
  // Build configuration
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: process.env['TAURI_PLATFORM'] === 'windows' ? 'chrome105' : 'safari14',
    // Prevent minification in debug builds for better debugging
    minify: !process.env['TAURI_DEBUG'] ? 'esbuild' : false,
    // Enable source maps for debugging
    sourcemap: !!process.env['TAURI_DEBUG'],
  },
  // Clear screen on rebuild
  clearScreen: false,
});

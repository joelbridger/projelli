import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Optional HTTPS for the dev server. The browser File System Access API
// (workspace folder picker) only works in a secure context, so opening the
// dev server over a plain-http Tailscale/LAN IP disables it. Set
// LANTERN_DEV_HTTPS=1 and provide .certs/dev-{cert,key}.pem to serve over
// https so the folder picker works when testing remotely. Off by default.
const devCertPath = path.resolve(__dirname, '.certs/dev-cert.pem');
const devKeyPath = path.resolve(__dirname, '.certs/dev-key.pem');
const devHttps =
  process.env['LANTERN_DEV_HTTPS'] === '1' && existsSync(devCertPath) && existsSync(devKeyPath)
    ? { cert: readFileSync(devCertPath), key: readFileSync(devKeyPath) }
    : undefined;

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
      // Single catch-all for the 5-layer tree (app/features/platform/ui/lib).
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Pre-bundle the heavy, lazily-imported deps so the FIRST runtime import
  // (workspace PDF text extraction; scanned-PDF OCR) does not trigger a
  // mid-session Vite dependency re-optimization + full page reload. That reload
  // interrupts in-progress work (and on some WebView2 dev benches tears down the
  // dev server entirely, silently aborting PDF indexing). Dev-only: optimizeDeps
  // is ignored by production builds.
  optimizeDeps: {
    include: ['pdfjs-dist', 'tesseract-wasm'],
  },
  // Vite dev server configuration
  server: {
    // Tauri's debug binary loads this address directly. Keep `npm run dev`
    // and the native app on the same stable port so live-loop launches do not
    // leave the desktop window on its static loading screen.
    port: 5174,
    strictPort: true,
    // design/ui-iteration branch ONLY: allow the tailscale HTTPS host so Jameson can
    // review over https://<machine>.ts.net (a secure context, which the workspace
    // File System Access API requires). Never merges to the product build.
    allowedHosts: ['.ts.net'],
    ...(devHttps ? { https: devHttps } : {}),
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
      // Firm backend proxy (dev only). Points at a locally-running firm backend
      // (backend/, Bun). Override the target with FIRM_BACKEND_TARGET. `ws: true`
      // forwards the matter-sync WebSocket upgrade too.
      '/api/firm': {
        target: process.env['FIRM_BACKEND_TARGET'] ?? 'http://127.0.0.1:5290',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api\/firm/, ''),
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
    rollupOptions: {
      output: {
        // Split heavy, infrequently-changing deps into named chunks so the
        // browser can cache them independently from app code. Lazy-imported
        // modules that match are placed here; statically-imported ones that
        // were already code-split (e.g. pdfjs via dynamic import in pdf-extract)
        // get stable names instead of random hashes.
        manualChunks(id) {
          // PDF text extraction (pdfjs-dist ~450 kB) — dynamic in pdf-extract.ts
          if (id.includes('/pdfjs-dist/')) return 'chunk-pdf';
          // OCR engine (tesseract-wasm) — dynamic in ocrEngine.ts
          if (id.includes('/tesseract-wasm/')) return 'chunk-ocr';
          // Audio waveform editor (wavesurfer.js ~600 kB) — lazy WaveformEditor
          if (id.includes('/wavesurfer.js/')) return 'chunk-audio';
          // Diagram / markdown-math renderers — lazy MarkdownPreview
          if (id.includes('/mermaid/') || id.includes('/katex/')) return 'chunk-diagrams';
          // Lottie animations (onboarding v2) — already dynamic in LottiePlayer
          if (id.includes('/lottie-web/')) return 'chunk-lottie';
        },
      },
    },
  },
  // Clear screen on rebuild
  clearScreen: false,
});

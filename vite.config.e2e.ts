/**
 * vite.config.e2e.ts — E2E preview-server config
 *
 * Used by `scripts/run-e2e-preview.sh` to:
 *   1. Build the app once (vite build --config vite.config.e2e.ts)
 *   2. Serve the built output (vite preview --config vite.config.e2e.ts)
 *
 * `vite preview` ignores `server.proxy`, so we wire the same four API
 * proxy routes via configurePreviewServer + http-proxy-middleware:
 *
 *   /api/anthropic  → https://api.anthropic.com
 *   /api/openai     → https://api.openai.com
 *   /api/google     → https://generativelanguage.googleapis.com
 *   /api/firm       → FIRM_BACKEND_TARGET (default http://127.0.0.1:5290)
 *                     with WebSocket upgrade forwarding (ws: true equivalent)
 *
 * This exactly mirrors the dev-time `server.proxy` block in vite.config.ts
 * so E2E specs that depend on AI or firm-backend calls behave identically.
 */
import { createRequire } from 'module';
import { mergeConfig, defineConfig } from 'vite';
import type { Plugin } from 'vite';
import baseConfig from './vite.config';

const require = createRequire(import.meta.url);

function previewApiProxy(): Plugin {
  return {
    name: 'preview-api-proxy',
    configurePreviewServer(server) {
      const { createProxyMiddleware } = require('http-proxy-middleware') as typeof import('http-proxy-middleware');

      const firmTarget =
        process.env['FIRM_BACKEND_TARGET'] ?? 'http://127.0.0.1:5290';

      // Three plain HTTP proxy routes (mirrors vite.config.ts server.proxy)
      const httpRoutes: Array<{ path: string; target: string }> = [
        { path: '/api/anthropic', target: 'https://api.anthropic.com' },
        { path: '/api/openai',    target: 'https://api.openai.com' },
        { path: '/api/google',    target: 'https://generativelanguage.googleapis.com' },
      ];

      for (const { path, target } of httpRoutes) {
        server.middlewares.use(
          path,
          createProxyMiddleware({
            target,
            changeOrigin: true,
            pathRewrite: { [`^${path}`]: '' },
            headers: { Origin: '' },
          })
        );
      }

      // Firm backend proxy — includes WebSocket upgrade forwarding.
      // vite preview gives us access to the underlying httpServer; we attach
      // the proxy's upgrade handler there so WS connections are forwarded too.
      const firmProxy = createProxyMiddleware({
        target: firmTarget,
        changeOrigin: true,
        pathRewrite: { '^/api/firm': '' },
        ws: true,
      });

      server.middlewares.use('/api/firm', firmProxy);

      // Forward HTTP upgrade events (WebSocket handshakes) to the firm proxy.
      server.httpServer?.on('upgrade', firmProxy.upgrade as Parameters<typeof server.httpServer.on>[1]);
    },
  };
}

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [previewApiProxy()],
  })
);

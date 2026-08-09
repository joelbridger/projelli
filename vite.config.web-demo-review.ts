/**
 * TEMPORARY, untracked review-only wrapper around vite.config.web-demo.ts —
 * adds a self-signed HTTPS cert to `preview` so the demo build's OPFS-backed
 * seeding (which requires a secure context) works when reviewed over a plain
 * Tailscale IP instead of a real domain. Not committed; delete after review.
 */
import { defineConfig, mergeConfig } from 'vite';
import { readFileSync } from 'node:fs';
import baseConfig from './vite.config.web-demo';

export default mergeConfig(
  baseConfig,
  defineConfig({
    preview: {
      https: {
        cert: readFileSync('/tmp/claude-1000/-home-jameson-kp-reimagine/c6a5d2a1-d7d8-4303-be26-be38da0626b7/scratchpad/certs/cert.pem'),
        key: readFileSync('/tmp/claude-1000/-home-jameson-kp-reimagine/c6a5d2a1-d7d8-4303-be26-be38da0626b7/scratchpad/certs/key.pem'),
      },
    },
  }),
);

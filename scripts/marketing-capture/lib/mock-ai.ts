/**
 * AI replay layer for marketing capture.
 *
 * Option B implementation: a local HTTP SSE proxy server (Node http.createServer)
 * that serves canned SSE chunk streams with paced delays. Playwright's page.route()
 * intercepts same-origin proxy paths (/api/anthropic/**, /api/openai/**,
 * /api/google/**) and redirects them to the local server via route.fetch().
 *
 * Why Option B instead of Option A (Readable stream as route.fulfill body)?
 * Playwright 1.59.1's route.fulfill() hangs when passed a Node Readable stream
 * — the fulfill call never resolves and the test times out. Pre-built Buffer
 * bodies work fine but lose progressive delivery. The local SSE server pattern
 * keeps the connection genuinely open, emitting chunks over time, which the
 * browser sees as a real streaming response.
 */

import type { Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/ai-replays',
);

interface ReplayChunk {
  delayMs: number;
  text: string;
}

interface Replay {
  model: string;
  chunks: ReplayChunk[];
  createdFile?: string;
}

// Track active proxy servers so callers can shut them down.
const activeServers: Server[] = [];

/**
 * Shut down all proxy servers started in this process.
 * Call this in test teardown / after the smoke test completes.
 */
export function closeAllMockServers(): void {
  for (const server of activeServers) {
    try {
      server.close();
    } catch {
      // ignore
    }
  }
  activeServers.length = 0;
}

/**
 * Install route handlers on `page` that intercept all AI provider proxy
 * paths and replay the named fixture as a paced SSE stream.
 *
 * Intercepts:
 *   - /api/anthropic/**   (Vite dev proxy for Anthropic)
 *   - /api/openai/**      (Vite dev proxy for OpenAI)
 *   - /api/google/**      (Vite dev proxy for Google Gemini)
 *
 * @param page        Playwright page
 * @param replayName  Fixture filename without extension (e.g. "launch-plan-stream")
 * @returns           The port the local SSE proxy is listening on
 */
export async function mockAI(page: Page, replayName: string): Promise<number> {
  const fixturePath = path.join(FIXTURES_DIR, `${replayName}.json`);
  const replay: Replay = JSON.parse(readFileSync(fixturePath, 'utf-8'));

  const port = await startSseProxy(replay);

  // Intercept the Vite proxy paths (same-origin relative URLs used in dev mode).
  // Also intercept the absolute provider URLs as a safety net for any code paths
  // that resolve to them (e.g. after a testMode=true URL change).
  const devPaths = [
    '**/api/anthropic/**',
    '**/api/openai/**',
    '**/api/google/**',
    '**/api.anthropic.com/**',
    '**/api.openai.com/**',
    '**/generativelanguage.googleapis.com/**',
  ];

  for (const pattern of devPaths) {
    await page.route(pattern, async (route) => {
      try {
        // Forward to our local SSE proxy.  route.fetch() makes a real HTTP
        // request from the Playwright process (not the browser), so it can
        // reach localhost:PORT even though the page is on localhost:5173.
        const response = await route.fetch({
          url: `http://127.0.0.1:${port}/stream`,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          postData: '{}',
        });
        await route.fulfill({ response });
      } catch (err) {
        // If the proxy is gone (e.g. test already cleaned up), abort gracefully.
        await route.abort('connectionrefused').catch(() => undefined);
        console.warn('[mock-ai] route.fetch error:', err);
      }
    });
  }

  return port;
}

/**
 * Start a local HTTP server that serves one endpoint: POST /stream
 * It replies with paced SSE chunks from the replay fixture.
 *
 * Returns the port it's listening on.
 */
function startSseProxy(replay: Replay): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      // Emit chunks one-by-one with inter-chunk delays.
      let idx = 0;

      const sendNext = () => {
        if (idx >= replay.chunks.length) {
          // Final message_stop event then close.
          res.write('data: {"type":"message_stop"}\n\n');
          res.end();
          return;
        }

        const chunk = replay.chunks[idx++];
        const event = {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: chunk.text },
        };
        res.write(`data: ${JSON.stringify(event)}\n\n`);

        // Schedule next chunk after this chunk's delay.
        const nextChunk = replay.chunks[idx];
        const nextDelay = nextChunk ? nextChunk.delayMs : 0;
        setTimeout(sendNext, nextDelay);
      };

      // First chunk: emit immediately (its own delayMs is relative to request
      // arrival so we apply it as the delay before the first write).
      const firstDelay = replay.chunks[0]?.delayMs ?? 0;
      setTimeout(sendNext, firstDelay);
    });

    activeServers.push(server);

    server.on('error', reject);

    // Listen on a random free port.
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }
      resolve(addr.port);
    });
  });
}

/**
 * AI replay layer for the test robot.
 *
 * Ported from scripts/marketing-capture/lib/mock-ai.ts to ESM .mjs.
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
 *
 * Fixture format: {
 *   model: string,
 *   wireFormat?: 'anthropic' | 'openai',   // default 'anthropic' (back-compat)
 *   chunks: { delayMs: number, text: string }[],
 * }
 * Fixtures directory: scripts/robot/fixtures/ai-replays/<name>.json
 *
 * Wire format matters: the Northcrest Ask path uses the OpenAI provider, whose
 * parser reads `choices[0].delta.content` + `choices[0].finish_reason` and skips
 * `data: [DONE]` (see src/platform/providers/OpenAIProvider.ts). The Anthropic
 * default emits `content_block_delta` / `text_delta` / `message_stop` instead.
 */

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'ai-replays',
);

// ---------------------------------------------------------------------------
// SSE frame builders (pure — unit-testable). One per provider wire format.
// ---------------------------------------------------------------------------

/** One streamed-text delta frame in the requested wire format. */
export function deltaFrame(openai, model, text) {
  if (openai) {
    const event = {
      id: 'chatcmpl-replay',
      object: 'chat.completion.chunk',
      created: 0,
      model: model || 'gpt-4o',
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    };
    return `data: ${JSON.stringify(event)}\n\n`;
  }
  const event = { type: 'content_block_delta', delta: { type: 'text_delta', text } };
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** The closing frame(s) that signal end-of-stream in the requested format. */
export function terminatorFrames(replay) {
  if (replay.wireFormat === 'openai') {
    const stop = {
      id: 'chatcmpl-replay',
      object: 'chat.completion.chunk',
      created: 0,
      model: replay.model || 'gpt-4o',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };
    return `data: ${JSON.stringify(stop)}\n\ndata: [DONE]\n\n`;
  }
  return 'data: {"type":"message_stop"}\n\n';
}

// Track active proxy servers so callers can shut them down.
const activeServers = [];

/**
 * Shut down all proxy servers started in this process.
 * Call this in test teardown / after the smoke test completes.
 */
export function closeAllReplayServers() {
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
 *   - /api/anthropic/**                      (Vite dev proxy for Anthropic)
 *   - /api/openai/**                          (Vite dev proxy for OpenAI)
 *   - /api/google/**                          (Vite dev proxy for Google Gemini)
 *   - /api.anthropic.com/**                  (absolute Anthropic)
 *   - /api.openai.com/**                     (absolute OpenAI)
 *   - /generativelanguage.googleapis.com/**  (absolute Google)
 *
 * @param {object} page        Playwright page
 * @param {string} replayName  Fixture filename without extension (e.g. "launch-plan-stream")
 * @returns {Promise<{ port: number, served: number, report: () => object }>}
 *          A controller. `served` counts how many AI requests the fixture actually
 *          answered — the egress guardrail asserts it is >= 1 so a "deterministic"
 *          run can't silently pass without ever using the fixture.
 */
export async function installAIReplay(page, replayName) {
  const fixturePath = path.join(FIXTURES_DIR, `${replayName}.json`);
  const replay = JSON.parse(readFileSync(fixturePath, 'utf-8'));

  const port = await startSseProxy(replay);
  let served = 0;

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
      served += 1; // an AI request was intercepted + served by the fixture
      try {
        // Forward to our local SSE proxy. route.fetch() makes a real HTTP
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
        console.warn('[aiReplay] route.fetch error:', err);
      }
    });
  }

  return {
    port,
    get served() { return served; },
    report() { return { servedRequests: served, port, model: replay.model, wireFormat: replay.wireFormat || 'anthropic' }; },
  };
}

/**
 * Test alias: load a named fixture and start the SSE proxy directly (no page).
 * Used by unit tests that drive the proxy via fetch() without Playwright.
 *
 * @param {string} name  Fixture name without extension
 * @returns {Promise<number>} The port the local SSE proxy is listening on
 */
export async function _startSseProxyForTest(name) {
  const fixturePath = path.join(FIXTURES_DIR, `${name}.json`);
  const replay = JSON.parse(readFileSync(fixturePath, 'utf-8'));
  return startSseProxy(replay);
}

/**
 * Start a local HTTP server that serves one endpoint: POST /stream
 * It replies with paced SSE chunks from the replay fixture.
 *
 * Returns the port it's listening on.
 *
 * @param {{ model: string, chunks: { delayMs: number, text: string }[] }} replay
 * @returns {Promise<number>}
 */
function startSseProxy(replay) {
  return new Promise((resolve, reject) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      // Emit chunks one-by-one with inter-chunk delays.
      const openai = replay.wireFormat === 'openai';
      let idx = 0;

      const sendNext = () => {
        if (idx >= replay.chunks.length) {
          res.write(terminatorFrames(replay));
          res.end();
          return;
        }

        const chunk = replay.chunks[idx++];
        res.write(deltaFrame(openai, replay.model, chunk.text));

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

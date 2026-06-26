// scripts/robot/__tests__/aiReplay.openai.test.mjs
// The Northcrest Ask path consumes OpenAI's wire format (choices[].delta.content),
// NOT Anthropic's content_block_delta. These tests prove the replay proxy can
// emit provider-accurate OpenAI frames when a fixture asks for them, while the
// existing Anthropic fixtures keep working (back-compat).
import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _startSseProxyForTest, closeAllReplayServers } from '../fixtures/aiReplay.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/ai-replays');
mkdirSync(dir, { recursive: true });
writeFileSync(
  path.join(dir, 'openai-unit.json'),
  JSON.stringify({
    model: 'gpt-4o',
    wireFormat: 'openai',
    chunks: [
      { delayMs: 0, text: 'The total ' },
      { delayMs: 2, text: 'portfolio value is $4.2M.' },
    ],
  }),
);

afterAll(() => closeAllReplayServers());

describe('aiReplay OpenAI wire format', () => {
  it('emits choices[].delta.content frames a real OpenAIProvider parser would accept', async () => {
    const port = await _startSseProxyForTest('openai-unit');
    const res = await fetch(`http://127.0.0.1:${port}/stream`, { method: 'POST', body: '{}' });
    const body = await res.text();

    // Every data line that carries text must parse to choices[0].delta.content.
    const dataLines = body.split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'));
    const reconstructed = dataLines
      .map((l) => {
        try { return JSON.parse(l.slice(6)); } catch { return null; }
      })
      .filter(Boolean)
      .map((ev) => ev.choices?.[0]?.delta?.content || '')
      .join('');
    expect(reconstructed).toBe('The total portfolio value is $4.2M.');

    // Must NOT leak Anthropic shapes, and must terminate with [DONE] + a stop.
    expect(body).not.toContain('content_block_delta');
    expect(body).toContain('"finish_reason":"stop"');
    expect(body).toContain('data: [DONE]');
  });

  it('still defaults to Anthropic frames when wireFormat is absent (back-compat)', async () => {
    const port = await _startSseProxyForTest('hello'); // hello.json has no wireFormat
    const res = await fetch(`http://127.0.0.1:${port}/stream`, { method: 'POST', body: '{}' });
    const body = await res.text();
    expect(body).toContain('content_block_delta');
    expect(body).toContain('message_stop');
    expect(body).not.toContain('finish_reason');
  });
});

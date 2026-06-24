// scripts/robot/__tests__/aiReplay.test.mjs
import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _startSseProxyForTest, closeAllReplayServers } from '../fixtures/aiReplay.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/ai-replays');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'hello.json'), JSON.stringify({ model: 'test', chunks: [
  { delayMs: 0, text: 'Hello ' }, { delayMs: 5, text: 'world' },
] }));

afterAll(() => closeAllReplayServers());

describe('aiReplay SSE proxy', () => {
  it('streams the fixture chunks then message_stop', async () => {
    const port = await _startSseProxyForTest('hello');
    const res = await fetch(`http://127.0.0.1:${port}/stream`, { method: 'POST', body: '{}' });
    const body = await res.text();
    expect(body).toContain('Hello ');
    expect(body).toContain('world');
    expect(body).toContain('message_stop');
  });
});

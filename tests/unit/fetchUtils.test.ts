// Unit tests for safeJsonParse — the Tauri HTTP plugin trailing-byte fix
import { describe, it, expect } from 'vitest';
import { safeJsonParse, ApiResponseParseError } from '@/platform/providers/fetchUtils';

function makeResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('safeJsonParse', () => {
  it('parses valid JSON', async () => {
    const body = JSON.stringify({ hello: 'world' });
    const result = await safeJsonParse<{ hello: string }>(makeResponse(body));
    expect(result.hello).toBe('world');
  });

  it('strips a trailing null byte (the Tauri HTTP plugin bug)', async () => {
    // Simulates the exact bug: valid JSON + one trailing \0
    const body = JSON.stringify({ id: 'test', model: 'claude-3' }) + '\0';
    const result = await safeJsonParse<{ id: string; model: string }>(makeResponse(body));
    expect(result.id).toBe('test');
    expect(result.model).toBe('claude-3');
  });

  it('strips multiple trailing control bytes', async () => {
    const body = JSON.stringify({ x: 1 }) + '\x00\x01\x02';
    const result = await safeJsonParse<{ x: number }>(makeResponse(body));
    expect(result.x).toBe(1);
  });

  it('handles trailing whitespace', async () => {
    const body = JSON.stringify({ y: 2 }) + '\n\n  ';
    const result = await safeJsonParse<{ y: number }>(makeResponse(body));
    expect(result.y).toBe(2);
  });

  it('throws ApiResponseParseError on genuinely malformed JSON', async () => {
    await expect(safeJsonParse(makeResponse('{not valid json'))).rejects.toBeInstanceOf(ApiResponseParseError);
  });

  it('redacts the raw body on the thrown error for diagnostics', async () => {
    const body = '{"client":"Diane private fact","incomplete": ';
    try {
      await safeJsonParse(makeResponse(body));
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseParseError);
      expect((err as ApiResponseParseError).rawBody).toContain('redacted');
      expect((err as ApiResponseParseError).rawBody).not.toContain('Diane private fact');
      expect((err as ApiResponseParseError).toDiagnostic()).not.toContain('Diane private fact');
    }
  });

  it('real-world Claude response with trailing null byte', async () => {
    // Based on the actual bug report from 2026-04-14
    const claudeBody = '{"model":"claude-3-haiku-20240307","id":"msg_01R6JPiNdeEepbXZbYDdUcDJ","type":"message","role":"assistant","content":[{"type":"text","text":"Hello!"}],"stop_reason":"end_turn","usage":{"input_tokens":989,"output_tokens":12}}\0';
    const result = await safeJsonParse<{ id: string; content: Array<{ text: string }> }>(makeResponse(claudeBody));
    expect(result.id).toBe('msg_01R6JPiNdeEepbXZbYDdUcDJ');
    expect(result.content[0]?.text).toBe('Hello!');
  });
});

// Verifies the hash-based incremental behavior of scripts/translate-i18n.mjs.
// We mock the Anthropic SDK so no network call happens; the script's pure
// helpers (flatten, pickMissing, sha256, extractJson) are exercised directly,
// and translateLocale is exercised against the mocked client to confirm the
// loop: skip locked keys, skip up-to-date keys, only call the API for changed
// keys, write __sourceHash on every translated entry, and abort when the
// configured token cap is exceeded.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The script imports `@anthropic-ai/sdk` at module-load time. We need to mock
// before importing the script. We mock the default export to return a class
// whose `messages.create` method is a vi.fn() we control per test.
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

// Typed via the sibling scripts/translate-i18n.d.ts (the script itself is
// plain JS with no inline types).
import {
  flatten,
  unflatten,
  pickMissing,
  sha256,
  extractJson,
  estimateTokens,
  parseFlags,
  translateLocale,
} from '../../../scripts/translate-i18n.mjs';

beforeEach(() => {
  mockCreate.mockReset();
});

function fakeResponse(translations: Record<string, string>) {
  return {
    content: [{ type: 'text', text: JSON.stringify(translations) }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

describe('flatten / unflatten', () => {
  it('round-trips a nested object', () => {
    const input = { a: { b: { c: 'one' }, d: 'two' }, e: 'three' };
    const flat = flatten(input);
    expect(flat).toEqual({ 'a.b.c': 'one', 'a.d': 'two', e: 'three' });
    expect(unflatten(flat)).toEqual(input);
  });

  it('preserves __sourceHash and __locked sibling keys via dotted path', () => {
    const flat = {
      'settings.title': 'Ajustes',
      'settings.title__sourceHash': 'abc',
      'settings.title__locked': true,
    };
    const nested = unflatten(flat);
    expect(nested).toEqual({
      settings: {
        title: 'Ajustes',
        'title__sourceHash': 'abc',
        'title__locked': true,
      },
    });
  });
});

describe('sha256', () => {
  it('is deterministic for the same input', () => {
    expect(sha256('Hello')).toBe(sha256('Hello'));
  });

  it('differs when input changes by a single byte', () => {
    expect(sha256('Hello')).not.toBe(sha256('Hello.'));
  });
});

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it('strips ```json fences', () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('strips bare ``` fences', () => {
    expect(extractJson('```\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('recovers JSON from preamble text', () => {
    expect(extractJson('Here is the result:\n{"a": 1}\nThanks.')).toEqual({ a: 1 });
  });

  it('throws on malformed input', () => {
    expect(() => extractJson('no braces here')).toThrow();
  });
});

describe('pickMissing — incremental hash logic', () => {
  it('flags every key as missing when existing is empty', () => {
    const en = { a: 'one', b: { c: 'two' } };
    const { missing, carryOver } = pickMissing(en, {});
    expect(missing).toEqual([
      ['a', 'one'],
      ['b.c', 'two'],
    ]);
    expect(carryOver).toEqual({});
  });

  it('carries over a key whose __sourceHash matches the en hash', () => {
    const en = { a: 'one' };
    const existing = {
      a: 'uno',
      'a__sourceHash': sha256('one'),
    };
    const { missing, carryOver } = pickMissing(en, existing);
    expect(missing).toEqual([]);
    expect(carryOver).toEqual({
      a: 'uno',
      'a__sourceHash': sha256('one'),
    });
  });

  it('re-translates when the en string changed (hash mismatch)', () => {
    const en = { a: 'one v2' };
    const existing = {
      a: 'uno',
      'a__sourceHash': sha256('one'), // stale hash
    };
    const { missing } = pickMissing(en, existing);
    expect(missing).toEqual([['a', 'one v2']]);
  });

  it('skips __locked keys even when the hash is stale', () => {
    const en = { a: 'one v2' };
    const existing = {
      a: 'uno (manual fix)',
      'a__sourceHash': sha256('one'),
      'a__locked': true,
    };
    const { missing, carryOver } = pickMissing(en, existing);
    expect(missing).toEqual([]);
    expect(carryOver['a']).toBe('uno (manual fix)');
    expect(carryOver['a__locked']).toBe(true);
  });
});

describe('translateLocale — end-to-end with mocked SDK', () => {
  const en = {
    settings: { title: 'Settings', save: 'Save' },
    chat: { send: 'Send' },
  };

  it('makes one batched API call and writes __sourceHash for every translated key', async () => {
    mockCreate.mockResolvedValueOnce(
      fakeResponse({
        'settings.title': 'Ajustes',
        'settings.save': 'Guardar',
        'chat.send': 'Enviar',
      }),
    );
    const client = { messages: { create: mockCreate } };
    const flags = { dryRun: false, batchSize: 50, maxTokens: 5_000_000, model: 'claude-sonnet-4-6' };
    const costTracker = { estimatedTokens: 0, actualInputTokens: 0, actualOutputTokens: 0 };

    const result = await translateLocale(client, 'es', en, {}, flags, costTracker);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.settings.title).toBe('Ajustes');
    expect(result.settings['title__sourceHash']).toBe(sha256('Settings'));
    expect(result.settings['save__sourceHash']).toBe(sha256('Save'));
    expect(result.chat['send__sourceHash']).toBe(sha256('Send'));
    expect(costTracker.actualInputTokens).toBe(100);
    expect(costTracker.actualOutputTokens).toBe(50);
  });

  it('makes ZERO API calls on a no-change re-run', async () => {
    const existing = {
      settings: {
        title: 'Ajustes',
        'title__sourceHash': sha256('Settings'),
        save: 'Guardar',
        'save__sourceHash': sha256('Save'),
      },
      chat: {
        send: 'Enviar',
        'send__sourceHash': sha256('Send'),
      },
    };
    const client = { messages: { create: mockCreate } };
    const flags = { dryRun: false, batchSize: 50, maxTokens: 5_000_000, model: 'claude-sonnet-4-6' };
    const costTracker = { estimatedTokens: 0, actualInputTokens: 0, actualOutputTokens: 0 };

    const result = await translateLocale(client, 'es', en, existing, flags, costTracker);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result).toEqual(existing);
  });

  it('only re-translates the keys whose source hash changed', async () => {
    const existing = {
      settings: {
        title: 'Ajustes',
        'title__sourceHash': sha256('Settings'),
        save: 'Guardar',
        'save__sourceHash': sha256('Save (old)'), // stale
      },
      chat: {
        send: 'Enviar',
        'send__sourceHash': sha256('Send'),
      },
    };
    mockCreate.mockResolvedValueOnce(fakeResponse({ 'settings.save': 'Guardar (nuevo)' }));
    const client = { messages: { create: mockCreate } };
    const flags = { dryRun: false, batchSize: 50, maxTokens: 5_000_000, model: 'claude-sonnet-4-6' };
    const costTracker = { estimatedTokens: 0, actualInputTokens: 0, actualOutputTokens: 0 };

    const result = await translateLocale(client, 'es', en, existing, flags, costTracker);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const userMsg = mockCreate.mock.calls[0]![0].messages[0].content as string;
    expect(userMsg).toContain('settings.save');
    expect(userMsg).not.toContain('"settings.title"');
    expect(result.settings.save).toBe('Guardar (nuevo)');
    expect(result.settings['save__sourceHash']).toBe(sha256('Save'));
    expect(result.settings.title).toBe('Ajustes');
  });

  it('aborts before any API call when the cost cap would be exceeded', async () => {
    const client = { messages: { create: mockCreate } };
    const flags = { dryRun: false, batchSize: 50, maxTokens: 10, model: 'claude-sonnet-4-6' };
    const costTracker = { estimatedTokens: 0, actualInputTokens: 0, actualOutputTokens: 0 };

    await expect(translateLocale(client, 'es', en, {}, flags, costTracker)).rejects.toThrow(
      /Cost cap reached/,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('preserves __locked entries verbatim and skips API call if all are locked', async () => {
    const enSmall = { settings: { title: 'Settings' } };
    const existing = {
      settings: {
        title: 'Llaves API (custom)',
        'title__sourceHash': sha256('Old value'),
        'title__locked': true,
      },
    };
    const client = { messages: { create: mockCreate } };
    const flags = { dryRun: false, batchSize: 50, maxTokens: 5_000_000, model: 'claude-sonnet-4-6' };
    const costTracker = { estimatedTokens: 0, actualInputTokens: 0, actualOutputTokens: 0 };

    const result = await translateLocale(client, 'es', enSmall, existing, flags, costTracker);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.settings.title).toBe('Llaves API (custom)');
    expect(result.settings['title__locked']).toBe(true);
  });

  it('chunks large inputs into multiple API batches respecting batchSize', async () => {
    const enBig: Record<string, string> = {};
    for (let i = 0; i < 7; i++) enBig[`k${i}`] = `value ${i}`;

    const translateBatch = (keys: string[]) => {
      const out: Record<string, string> = {};
      for (const k of keys) out[k] = `T-${k}`;
      return out;
    };
    mockCreate
      .mockImplementationOnce(async (req) => {
        const obj = JSON.parse(extractJsonFromUserMsg(req.messages[0].content));
        return fakeResponse(translateBatch(Object.keys(obj)));
      })
      .mockImplementationOnce(async (req) => {
        const obj = JSON.parse(extractJsonFromUserMsg(req.messages[0].content));
        return fakeResponse(translateBatch(Object.keys(obj)));
      });

    const client = { messages: { create: mockCreate } };
    const flags = { dryRun: false, batchSize: 5, maxTokens: 5_000_000, model: 'claude-sonnet-4-6' };
    const costTracker = { estimatedTokens: 0, actualInputTokens: 0, actualOutputTokens: 0 };

    await translateLocale(client, 'es', enBig, {}, flags, costTracker);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});

describe('estimateTokens + parseFlags', () => {
  it('estimates ~1 token per 4 chars', () => {
    expect(estimateTokens('aaaa')).toBe(1);
    expect(estimateTokens('a'.repeat(40))).toBe(10);
  });

  it('parses --max-tokens, --batch-size, --locale, --dry-run', () => {
    const flags = parseFlags(['--max-tokens=1000', '--batch-size=10', '--locale=es', '--dry-run']);
    expect(flags.maxTokens).toBe(1000);
    expect(flags.batchSize).toBe(10);
    expect(flags.locales).toEqual(['es']);
    expect(flags.dryRun).toBe(true);
  });

  it('defaults when no flags are passed', () => {
    const flags = parseFlags([]);
    expect(flags.locales).toEqual(['es', 'de']);
    expect(flags.dryRun).toBe(false);
    expect(flags.batchSize).toBeGreaterThan(0);
    expect(flags.maxTokens).toBeGreaterThan(0);
  });
});

// Helper used inside chunk test: pull the JSON object body out of the user
// message text, since the script wraps it with a leading prose line.
function extractJsonFromUserMsg(text: string): string {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  return text.slice(first, last + 1);
}

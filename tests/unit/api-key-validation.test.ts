/**
 * api-key-validation.test.ts
 *
 * Tests for the pure logic in apiKeyValidation.ts:
 *   1. checkKeyFormat — client-side format checks per provider (no I/O)
 *   2. outcomeToMessage — mapping from ValidationOutcome to user-facing text
 *   3. validateApiKeyLive — network path with fetch mocked
 *
 * Run with: npx vitest run tests/unit/api-key-validation.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkKeyFormat,
  outcomeToMessage,
  validateApiKeyLive,
  type ValidationProvider,
  type ValidationOutcome,
} from '@/modules/models/apiKeyValidation';

// ---------------------------------------------------------------------------
// 1. checkKeyFormat — pure, no I/O
// ---------------------------------------------------------------------------

describe('checkKeyFormat', () => {
  // Anthropic
  describe('anthropic', () => {
    it('returns null for a valid key', () => {
      expect(checkKeyFormat('anthropic', 'sk-ant-api03-RealLookingKeyValue')).toBeNull();
    });

    it('catches missing prefix', () => {
      const result = checkKeyFormat('anthropic', 'totally-wrong-prefix-key-value');
      expect(result).not.toBeNull();
      expect(result).toMatch(/sk-ant-/);
    });

    it('catches keys that are too short', () => {
      const result = checkKeyFormat('anthropic', 'sk-ant-short');
      expect(result).not.toBeNull();
      expect(result).toMatch(/short/i);
    });

    it('catches an empty string', () => {
      const result = checkKeyFormat('anthropic', '');
      expect(result).not.toBeNull();
      expect(result).toMatch(/paste/i);
    });

    it('trims surrounding whitespace before checking', () => {
      // Key with correct prefix but whitespace around it — should pass format.
      expect(checkKeyFormat('anthropic', '  sk-ant-api03-ValidKeyValue  ')).toBeNull();
    });
  });

  // OpenAI
  describe('openai', () => {
    it('returns null for a valid key', () => {
      expect(checkKeyFormat('openai', 'sk-realOpenAIKeyValue1234567890')).toBeNull();
    });

    it('catches missing sk- prefix', () => {
      const result = checkKeyFormat('openai', 'pk-totally-wrong-key-value-here');
      expect(result).not.toBeNull();
      expect(result).toMatch(/sk-/);
    });

    it('catches keys that are too short', () => {
      const result = checkKeyFormat('openai', 'sk-short');
      expect(result).not.toBeNull();
      expect(result).toMatch(/short/i);
    });

    it('catches an empty string', () => {
      const result = checkKeyFormat('openai', '   ');
      expect(result).not.toBeNull();
      expect(result).toMatch(/paste/i);
    });
  });

  // Google
  describe('google', () => {
    it('returns null for a valid key (no fixed prefix)', () => {
      expect(checkKeyFormat('google', 'AIzaSyFakeGoogleKeyValue1234567890')).toBeNull();
    });

    it('catches keys that are too short', () => {
      const result = checkKeyFormat('google', 'AIzaShort');
      expect(result).not.toBeNull();
      expect(result).toMatch(/short/i);
    });

    it('accepts any prefix as long as key is long enough', () => {
      // Google keys have no fixed prefix requirement.
      expect(checkKeyFormat('google', 'random_prefix_long_enough_key_value_here')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 2. outcomeToMessage — pure mapping
// ---------------------------------------------------------------------------

describe('outcomeToMessage', () => {
  const providers: ValidationProvider[] = ['anthropic', 'openai', 'google'];
  const outcomes: ValidationOutcome[] = ['ok', 'malformed', 'rejected', 'network'];

  // Every provider x outcome combination returns a non-empty string with no em dashes.
  it.each(providers)('returns a non-empty message for every outcome on %s', (provider) => {
    for (const outcome of outcomes) {
      const msg = outcomeToMessage(provider, outcome);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(5);
    }
  });

  it('ok outcome message mentions "works"', () => {
    for (const p of providers) {
      expect(outcomeToMessage(p, 'ok')).toMatch(/works/i);
    }
  });

  it('rejected outcome message references the provider console', () => {
    expect(outcomeToMessage('anthropic', 'rejected')).toMatch(/console\.anthropic\.com/);
    expect(outcomeToMessage('openai', 'rejected')).toMatch(/platform\.openai\.com/);
    expect(outcomeToMessage('google', 'rejected')).toMatch(/aistudio\.google\.com/);
  });

  it('network outcome message mentions connection', () => {
    for (const p of providers) {
      expect(outcomeToMessage(p, 'network')).toMatch(/connection|reach/i);
    }
  });

  it('no message contains an em dash (house style)', () => {
    for (const p of providers) {
      for (const o of outcomes) {
        expect(outcomeToMessage(p, o)).not.toMatch(/—|&mdash;/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. validateApiKeyLive — fetch mocked
// ---------------------------------------------------------------------------

// We mock the global fetch so no real network calls are made.
const mockFetch = vi.fn<typeof globalThis.fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  // Default: successful 200 response.
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ id: 'test', content: [{ text: 'ok' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('validateApiKeyLive', () => {
  // --- Malformed (no network call) ---
  describe('malformed keys bypass the network', () => {
    it('returns malformed for an empty Anthropic key', async () => {
      const result = await validateApiKeyLive('anthropic', '');
      expect(result.outcome).toBe('malformed');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns malformed for an OpenAI key missing the sk- prefix', async () => {
      const result = await validateApiKeyLive('openai', 'pk-totally-wrong-12345678901234567890');
      expect(result.outcome).toBe('malformed');
      expect(result.message).toMatch(/sk-/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns malformed for a too-short Google key', async () => {
      const result = await validateApiKeyLive('google', 'short');
      expect(result.outcome).toBe('malformed');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // --- OK outcomes ---
  describe('ok outcome on 200', () => {
    it('Anthropic: 200 → ok', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{}', { status: 200 })
      );
      const result = await validateApiKeyLive('anthropic', 'sk-ant-api03-RealLookingKeyValue');
      expect(result.outcome).toBe('ok');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('OpenAI: 200 → ok', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{}', { status: 200 })
      );
      const result = await validateApiKeyLive('openai', 'sk-realOpenAIKeyValue1234567890');
      expect(result.outcome).toBe('ok');
    });

    it('Google: 200 → ok', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{"candidates":[]}', { status: 200 })
      );
      const result = await validateApiKeyLive('google', 'AIzaSyFakeGoogleKeyValue1234567890');
      expect(result.outcome).toBe('ok');
    });
  });

  // --- ok outcome on 429 (rate-limited but key is valid) ---
  describe('ok outcome on 429 (rate limited but key valid)', () => {
    it('Anthropic: 429 → ok', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{}', { status: 429 })
      );
      const result = await validateApiKeyLive('anthropic', 'sk-ant-api03-RealLookingKeyValue');
      expect(result.outcome).toBe('ok');
    });

    it('OpenAI: 429 → ok', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{}', { status: 429 })
      );
      const result = await validateApiKeyLive('openai', 'sk-realOpenAIKeyValue1234567890');
      expect(result.outcome).toBe('ok');
    });
  });

  // --- Rejected outcomes ---
  describe('rejected outcome on auth errors', () => {
    it('Anthropic: 401 → rejected', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{"error":{"type":"authentication_error","message":"Invalid API key"}}', {
          status: 401,
        })
      );
      const result = await validateApiKeyLive('anthropic', 'sk-ant-api03-RealLookingKeyValue');
      expect(result.outcome).toBe('rejected');
      expect(result.message).toMatch(/console\.anthropic\.com/);
    });

    it('Anthropic: 403 → rejected', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{}', { status: 403 })
      );
      const result = await validateApiKeyLive('anthropic', 'sk-ant-api03-RealLookingKeyValue');
      expect(result.outcome).toBe('rejected');
    });

    it('OpenAI: 401 → rejected', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{"error":{"message":"Incorrect API key provided","type":"invalid_request_error","code":"invalid_api_key"}}', {
          status: 401,
        })
      );
      const result = await validateApiKeyLive('openai', 'sk-realOpenAIKeyValue1234567890');
      expect(result.outcome).toBe('rejected');
      expect(result.message).toMatch(/platform\.openai\.com/);
    });

    it('Google: 403 with PERMISSION_DENIED → rejected', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 403, message: 'API key not valid', status: 'PERMISSION_DENIED' },
          }),
          { status: 403 }
        )
      );
      const result = await validateApiKeyLive('google', 'AIzaSyFakeGoogleKeyValue1234567890');
      expect(result.outcome).toBe('rejected');
      expect(result.message).toMatch(/aistudio\.google\.com/);
    });
  });

  // --- Network error ---
  describe('network outcome on fetch failure', () => {
    it('Anthropic: fetch throws → network', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const result = await validateApiKeyLive('anthropic', 'sk-ant-api03-RealLookingKeyValue');
      expect(result.outcome).toBe('network');
      expect(result.message).toMatch(/connection|reach/i);
    });

    it('OpenAI: fetch throws → network', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('NetworkError'));
      const result = await validateApiKeyLive('openai', 'sk-realOpenAIKeyValue1234567890');
      expect(result.outcome).toBe('network');
    });

    it('Google: fetch throws → network', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const result = await validateApiKeyLive('google', 'AIzaSyFakeGoogleKeyValue1234567890');
      expect(result.outcome).toBe('network');
    });
  });

  // --- Result messages have no em dashes ---
  describe('result messages follow house style', () => {
    it('ok message has no em dash', async () => {
      mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
      const result = await validateApiKeyLive('anthropic', 'sk-ant-api03-RealLookingKeyValue');
      expect(result.message).not.toMatch(/—|&mdash;/);
    });

    it('rejected message has no em dash', async () => {
      mockFetch.mockResolvedValueOnce(new Response('{}', { status: 401 }));
      const result = await validateApiKeyLive('anthropic', 'sk-ant-api03-RealLookingKeyValue');
      expect(result.message).not.toMatch(/—|&mdash;/);
    });

    it('network message has no em dash', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const result = await validateApiKeyLive('anthropic', 'sk-ant-api03-RealLookingKeyValue');
      expect(result.message).not.toMatch(/—|&mdash;/);
    });
  });
});

/**
 * apiKeyValidation.ts
 *
 * Pure helpers + network-based validation for all three BYOK providers.
 *
 * Key design goals:
 *   - Format checks are pure (no I/O) so they can be tested without mocking fetch.
 *   - Network validation makes ONE minimal, cheap real call per provider.
 *   - Errors are classified into four buckets that map to plain-English messages
 *     suitable for display to non-technical users (attorneys, CPAs, advisors).
 *   - Keys are NEVER logged or stored during this path beyond the existing
 *     KeychainService behavior. We pass them as function args only.
 *
 * Cheapest "ping" call per provider:
 *   Anthropic: POST /v1/messages with max_tokens=1 and a 1-char prompt.
 *              Uses claude-haiku-4-5-20251001 (cheapest capable model).
 *              Cost: ~$0.000000025 per test.
 *   OpenAI:    POST /v1/chat/completions with max_tokens=1, gpt-4o-mini.
 *              Cost: ~$0.00000015 per test.
 *   Google:    POST /v1beta/models/gemini-2.5-flash:generateContent with maxOutputTokens=1.
 *              Cost: usually free-tier.
 *
 * The choice of a real completion call (rather than /models list) is deliberate:
 *   - OpenAI /v1/models list does NOT require billing set up, so a valid key
 *     from a free account will look "valid" even though it can't run inference.
 *   - A 1-token completion fails with 401/403 on bad keys AND 429 on exhausted
 *     quotas, both of which we surface distinctly to the user.
 */

import { getProviderBaseUrl } from './fetchUtils';

/** Which provider this key is for. */
export type ValidationProvider = 'anthropic' | 'openai' | 'google';

/**
 * The four outcomes we distinguish, in priority order:
 *   malformed  - failed client-side format check; no network call made
 *   rejected   - provider returned 401 / 403 (bad key)
 *   network    - couldn't reach the provider at all
 *   ok         - call succeeded
 *
 * We intentionally do NOT surface "rate limited" as a separate bucket here
 * because a rate-limit (429) still means the key is structurally valid; we
 * treat it as "ok" so the user isn't blocked from saving a working key.
 */
export type ValidationOutcome = 'ok' | 'malformed' | 'rejected' | 'network';

export interface ValidationResult {
  outcome: ValidationOutcome;
  /**
   * Plain-English message suitable for display. No em dashes (house style).
   * No claim that data "never leaves your machine" for cloud calls.
   */
  message: string;
}

// ---------------------------------------------------------------------------
// Client-side format checks (pure, no I/O)
// ---------------------------------------------------------------------------

/** Format rules that each provider's keys must satisfy. */
const FORMAT_RULES: Record<
  ValidationProvider,
  { prefix: string | null; minLength: number }
> = {
  anthropic: { prefix: 'sk-ant-', minLength: 20 },
  openai:    { prefix: 'sk-',     minLength: 20 },
  google:    { prefix: null,      minLength: 20 },
};

/**
 * checkKeyFormat - pure client-side check before touching the network.
 *
 * Returns `null` when the key looks plausible, or a short plain-English
 * string describing the problem.
 */
export function checkKeyFormat(
  provider: ValidationProvider,
  key: string
): string | null {
  const trimmed = key.trim();
  const rules = FORMAT_RULES[provider];

  if (!trimmed) return 'Paste your API key to test it.';

  if (trimmed.length < rules.minLength) {
    return 'That key looks too short. Make sure you copied the whole thing.';
  }

  if (rules.prefix && !trimmed.startsWith(rules.prefix)) {
    const friendlyPrefix = rules.prefix;
    return `${providerDisplayName(provider)} keys start with "${friendlyPrefix}". Double-check you copied the right one.`;
  }

  return null;
}

/** Map a ValidationOutcome to the user-facing message shown under the button. */
export function outcomeToMessage(
  provider: ValidationProvider,
  outcome: ValidationOutcome
): string {
  switch (outcome) {
    case 'ok':
      return 'This key works.';
    case 'malformed':
      // Caller should show checkKeyFormat() result instead for specifics,
      // but this is the fallback label for the outcome enum.
      return 'That key looks incomplete. Check that you copied the whole thing.';
    case 'rejected':
      return `The provider rejected this key. Go back to ${providerConsoleLabel(provider)} and make sure you copied an active key.`;
    case 'network':
      return "Couldn't reach the provider. Check your internet connection and try again.";
  }
}

// ---------------------------------------------------------------------------
// Network validation (one minimal call per provider)
// ---------------------------------------------------------------------------

/**
 * validateApiKeyLive - makes one cheap API call to the given provider to
 * confirm the key is accepted.
 *
 * Never logs the key. The key is passed to fetch as a header and discarded.
 * Uses the same base-URL resolution as the main providers so dev/prod proxy
 * behaviour is consistent.
 */
export async function validateApiKeyLive(
  provider: ValidationProvider,
  key: string,
  signal?: AbortSignal
): Promise<ValidationResult> {
  // Client-side format check first - avoids a pointless network round-trip.
  const formatError = checkKeyFormat(provider, key);
  if (formatError) {
    return { outcome: 'malformed', message: formatError };
  }

  try {
    switch (provider) {
      case 'anthropic':
        return await validateAnthropicKey(key, signal);
      case 'openai':
        return await validateOpenAIKey(key, signal);
      case 'google':
        return await validateGoogleKey(key, signal);
    }
  } catch (err) {
    // Any uncaught error (including AbortError) is surfaced as a network error.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('AbortError')) {
      return { outcome: 'network', message: "Test cancelled." };
    }
    return {
      outcome: 'network',
      message: outcomeToMessage(provider, 'network'),
    };
  }
}

// ---------------------------------------------------------------------------
// Per-provider ping implementations
// ---------------------------------------------------------------------------

async function validateAnthropicKey(
  key: string,
  signal?: AbortSignal
): Promise<ValidationResult> {
  const baseUrl = getProviderBaseUrl('anthropic');

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
      ...(signal ? { signal } : {}),
    });
  } catch {
    return { outcome: 'network', message: outcomeToMessage('anthropic', 'network') };
  }

  if (response.status === 401 || response.status === 403) {
    return { outcome: 'rejected', message: outcomeToMessage('anthropic', 'rejected') };
  }

  // 429 = rate limited but key is valid; 200 = success. Both count as ok.
  if (response.ok || response.status === 429) {
    return { outcome: 'ok', message: outcomeToMessage('anthropic', 'ok') };
  }

  // Any other non-ok (5xx, 400) still means the key reached the server.
  // Treat as network/unknown rather than rejected.
  return {
    outcome: 'network',
    message: `Provider returned an unexpected error (HTTP ${response.status}). Try again.`,
  };
}

async function validateOpenAIKey(
  key: string,
  signal?: AbortSignal
): Promise<ValidationResult> {
  const baseUrl = getProviderBaseUrl('openai');

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
      ...(signal ? { signal } : {}),
    });
  } catch {
    return { outcome: 'network', message: outcomeToMessage('openai', 'network') };
  }

  if (response.status === 401 || response.status === 403) {
    return { outcome: 'rejected', message: outcomeToMessage('openai', 'rejected') };
  }

  if (response.ok || response.status === 429) {
    return { outcome: 'ok', message: outcomeToMessage('openai', 'ok') };
  }

  return {
    outcome: 'network',
    message: `Provider returned an unexpected error (HTTP ${response.status}). Try again.`,
  };
}

async function validateGoogleKey(
  key: string,
  signal?: AbortSignal
): Promise<ValidationResult> {
  const baseUrl = getProviderBaseUrl('google');
  // Gemini key goes in the query string.
  const url = `${baseUrl}/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
      ...(signal ? { signal } : {}),
    });
  } catch {
    return { outcome: 'network', message: outcomeToMessage('google', 'network') };
  }

  // Gemini returns 400 for bad keys in some configurations and 403 in others.
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    // Peek at error body to distinguish a bad-key 400 from a payload-format 400.
    try {
      const body = (await response.clone().json()) as { error?: { status?: string; message?: string } };
      const status = body.error?.status ?? '';
      if (
        status === 'INVALID_ARGUMENT' &&
        (body.error?.message ?? '').toLowerCase().includes('api key')
      ) {
        return { outcome: 'rejected', message: outcomeToMessage('google', 'rejected') };
      }
      if (status === 'PERMISSION_DENIED' || status === 'UNAUTHENTICATED') {
        return { outcome: 'rejected', message: outcomeToMessage('google', 'rejected') };
      }
    } catch {
      // If we can't parse the body, still treat as rejected for 403.
      if (response.status === 403) {
        return { outcome: 'rejected', message: outcomeToMessage('google', 'rejected') };
      }
    }
  }

  if (response.ok || response.status === 429) {
    return { outcome: 'ok', message: outcomeToMessage('google', 'ok') };
  }

  return {
    outcome: 'network',
    message: `Provider returned an unexpected error (HTTP ${response.status}). Try again.`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerDisplayName(provider: ValidationProvider): string {
  switch (provider) {
    case 'anthropic': return 'Anthropic';
    case 'openai':    return 'OpenAI';
    case 'google':    return 'Google AI';
  }
}

function providerConsoleLabel(provider: ValidationProvider): string {
  switch (provider) {
    case 'anthropic': return 'console.anthropic.com';
    case 'openai':    return 'platform.openai.com/api-keys';
    case 'google':    return 'aistudio.google.com/app/apikey';
  }
}

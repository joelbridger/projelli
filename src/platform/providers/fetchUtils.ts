// Shared fetch utilities for model providers
// Provides base URL resolution that works in both dev (Vite proxy) and production,
// and a CORS-safe fetch wrapper for production Tauri builds.

// F-120: every fetch handed out here is wrapped so the status bar can show a
// live "sending" pulse while a request is actually in flight.
import { instrumentEgressFetch } from '@/platform/privacy/egressActivity';
import { BRAND } from '@/config/brand';

export type ProviderType = 'anthropic' | 'openai' | 'google';

/**
 * Strip any `key=<value>` query parameter from a string before it can reach a
 * console/error/diagnostic surface. A provider request URL should never carry
 * a raw API key after the x-goog-api-key header migration (Gemini used to put
 * it in `?key=`), but callers that build a URL for a log line, a thrown
 * error's message, or any other diagnostic string should run it through this
 * first — a defensive backstop against the key leaking via browser history,
 * proxy access logs, or an HTTP client that echoes the request URL into its
 * own error message.
 */
export function redactUrl(text: string): string {
  return text.replace(/([?&]key=)[^&\s"')]*/gi, '$1REDACTED');
}

const RAW_PROVIDER_BODY_DEBUG_KEY = 'lantern_debug_provider_raw_bodies';

function rawProviderBodyDebugEnabled(): boolean {
  try {
    return (
      import.meta.env.DEV &&
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(RAW_PROVIDER_BODY_DEBUG_KEY) === 'true'
    );
  } catch {
    return false;
  }
}

function redactProviderBody(rawBody: string): string {
  if (rawProviderBodyDebugEnabled()) {
    return rawBody
      .replace(/sk-[A-Za-z0-9_-]{20,}/g, 'sk-***REDACTED***')
      .replace(/AIza[0-9A-Za-z_-]{30,}/g, 'AIza***REDACTED***');
  }
  return `[provider response body redacted; ${String(rawBody.length)} chars]`;
}

function requestIdFromHeaders(headers: Headers): string | undefined {
  return (
    headers.get('request-id') ??
    headers.get('x-request-id') ??
    headers.get('cf-ray') ??
    undefined
  );
}

/**
 * Get the appropriate base URL for a provider's API.
 * In development, routes through Vite proxy to bypass CORS.
 */
export function getProviderBaseUrl(provider: ProviderType): string {
  const isDev = typeof window !== 'undefined' && import.meta.env.DEV;

  switch (provider) {
    case 'anthropic':
      return isDev ? '/api/anthropic' : 'https://api.anthropic.com';
    case 'openai':
      return isDev ? '/api/openai' : 'https://api.openai.com';
    case 'google':
      return isDev ? '/api/google' : 'https://generativelanguage.googleapis.com';
  }
}

/**
 * Detect whether we should use the Tauri HTTP plugin for fetch requests.
 *
 * Production Tauri builds serve from tauri://localhost, so the browser's native
 * fetch() gets CORS-blocked when hitting external APIs. The tauri-plugin-http
 * plugin provides a Rust-side fetch that bypasses the browser's CORS enforcement.
 *
 * We use the plugin fetch ONLY in production Tauri builds. In dev mode (both
 * browser `npm run dev` and Tauri `npm run tauri dev`), the Vite proxy handles
 * CORS, so we use the normal browser fetch.
 */
function shouldUseTauriHttp(): boolean {
  // Durable Tauri detection — see BackendFactory.isTauriEnvironment. Matching
  // `__TAURI_INTERNALS__` keeps production API calls on the CORS-bypassing
  // native HTTP path after a future `withGlobalTauri:false` flip.
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) &&
    !import.meta.env.DEV
  );
}

/**
 * Whether the current environment requires the Tauri HTTP plugin.
 * When true, streaming (SSE/ReadableStream) is NOT supported because the
 * plugin's Response doesn't implement ReadableStream the same way as the
 * browser's native fetch. Providers should fall back to non-streaming mode.
 */
export function isTauriProductionBuild(): boolean {
  return shouldUseTauriHttp();
}

// Cache the plugin's fetch function so we only dynamically import once
let tauriFetchFn: typeof globalThis.fetch | null = null;

/**
 * Get a CORS-safe fetch function.
 *
 * - Browser dev mode (`npm run dev`): returns native fetch (Vite proxy handles CORS)
 * - Tauri dev mode (`npm run tauri dev`): returns native fetch (Vite proxy handles CORS)
 * - Tauri production build: returns tauri-plugin-http's fetch (bypasses CORS)
 *
 * The plugin's fetch has the same API as the standard fetch(), so it's a drop-in replacement.
 *
 * F-120: by default the returned fetch is instrumented with the egress
 * activity signal, so the status bar shows "Sending to your AI provider"
 * while a request is in flight. Callers whose traffic does NOT go to the
 * user's AI provider (the firm relay client, the bug-report sender) pass
 * `{ signalEgress: false }` so the pulse never lies about the destination.
 * The dynamic-import cache stays RAW so both variants share one import.
 */
export async function getCorsSafeFetch(
  options?: { signalEgress?: boolean },
): Promise<typeof globalThis.fetch> {
  const signal = options?.signalEgress ?? true;
  const wrap = (fn: typeof globalThis.fetch): typeof globalThis.fetch =>
    signal ? instrumentEgressFetch(fn) : fn;

  if (!shouldUseTauriHttp()) {
    return wrap(globalThis.fetch.bind(globalThis));
  }

  if (tauriFetchFn) {
    return wrap(tauriFetchFn);
  }

  try {
    const mod = await import('@tauri-apps/plugin-http');
    tauriFetchFn = mod.fetch as typeof globalThis.fetch;
    return wrap(tauriFetchFn);
  } catch {
    // If the plugin import fails (e.g. running outside Tauri somehow),
    // fall back to native fetch
    return wrap(globalThis.fetch.bind(globalThis));
  }
}

export interface ParsedApiError {
  type: 'auth' | 'not_found' | 'rate_limit' | 'network' | 'server' | 'unknown';
  message: string;
  guidance: string;
  retryable: boolean;
}

export function parseApiError(
  provider: ProviderType,
  statusCode: number | null,
  errorMessage: string,
  model?: string,
): ParsedApiError {
  const consoleUrls: Record<string, string> = {
    anthropic: 'console.anthropic.com',
    openai: 'platform.openai.com/api-keys',
    google: 'aistudio.google.com/app/apikey',
  };
  const url = consoleUrls[provider] ?? '';

  if (statusCode === 401 || statusCode === 403) {
    return { type: 'auth', message: 'Invalid or expired API key.', guidance: `Check your key at ${url}`, retryable: false };
  }
  if (statusCode === 404) {
    return { type: 'not_found', message: model ? `Model "${model}" not found. Your API plan may not include it.` : 'Model not found.', guidance: 'Try selecting a different model.', retryable: false };
  }
  if (statusCode === 429) {
    return { type: 'rate_limit', message: 'Rate limited by the provider.', guidance: 'Wait a moment and try again.', retryable: true };
  }
  if (statusCode === null || statusCode === 0) {
    return { type: 'network', message: 'Network error — could not reach the provider.', guidance: 'Check your internet connection.', retryable: true };
  }
  if (statusCode && statusCode >= 500) {
    return { type: 'server', message: `Provider returned error ${statusCode}.`, guidance: 'This is a temporary issue. Try again shortly.', retryable: true };
  }
  return { type: 'unknown', message: errorMessage || 'Something went wrong.', guidance: 'Try again or check your settings.', retryable: true };
}

/**
 * Custom error thrown when a JSON response body fails to parse.
 * Carries only redacted body diagnostics by default.
 */
export class ApiResponseParseError extends Error {
  rawBody: string;
  parseErrorMessage: string;
  bodyLength: number;
  status: number;
  requestId?: string;

  constructor(
    rawBody: string,
    parseErrorMessage: string,
    meta?: { status?: number; requestId?: string },
  ) {
    const redacted = redactProviderBody(rawBody);
    super(
      `Could not parse API response (${parseErrorMessage}). ` +
      `Status: ${String(meta?.status ?? 0)}. ` +
      `Request id: ${meta?.requestId ?? 'unknown'}. ` +
      `Body length: ${String(rawBody.length)} chars. Preview: "${redacted}"`
    );
    this.name = 'ApiResponseParseError';
    this.rawBody = redacted;
    this.parseErrorMessage = parseErrorMessage;
    this.bodyLength = rawBody.length;
    this.status = meta?.status ?? 0;
    if (meta?.requestId) this.requestId = meta.requestId;
  }

  /**
   * Return a diagnostic blob suitable for clipboard copy / sharing.
   * Strips obvious API-key-like patterns to avoid accidental leakage.
   */
  toDiagnostic(): string {
    const lines: string[] = [];
    lines.push(`=== ${BRAND.name} API Parse Error Diagnostic ===`);
    lines.push(`Time: ${new Date().toISOString()}`);
    lines.push(`Parse error: ${this.parseErrorMessage}`);
    lines.push(`HTTP status: ${String(this.status)}`);
    lines.push(`Request id: ${this.requestId ?? 'unknown'}`);
    lines.push(`Body length: ${this.bodyLength} chars`);
    lines.push('');
    lines.push('--- BODY PREVIEW ---');
    lines.push(this.rawBody);
    lines.push('--- END BODY PREVIEW ---');
    return lines.join('\n');
  }
}

/**
 * Safely parse a JSON response body.
 *
 * Uses .text() + JSON.parse() instead of .json() because the
 * tauri-plugin-http's Response.json() behaves differently from the
 * browser's native Response.json(). The text-then-parse approach
 * works identically in both environments.
 *
 * Throws ApiResponseParseError on parse failure, with redacted diagnostics.
 */
export async function safeJsonParse<T>(response: Response): Promise<T> {
  const rawText = await response.text();

  // Defense: the Tauri HTTP plugin occasionally appends a trailing
  // null byte (0x00) or other control character to the response body
  // when reading it back through IPC. JSON.parse then fails with
  // "Unexpected non-whitespace character after JSON at position N"
  // where N is the final byte. Strip trailing C0 control characters
  // (except the whitespace ones \t \n \r which JSON.parse accepts)
  // before parsing.
  const text = rawText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+$/g, '').trim();

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown parse error';
    const requestId = requestIdFromHeaders(response.headers);
    console.error('[safeJsonParse] Parse failed:', {
      error: errMsg,
      status: response.status,
      requestId: requestId ?? 'unknown',
      rawBodyLength: rawText.length,
      cleanedBodyLength: text.length,
      preview: redactProviderBody(rawText),
    });
    throw new ApiResponseParseError(rawText, errMsg, {
      status: response.status,
      ...(requestId ? { requestId } : {}),
    });
  }
}

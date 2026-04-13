// Shared fetch utilities for model providers
// Provides base URL resolution that works in both dev (Vite proxy) and production,
// and a CORS-safe fetch wrapper for production Tauri builds.

export type ProviderType = 'anthropic' | 'openai' | 'google';

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
  return (
    typeof window !== 'undefined' &&
    '__TAURI__' in window &&
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
 */
export async function getCorsSafeFetch(): Promise<typeof globalThis.fetch> {
  if (!shouldUseTauriHttp()) {
    return globalThis.fetch.bind(globalThis);
  }

  if (tauriFetchFn) {
    return tauriFetchFn;
  }

  try {
    const mod = await import('@tauri-apps/plugin-http');
    tauriFetchFn = mod.fetch as typeof globalThis.fetch;
    return tauriFetchFn;
  } catch {
    // If the plugin import fails (e.g. running outside Tauri somehow),
    // fall back to native fetch
    return globalThis.fetch.bind(globalThis);
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
 * Safely parse a JSON response body.
 *
 * Uses .text() + JSON.parse() instead of .json() because the
 * tauri-plugin-http's Response.json() behaves differently from the
 * browser's native Response.json(). The text-then-parse approach
 * works identically in both environments.
 */
export async function safeJsonParse<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    console.error('[safeJsonParse] Failed to parse response body:', text.slice(0, 500));
    const preview = text.slice(0, 120);
    throw new Error(
      `Failed to parse API response. Body preview: "${preview}${text.length > 120 ? '...' : ''}"`
    );
  }
}

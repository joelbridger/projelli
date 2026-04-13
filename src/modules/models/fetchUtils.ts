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

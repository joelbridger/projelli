// Shared fetch utilities for model providers
// Provides base URL resolution that works in both dev (Vite proxy) and production

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

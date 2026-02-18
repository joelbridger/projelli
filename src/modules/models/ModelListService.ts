// Model List Service
// Fetches available models from provider APIs, caches for 24h, falls back to hardcoded defaults

import { getProviderBaseUrl, type ProviderType } from './fetchUtils';

export interface ModelInfo {
  id: string;
  displayName: string;
  provider: ProviderType;
}

interface CacheEntry {
  models: ModelInfo[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds

function cacheKey(provider: ProviderType): string {
  return `projelli_models_${provider}`;
}

function readCache(provider: ProviderType): CacheEntry | null {
  try {
    const raw = localStorage.getItem(cacheKey(provider));
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

function writeCache(provider: ProviderType, models: ModelInfo[]): void {
  const entry: CacheEntry = { models, fetchedAt: Date.now() };
  localStorage.setItem(cacheKey(provider), JSON.stringify(entry));
}

function isCacheFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

// --- Default (hardcoded) model lists ---

const DEFAULT_ANTHROPIC: ModelInfo[] = [
  { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'claude-sonnet-4-5-20250514', displayName: 'Claude Sonnet 4.5', provider: 'anthropic' },
];

const DEFAULT_OPENAI: ModelInfo[] = [
  { id: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai' },
  { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', provider: 'openai' },
  { id: 'gpt-4-turbo', displayName: 'GPT-4 Turbo', provider: 'openai' },
  { id: 'gpt-4', displayName: 'GPT-4', provider: 'openai' },
];

const DEFAULT_GOOGLE: ModelInfo[] = [
  { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', provider: 'google' },
  { id: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', provider: 'google' },
  { id: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', provider: 'google' },
];

export function getDefaultModels(provider: ProviderType): ModelInfo[] {
  switch (provider) {
    case 'anthropic': return DEFAULT_ANTHROPIC;
    case 'openai': return DEFAULT_OPENAI;
    case 'google': return DEFAULT_GOOGLE;
  }
}

// --- Fetch logic per provider ---

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function deriveOpenAIDisplayName(id: string): string {
  // e.g. "gpt-4-turbo-2024-04-09" → "GPT-4 Turbo 2024-04-09"
  return id
    .replace(/^gpt-/i, 'GPT-')
    .replace(/^o(\d)/i, 'O$1')
    .split('-')
    .map((seg, i) => {
      if (i === 0) return seg; // already uppercased
      // Capitalize first letter of each segment unless it's a number/date
      if (/^\d/.test(seg)) return seg;
      return seg.charAt(0).toUpperCase() + seg.slice(1);
    })
    .join(' ')
    // Clean up double spaces
    .replace(/\s+/g, ' ');
}

async function fetchAnthropicModels(apiKey: string): Promise<ModelInfo[]> {
  const baseUrl = getProviderBaseUrl('anthropic');
  const resp = await fetchWithTimeout(`${baseUrl}/v1/models`, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  });
  if (!resp.ok) throw new Error(`Anthropic API ${resp.status}`);
  const data = await resp.json() as { data: Array<{ id: string; display_name?: string }> };
  return (data.data ?? [])
    .filter((m) => m.id.includes('claude'))
    .map((m) => ({
      id: m.id,
      displayName: m.display_name ?? m.id,
      provider: 'anthropic' as const,
    }));
}

async function fetchOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
  const baseUrl = getProviderBaseUrl('openai');
  const resp = await fetchWithTimeout(`${baseUrl}/v1/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!resp.ok) throw new Error(`OpenAI API ${resp.status}`);
  const data = await resp.json() as { data: Array<{ id: string }> };
  const prefixes = ['gpt-', 'o1-', 'o3-', 'o4-'];
  return (data.data ?? [])
    .filter((m) => prefixes.some((p) => m.id.startsWith(p)))
    .map((m) => ({
      id: m.id,
      displayName: deriveOpenAIDisplayName(m.id),
      provider: 'openai' as const,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchGoogleModels(apiKey: string): Promise<ModelInfo[]> {
  const baseUrl = getProviderBaseUrl('google');
  const resp = await fetchWithTimeout(`${baseUrl}/v1beta/models?key=${apiKey}`, {
    method: 'GET',
  });
  if (!resp.ok) throw new Error(`Google API ${resp.status}`);
  const data = await resp.json() as {
    models: Array<{
      name: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    }>;
  };
  return (data.models ?? [])
    .filter((m) => {
      const id = m.name.replace('models/', '');
      return id.includes('gemini') &&
        (m.supportedGenerationMethods ?? []).includes('generateContent');
    })
    .map((m) => ({
      id: m.name.replace('models/', ''),
      displayName: m.displayName ?? m.name.replace('models/', ''),
      provider: 'google' as const,
    }));
}

async function fetchModelsForProvider(provider: ProviderType, apiKey: string): Promise<ModelInfo[]> {
  switch (provider) {
    case 'anthropic': return fetchAnthropicModels(apiKey);
    case 'openai': return fetchOpenAIModels(apiKey);
    case 'google': return fetchGoogleModels(apiKey);
  }
}

// --- Public API ---

/**
 * Get models for a provider. Checks cache first, fetches if stale,
 * falls back to stale cache or hardcoded defaults on failure.
 */
export async function getModels(provider: ProviderType, apiKey: string): Promise<ModelInfo[]> {
  const cached = readCache(provider);
  if (cached && isCacheFresh(cached)) {
    return cached.models;
  }

  try {
    const models = await fetchModelsForProvider(provider, apiKey);
    if (models.length > 0) {
      writeCache(provider, models);
      return models;
    }
  } catch {
    // fetch failed — fall through
  }

  // Return stale cache if available, else defaults
  if (cached) return cached.models;
  return getDefaultModels(provider);
}

/**
 * Bypass cache and fetch fresh models from the API.
 * Called when user saves a new API key.
 */
export async function refreshModels(provider: ProviderType, apiKey: string): Promise<ModelInfo[]> {
  try {
    const models = await fetchModelsForProvider(provider, apiKey);
    if (models.length > 0) {
      writeCache(provider, models);
      return models;
    }
  } catch {
    // fall through
  }

  const cached = readCache(provider);
  if (cached) return cached.models;
  return getDefaultModels(provider);
}

/**
 * Clear cached models for a provider.
 * Called when user deletes an API key.
 */
export function clearModelCache(provider: ProviderType): void {
  localStorage.removeItem(cacheKey(provider));
}

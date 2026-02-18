// React hook wrapping ModelListService
// Fetches model lists for providers with valid API keys on mount/change

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ProviderType } from '@/modules/models/fetchUtils';
import {
  type ModelInfo,
  getModels,
  refreshModels,
  clearModelCache,
  getDefaultModels,
} from '@/modules/models/ModelListService';

interface ApiKeyEntry {
  provider: ProviderType;
  key: string;
}

interface UseModelListReturn {
  models: Record<ProviderType, ModelInfo[]>;
  isLoading: boolean;
  refreshProvider: (provider: ProviderType, apiKey: string) => Promise<void>;
  clearProvider: (provider: ProviderType) => void;
}

export function useModelList(apiKeys: ApiKeyEntry[]): UseModelListReturn {
  const [models, setModels] = useState<Record<ProviderType, ModelInfo[]>>({
    anthropic: getDefaultModels('anthropic'),
    openai: getDefaultModels('openai'),
    google: getDefaultModels('google'),
  });
  const [isLoading, setIsLoading] = useState(false);

  // Track previous keys to avoid refetching on every render
  const prevKeysRef = useRef<string>('');

  // Fetch models for all providers with keys on mount / key change
  useEffect(() => {
    const keysSerialized = apiKeys.map(k => `${k.provider}:${k.key}`).sort().join('|');
    if (keysSerialized === prevKeysRef.current) return;
    prevKeysRef.current = keysSerialized;

    let cancelled = false;
    const providers: ProviderType[] = ['anthropic', 'openai', 'google'];

    setIsLoading(true);

    const fetchAll = async () => {
      const results: Partial<Record<ProviderType, ModelInfo[]>> = {};

      await Promise.all(
        providers.map(async (provider) => {
          const entry = apiKeys.find(k => k.provider === provider);
          if (entry) {
            results[provider] = await getModels(provider, entry.key);
          } else {
            results[provider] = getDefaultModels(provider);
          }
        })
      );

      if (!cancelled) {
        setModels({
          anthropic: results.anthropic ?? getDefaultModels('anthropic'),
          openai: results.openai ?? getDefaultModels('openai'),
          google: results.google ?? getDefaultModels('google'),
        });
        setIsLoading(false);
      }
    };

    fetchAll();

    return () => { cancelled = true; };
  }, [apiKeys]);

  const refreshProvider = useCallback(async (provider: ProviderType, apiKey: string) => {
    const freshModels = await refreshModels(provider, apiKey);
    setModels(prev => ({ ...prev, [provider]: freshModels }));
  }, []);

  const clearProvider = useCallback((provider: ProviderType) => {
    clearModelCache(provider);
    setModels(prev => ({ ...prev, [provider]: getDefaultModels(provider) }));
  }, []);

  return { models, isLoading, refreshProvider, clearProvider };
}

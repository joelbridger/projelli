// React hook wrapping ModelListService
// Fetches model lists for providers with valid API keys on mount/change

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ProviderType } from '@/platform/providers/fetchUtils';
import {
  type ModelInfo,
  getModels,
  refreshModels,
  clearModelCache,
  getDefaultModels,
} from '@/platform/providers/ModelListService';
import { isLocalOnlyMode } from '@/platform/privacy/localOnlyGuard';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';

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
  // Re-run the effect when the confidentiality mode changes (so switching OUT of
  // Local-only re-fetches live model lists, and switching IN drops to defaults).
  const confidentialityMode = useConfidentialityMode();

  // Fetch models for all providers with keys on mount / key change
  useEffect(() => {
    // Local-only kill-switch: never call provider model-list APIs — that sends the
    // API key off-device. In Local-only we fall back to the built-in default lists
    // (no network). The dedup key uses a 'local-only' sentinel so toggling the mode
    // re-runs this effect (it is also in the dep list).
    const localOnly = isLocalOnlyMode();
    const keysSerialized = localOnly
      ? 'local-only'
      : apiKeys.map(k => `${k.provider}:${k.key}`).sort().join('|');
    if (keysSerialized === prevKeysRef.current) return;
    prevKeysRef.current = keysSerialized;

    let cancelled = false;
    const providers: ProviderType[] = ['anthropic', 'openai', 'google'];

    const fetchAll = async () => {
      setIsLoading(true);
      // Local-only: drop straight to the built-in defaults, no provider API call.
      if (localOnly) {
        if (!cancelled) {
          setModels({
            anthropic: getDefaultModels('anthropic'),
            openai: getDefaultModels('openai'),
            google: getDefaultModels('google'),
          });
          setIsLoading(false);
        }
        return;
      }

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
  }, [apiKeys, confidentialityMode]);

  const refreshProvider = useCallback(async (provider: ProviderType, apiKey: string) => {
    // Local-only kill-switch: a manual refresh also sends the API key off-device.
    // Skip the external call and keep the built-in defaults.
    if (isLocalOnlyMode()) {
      setModels(prev => ({ ...prev, [provider]: getDefaultModels(provider) }));
      return;
    }
    const freshModels = await refreshModels(provider, apiKey);
    setModels(prev => ({ ...prev, [provider]: freshModels }));
  }, []);

  const clearProvider = useCallback((provider: ProviderType) => {
    clearModelCache(provider);
    setModels(prev => ({ ...prev, [provider]: getDefaultModels(provider) }));
  }, []);

  return { models, isLoading, refreshProvider, clearProvider };
}

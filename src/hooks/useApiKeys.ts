/**
 * API key management hook
 * Handles API key state, CRUD operations, and localStorage persistence
 */

import { useState, useCallback, useEffect } from 'react';
import type { APIKey } from '@/types';

interface UseApiKeysReturn {
  apiKeys: APIKey[];
  handleSaveApiKey: (provider: 'anthropic' | 'openai' | 'google', key: string) => void;
  handleDeleteApiKey: (provider: 'anthropic' | 'openai' | 'google') => void;
}

export function useApiKeys(): UseApiKeysReturn {
  const [apiKeys, setApiKeys] = useState<APIKey[]>([]);

  // Handle saving API key
  const handleSaveApiKey = useCallback((provider: 'anthropic' | 'openai' | 'google', key: string) => {
    setApiKeys((prev) => {
      const existing = prev.find((k) => k.provider === provider);
      if (existing) {
        return prev.map((k) =>
          k.provider === provider ? { ...k, key, isValid: true, lastValidated: new Date() } : k
        );
      }
      return [...prev, { provider, key, isValid: true, lastValidated: new Date() }];
    });
    // In production, this would be stored in secure keychain
    localStorage.setItem(`apiKey_${provider}`, key);
  }, []);

  // Handle deleting API key
  const handleDeleteApiKey = useCallback((provider: 'anthropic' | 'openai' | 'google') => {
    setApiKeys((prev) => prev.filter((k) => k.provider !== provider));
    localStorage.removeItem(`apiKey_${provider}`);
  }, []);

  // Load API keys from localStorage on mount
  useEffect(() => {
    const loadKeys = () => {
      const providers: Array<'anthropic' | 'openai' | 'google'> = ['anthropic', 'openai', 'google'];
      const loadedKeys: APIKey[] = [];
      for (const provider of providers) {
        const key = localStorage.getItem(`apiKey_${provider}`);
        if (key) {
          loadedKeys.push({ provider, key, isValid: true });
        }
      }
      if (loadedKeys.length > 0) {
        setApiKeys(loadedKeys);
      }
    };
    loadKeys();
  }, []);

  return {
    apiKeys,
    handleSaveApiKey,
    handleDeleteApiKey,
  };
}

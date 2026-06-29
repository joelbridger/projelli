/**
 * API key management hook.
 *
 * Holds the in-memory (session-only) list of configured AI provider keys and
 * exposes save/delete handlers. ALL persistence goes through KeychainService —
 * the OS keychain on desktop (Tauri) and base64-obfuscated localStorage in
 * browser-only dev. The raw key is NEVER written to plain localStorage here
 * (the old `apiKey_<provider>` plaintext entry is gone), which is the whole
 * point of the "your keys live in the keychain, never in plain storage" promise.
 *
 * The raw key still lives in memory for the lifetime of the session (the
 * `apiKeys` array below) because making provider API calls and fetching model
 * lists needs it — that is expected and unavoidable, and never persisted as
 * plaintext.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { APIKey } from '@/platform/types';
import {
  createKeychainService,
  type KeyProvider,
} from '@/platform/providers/KeychainService';
import { EGRESS_CONFIG_CHANGE_EVENT } from '@/platform/privacy/egressConfigEvents';

/**
 * The slice of KeychainService this hook needs. Injectable so callers can share
 * one instance (App passes the same instance used by the wizard + key manager)
 * and so tests can supply a controlled backend.
 */
export interface ApiKeyKeychain {
  getKey(provider: KeyProvider): Promise<string | null>;
  setKey(provider: KeyProvider, key: string): Promise<void>;
  deleteKey(provider: KeyProvider): Promise<void>;
}

interface UseApiKeysReturn {
  apiKeys: APIKey[];
  handleSaveApiKey: (provider: KeyProvider, key: string) => Promise<void>;
  handleDeleteApiKey: (provider: KeyProvider) => Promise<void>;
}

const PROVIDERS: KeyProvider[] = ['anthropic', 'openai', 'google'];

export function useApiKeys(keychainService?: ApiKeyKeychain): UseApiKeysReturn {
  const [apiKeys, setApiKeys] = useState<APIKey[]>([]);

  // Use the injected keychain, or create one default instance for this hook.
  // Memoized so the load effect below doesn't re-run on every render.
  const keychain = useMemo<ApiKeyKeychain>(
    () => keychainService ?? createKeychainService(),
    [keychainService]
  );

  // Save: persist through the keychain first (validates the format, stores in
  // the OS keychain / obfuscated localStorage, and notifies the egress badge),
  // then mirror into in-memory session state. If setKey throws (bad format /
  // keychain failure), we surface the error and leave state untouched.
  const handleSaveApiKey = useCallback(
    async (provider: KeyProvider, key: string) => {
      await keychain.setKey(provider, key);
      setApiKeys((prev) => {
        const existing = prev.find((k) => k.provider === provider);
        if (existing) {
          return prev.map((k) =>
            k.provider === provider ? { ...k, key, isValid: true, lastValidated: new Date() } : k
          );
        }
        return [...prev, { provider, key, isValid: true, lastValidated: new Date() }];
      });
    },
    [keychain]
  );

  // Delete: remove from the keychain (also notifies the egress badge), then
  // drop it from in-memory state.
  const handleDeleteApiKey = useCallback(
    async (provider: KeyProvider) => {
      await keychain.deleteKey(provider);
      setApiKeys((prev) => prev.filter((k) => k.provider !== provider));
    },
    [keychain]
  );

  // Read the configured keys straight from the keychain (never plain
  // localStorage). KeychainService.getKey also covers env-var keys.
  const loadKeys = useCallback(async (): Promise<APIKey[]> => {
    const loaded: APIKey[] = [];
    for (const provider of PROVIDERS) {
      const key = await keychain.getKey(provider);
      if (key) {
        loaded.push({ provider, key, isValid: true });
      }
    }
    return loaded;
  }, [keychain]);

  // Load on mount AND reload whenever the keychain changes — a key added or
  // removed on any surface broadcasts EGRESS_CONFIG_CHANGE_EVENT, and so does
  // the one-time legacy-plaintext migration. This is what makes an UPGRADING
  // user (who starts a session with only a legacy `apiKey_<provider>` entry)
  // get a working AI provider in the SAME session: the migration moves the key
  // into the keychain and fires the event, and we re-read it here — no restart
  // or re-add needed. The reload is authoritative (it reflects removals too).
  // A monotonic request id drops any stale in-flight read so a rapid
  // add-then-remove can't land out of order.
  const reloadIdRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      const id = ++reloadIdRef.current;
      void loadKeys().then((loaded) => {
        if (!cancelled && id === reloadIdRef.current) {
          setApiKeys(loaded);
        }
      });
    };
    reload();
    window.addEventListener(EGRESS_CONFIG_CHANGE_EVENT, reload);
    window.addEventListener('storage', reload);
    return () => {
      cancelled = true;
      window.removeEventListener(EGRESS_CONFIG_CHANGE_EVENT, reload);
      window.removeEventListener('storage', reload);
    };
  }, [loadKeys]);

  return {
    apiKeys,
    handleSaveApiKey,
    handleDeleteApiKey,
  };
}

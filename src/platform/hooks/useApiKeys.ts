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
import { withTimeout } from '@/lib/withTimeout';

// A hung/erroring OS keychain must never silently look like "no AI key
// configured" — that's what loadKeys() used to do (a bare `.then`, no
// `.catch`). Bound each read so one bad provider can't block the others.
const LOAD_KEY_TIMEOUT_MS = 10_000;

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
  // Mirrors `apiKeys` so loadKeys() (below) can fall back to "what we already
  // had" for a provider whose read failed/timed out, instead of treating a
  // transient keychain hiccup as "key removed".
  const apiKeysRef = useRef<APIKey[]>([]);
  useEffect(() => {
    apiKeysRef.current = apiKeys;
  }, [apiKeys]);

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
  //
  // Each provider is read independently (timeout + catch) so a hung or
  // erroring OS keychain for one provider can't (a) block the others behind
  // it, or (b) throw out of loadKeys() entirely and leave the app silently
  // believing no AI key is configured at all. A read that fails is logged
  // and falls back to whatever this provider's last known-good value was
  // (apiKeysRef) rather than treating "couldn't read it right now" the same
  // as "not configured" — otherwise a transient/timed-out keychain hiccup on
  // reload would make a working key silently vanish from a chat that was
  // using it a moment ago. An explicit removal still works: deletion goes
  // through handleDeleteApiKey, which updates state directly, not loadKeys().
  const loadKeys = useCallback(async (): Promise<APIKey[]> => {
    const results = await Promise.all(
      PROVIDERS.map(async (provider): Promise<APIKey | null> => {
        try {
          const key = await withTimeout(
            keychain.getKey(provider),
            LOAD_KEY_TIMEOUT_MS,
            `Reading the ${provider} key`,
          );
          return key ? { provider, key, isValid: true } : null;
        } catch (err) {
          console.error(`[useApiKeys] could not read the ${provider} key from the keychain:`, err);
          return apiKeysRef.current.find((k) => k.provider === provider) ?? null;
        }
      }),
    );
    return results.filter((k): k is APIKey => k !== null);
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
      void loadKeys()
        .then((loaded) => {
          if (!cancelled && id === reloadIdRef.current) {
            setApiKeys(loaded);
          }
        })
        .catch((err: unknown) => {
          // loadKeys() catches per-provider, so this is a true defense-in-depth
          // backstop. Never throw out of the effect or leave state hanging.
          console.error('[useApiKeys] failed to reload keys', err);
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

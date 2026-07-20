// Keychain Service
// Secure API key storage with multiple backend support

import { invoke, isTauri } from '@tauri-apps/api/core';
import { notifyEgressConfigChange } from '@/platform/privacy/egressConfigEvents';
import { SK_APIKEYS_MIGRATED_V1, SK_APIKEYS_MIGRATED_V2 } from '@/config/identity';

export type KeyProvider = 'anthropic' | 'openai' | 'google';

const KEY_PROVIDERS: KeyProvider[] = ['anthropic', 'openai', 'google'];
const LEGACY_API_KEY_PREFIX = 'apiKey_';
// v2 supersedes v1: the v1 migration assumed the legacy value was base64 and
// ran on desktop only, so it silently skipped the real-world RAW plaintext keys
// (atob throws on the `-` in `sk-ant-`/`sk-` keys) and left them in localStorage.
// v2 handles both raw and base64 legacy values and runs in the browser too, so
// it must re-run once for everyone — hence a fresh sentinel.
// These sentinels are themselves renamed by the L1a lantern-storage-key
// migration (legacyStorageKeyMigration.ts), which runs earlier in boot — see
// src/main.tsx for the required ordering.
const API_KEY_MIGRATION_SENTINEL_V1 = SK_APIKEYS_MIGRATED_V1;
const API_KEY_MIGRATION_SENTINEL = SK_APIKEYS_MIGRATED_V2;
const KEYCHAIN_METADATA_KEY = 'bos_key_metadata';

export interface StoredKey {
  provider: KeyProvider;
  keyPrefix: string; // First 8 characters for identification
  lastUsed?: Date;
  addedAt: Date;
}

/**
 * Abstract interface for key storage backends
 */
interface KeyStorageBackend {
  get(provider: KeyProvider): Promise<string | null>;
  set(provider: KeyProvider, key: string): Promise<void>;
  delete(provider: KeyProvider): Promise<void>;
  has(provider: KeyProvider): Promise<boolean>;
}

/**
 * LocalStorage backend for browser development
 * Keys are stored with basic obfuscation (NOT secure, for dev only)
 */
class LocalStorageBackend implements KeyStorageBackend {
  private readonly prefix = 'bos_key_';

  async get(provider: KeyProvider): Promise<string | null> {
    if (typeof localStorage === 'undefined') return null;

    try {
      const stored = localStorage.getItem(this.prefix + provider);
      if (!stored) return null;

      // Decode from base64
      return atob(stored);
    } catch {
      return null;
    }
  }

  async set(provider: KeyProvider, key: string): Promise<void> {
    if (typeof localStorage === 'undefined') return;

    // Encode to base64 (basic obfuscation, not secure)
    localStorage.setItem(this.prefix + provider, btoa(key));
  }

  async delete(provider: KeyProvider): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(this.prefix + provider);
  }

  async has(provider: KeyProvider): Promise<boolean> {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(this.prefix + provider) !== null;
  }
}

/**
 * Durable Tauri detection for the KEYCHAIN backend picker (see
 * BackendFactory.isTauriEnvironment for the full rationale). Matches
 * `__TAURI_INTERNALS__` (always injected by Tauri v2) OR the legacy `__TAURI__`
 * convenience global, so the constructor default below keeps selecting the OS
 * keychain after a future `withGlobalTauri:false` flip. Without this, dropping
 * the global would silently demote API-key/secret storage to base64-obfuscated
 * `localStorage` with no crash — a security regression. Exported so the
 * no-demotion test can pin the picker directly.
 */
export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

function isKeychainNotFound(error: unknown): boolean {
  if (error && typeof error === 'object' && 'kind' in error) {
    return (error as { kind?: unknown }).kind === 'notFound';
  }
  return false;
}

/**
 * Tauri backend for desktop builds
 * Keys are stored in the OS keychain through the Rust keychain_* commands.
 */
class TauriKeychainBackend implements KeyStorageBackend {
  private readonly prefix = 'bos_key_';

  async get(provider: KeyProvider): Promise<string | null> {
    try {
      return await invoke<string>('keychain_get', {
        service: undefined,
        key: this.prefix + provider,
      });
    } catch (error) {
      if (isKeychainNotFound(error)) return null;
      throw error;
    }
  }

  async set(provider: KeyProvider, key: string): Promise<void> {
    await invoke<void>('keychain_set', {
      service: undefined,
      key: this.prefix + provider,
      value: key,
    });
  }

  async delete(provider: KeyProvider): Promise<void> {
    await invoke<void>('keychain_delete', {
      service: undefined,
      key: this.prefix + provider,
    });
  }

  async has(provider: KeyProvider): Promise<boolean> {
    return (await this.get(provider)) !== null;
  }
}

/**
 * Memory-only backend for testing
 */
class MemoryBackend implements KeyStorageBackend {
  private keys = new Map<KeyProvider, string>();

  async get(provider: KeyProvider): Promise<string | null> {
    return this.keys.get(provider) ?? null;
  }

  async set(provider: KeyProvider, key: string): Promise<void> {
    this.keys.set(provider, key);
  }

  async delete(provider: KeyProvider): Promise<void> {
    this.keys.delete(provider);
  }

  async has(provider: KeyProvider): Promise<boolean> {
    return this.keys.has(provider);
  }
}

/**
 * Environment variable backend for CI/development
 */
class EnvBackend implements KeyStorageBackend {
  private readonly envKeys: Record<KeyProvider, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_AI_API_KEY',
  };

  async get(provider: KeyProvider): Promise<string | null> {
    // Check various sources for env vars
    const envKey = this.envKeys[provider];

    // Vite-style env vars
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      const viteKey = import.meta.env[`VITE_${envKey}`];
      if (viteKey) return viteKey;
    }

    // Node-style env vars (for testing)
    if (typeof process !== 'undefined' && process.env) {
      const nodeKey = process.env[envKey];
      if (nodeKey) return nodeKey;
    }

    return null;
  }

  async set(_provider: KeyProvider, _key: string): Promise<void> {
    // Cannot set env vars at runtime
    throw new Error('Cannot set environment variables at runtime');
  }

  async delete(_provider: KeyProvider): Promise<void> {
    // Cannot delete env vars at runtime
    throw new Error('Cannot delete environment variables at runtime');
  }

  async has(provider: KeyProvider): Promise<boolean> {
    const key = await this.get(provider);
    return key !== null;
  }
}

export type KeychainBackendType = 'localStorage' | 'memory' | 'env' | 'tauri';

function loadStoredKeyMetadata(): Map<KeyProvider, StoredKey> {
  const metadata = new Map<KeyProvider, StoredKey>();
  if (typeof localStorage === 'undefined') return metadata;

  try {
    const data = localStorage.getItem(KEYCHAIN_METADATA_KEY);
    if (!data) return metadata;

    const parsed = JSON.parse(data) as StoredKey[];
    for (const item of parsed) {
      const storedKey: StoredKey = {
        ...item,
        addedAt: new Date(item.addedAt),
      };
      if (item.lastUsed) {
        storedKey.lastUsed = new Date(item.lastUsed);
      }
      metadata.set(item.provider, storedKey);
    }
  } catch {
    // Ignore malformed metadata. Key material is stored separately.
  }

  return metadata;
}

function saveStoredKeyMetadata(metadata: Map<KeyProvider, StoredKey>): void {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(KEYCHAIN_METADATA_KEY, JSON.stringify(Array.from(metadata.values())));
  } catch {
    // Ignore metadata write failures; keychain storage is the source of truth.
  }
}

function upsertStoredKeyMetadata(provider: KeyProvider, key: string): void {
  const metadata = loadStoredKeyMetadata();
  const existing = metadata.get(provider);
  const storedKey: StoredKey = {
    provider,
    keyPrefix: key.slice(0, 8),
    addedAt: existing?.addedAt ?? new Date(),
  };
  if (existing?.lastUsed) {
    storedKey.lastUsed = existing.lastUsed;
  }
  metadata.set(provider, storedKey);
  saveStoredKeyMetadata(metadata);
}

/**
 * Does this string plausibly look like a real key for the given provider?
 * Used ONLY to disambiguate a raw legacy value from a base64-encoded one during
 * migration — never to reject a key. Google has no enforced prefix elsewhere,
 * but real Google AI / Gemini keys start with "AIza"; using that here lets us
 * tell a raw Google key from a base64-encoded legacy blob (whose first bytes
 * would be different) so the base64 fallback in decodeLegacyApiKey is actually
 * reachable for Google, consistent with anthropic/openai. Anything that doesn't
 * match still falls back to the raw value, so no key is ever lost.
 */
function looksLikeProviderKey(provider: KeyProvider, key: string): boolean {
  if (key.length < 20) return false;
  switch (provider) {
    case 'anthropic':
      return key.startsWith('sk-ant-');
    case 'openai':
      return key.startsWith('sk-');
    case 'google':
      return key.startsWith('AIza');
  }
}

/**
 * Decode a legacy `apiKey_<provider>` value. The real legacy writer (the old
 * useApiKeys hook) stored the RAW key; a hypothetical even-older build may have
 * base64-encoded it. Prefer the interpretation that looks like a real key, and
 * default to the raw value so we never lose or corrupt a user's credential.
 */
function decodeLegacyApiKey(provider: KeyProvider, stored: string): string {
  if (looksLikeProviderKey(provider, stored)) return stored;
  try {
    const decoded = atob(stored);
    if (looksLikeProviderKey(provider, decoded)) return decoded;
  } catch {
    // Not base64 — fall through to the raw value.
  }
  return stored;
}

/**
 * One-time migration for API keys saved by older builds under
 * `apiKey_<provider>` in renderer localStorage. Moves them into the keychain
 * (the OS keychain on desktop, base64-obfuscated localStorage in the browser)
 * and deletes the plaintext copy. Runs on both desktop and browser so no raw
 * key is ever left sitting in plain localStorage. Sentinel-gated so it runs at
 * most once per install; if any key fails to migrate the sentinel is withheld
 * so the next launch retries.
 */
export async function migrateLocalStorageApiKeysToKeychain(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(API_KEY_MIGRATION_SENTINEL)) return;

  const backend: KeyStorageBackend = isTauri()
    ? new TauriKeychainBackend()
    : new LocalStorageBackend();
  let migrationComplete = true;
  let migratedAny = false;

  for (const provider of KEY_PROVIDERS) {
    const legacyStorageKey = `${LEGACY_API_KEY_PREFIX}${provider}`;
    const stored = localStorage.getItem(legacyStorageKey);
    if (stored === null) continue;

    try {
      // If the keychain ALREADY has a key for this provider (e.g. the user
      // re-added it via Settings after the upgrade — Settings writes only
      // through the keychain), never roll it back to the older legacy value.
      // Just clean up the stale plaintext and move on. (The broken v1 migration
      // could leave a plaintext entry behind even when a good keychain key
      // exists.)
      const existing = await backend.get(provider);
      if (existing !== null) {
        localStorage.removeItem(legacyStorageKey);
        continue;
      }

      const key = decodeLegacyApiKey(provider, stored);
      await backend.set(provider, key);
      const verifiedKey = await backend.get(provider);
      if (verifiedKey !== key) {
        migrationComplete = false;
        continue;
      }

      upsertStoredKeyMetadata(provider, key);
      localStorage.removeItem(legacyStorageKey);
      migratedAny = true;
    } catch {
      migrationComplete = false;
    }
  }

  if (migrationComplete) {
    localStorage.setItem(API_KEY_MIGRATION_SENTINEL, 'true');
    // The v1 sentinel is obsolete once v2 has run cleanly.
    localStorage.removeItem(API_KEY_MIGRATION_SENTINEL_V1);
  }

  // If we moved any plaintext key into the keychain, broadcast the change so
  // live key state (useApiKeys) and the egress badge re-read it in THIS
  // session — an upgrading user gets a working AI provider without a restart.
  if (migratedAny) {
    notifyEgressConfigChange();
  }
}

/**
 * KeychainService manages API keys securely
 */
export class KeychainService {
  private backend: KeyStorageBackend;
  private envBackend: EnvBackend;
  private metadata: Map<KeyProvider, StoredKey> = new Map();
  private readonly metadataKey = KEYCHAIN_METADATA_KEY;

  constructor(backendType: KeychainBackendType = isTauriRuntime() ? 'tauri' : 'localStorage') {
    switch (backendType) {
      case 'localStorage':
        this.backend = new LocalStorageBackend();
        break;
      case 'tauri':
        this.backend = new TauriKeychainBackend();
        break;
      case 'memory':
        this.backend = new MemoryBackend();
        break;
      case 'env':
        this.backend = new EnvBackend();
        break;
    }
    this.envBackend = new EnvBackend();
    this.loadMetadata();
  }

  /**
   * Get an API key for a provider
   * Checks: backend -> env vars
   */
  async getKey(provider: KeyProvider): Promise<string | null> {
    // First, check the primary backend
    const key = await this.backend.get(provider);
    if (key) {
      this.updateLastUsed(provider);
      return key;
    }

    // Fall back to env vars
    return this.envBackend.get(provider);
  }

  /**
   * Set an API key for a provider
   */
  async setKey(provider: KeyProvider, key: string): Promise<void> {
    // Validate key format
    this.validateKeyFormat(provider, key);

    await this.backend.set(provider, key);

    // Refresh from the localStorage source of truth before mutating so we MERGE
    // (never clobber) entries added by another KeychainService instance or by
    // the one-time legacy migration. Without this, a long-lived instance whose
    // cache was loaded before those writes would overwrite them on save.
    this.loadMetadata();
    this.metadata.set(provider, {
      provider,
      keyPrefix: key.slice(0, 8),
      addedAt: new Date(),
      lastUsed: new Date(),
    });
    this.saveMetadata();
    // Let the always-visible egress trust badge re-resolve immediately.
    notifyEgressConfigChange();
  }

  /**
   * Delete an API key
   */
  async deleteKey(provider: KeyProvider): Promise<void> {
    await this.backend.delete(provider);
    // Refresh before mutating (see setKey) so deleting one key can't clobber
    // others added elsewhere since this instance was constructed.
    this.loadMetadata();
    this.metadata.delete(provider);
    this.saveMetadata();
    notifyEgressConfigChange();
  }

  /**
   * Check if a key exists for a provider
   */
  async hasKey(provider: KeyProvider): Promise<boolean> {
    const hasInBackend = await this.backend.has(provider);
    if (hasInBackend) return true;

    return this.envBackend.has(provider);
  }

  /**
   * Get all stored key metadata (without the actual keys).
   *
   * Reads from the localStorage source of truth on every call so a long-lived
   * instance reflects keys added by another instance or by the one-time legacy
   * migration — the "Manage AI Account Keys" settings screen must show a
   * migrated key in the SAME session, without an app reload.
   */
  getStoredKeys(): StoredKey[] {
    this.loadMetadata();
    return Array.from(this.metadata.values());
  }

  /**
   * Get key metadata for a provider (fresh from the localStorage source of
   * truth — see getStoredKeys).
   */
  getKeyMetadata(provider: KeyProvider): StoredKey | undefined {
    this.loadMetadata();
    return this.metadata.get(provider);
  }

  /**
   * Check if a key is from env vars (read-only)
   */
  async isEnvKey(provider: KeyProvider): Promise<boolean> {
    const hasInBackend = await this.backend.has(provider);
    if (hasInBackend) return false;

    return this.envBackend.has(provider);
  }

  /**
   * Validate that a key is properly formatted
   */
  async validateKey(provider: KeyProvider): Promise<{ valid: boolean; error?: string }> {
    const key = await this.getKey(provider);
    if (!key) {
      return { valid: false, error: 'No key configured' };
    }

    try {
      this.validateKeyFormat(provider, key);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid key format',
      };
    }
  }

  /**
   * Get a masked version of the key for display
   */
  async getMaskedKey(provider: KeyProvider): Promise<string | null> {
    const key = await this.getKey(provider);
    if (!key) return null;

    if (key.length <= 12) {
      return '********';
    }

    return key.slice(0, 8) + '...' + key.slice(-4);
  }

  /**
   * Validate key format
   */
  private validateKeyFormat(provider: KeyProvider, key: string): void {
    switch (provider) {
      case 'anthropic':
        if (!key.startsWith('sk-ant-')) {
          throw new Error('Anthropic API keys should start with "sk-ant-"');
        }
        break;
      case 'openai':
        if (!key.startsWith('sk-')) {
          throw new Error('OpenAI API keys should start with "sk-"');
        }
        break;
      case 'google':
        // Google AI keys have various formats
        if (key.length < 20) {
          throw new Error('Google AI API key seems too short');
        }
        break;
    }

    if (key.length < 20) {
      throw new Error('API key seems too short');
    }
  }

  /**
   * Update last used timestamp
   */
  private updateLastUsed(provider: KeyProvider): void {
    // Refresh before mutating so bumping one key's lastUsed can't clobber
    // entries added elsewhere since this instance was constructed.
    this.loadMetadata();
    const meta = this.metadata.get(provider);
    if (meta) {
      meta.lastUsed = new Date();
      this.saveMetadata();
    }
  }

  /**
   * Load metadata from storage
   */
  private loadMetadata(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const data = localStorage.getItem(this.metadataKey);
      if (data) {
        const parsed = JSON.parse(data) as StoredKey[];
        this.metadata.clear();
        for (const item of parsed) {
          item.addedAt = new Date(item.addedAt);
          if (item.lastUsed) {
            item.lastUsed = new Date(item.lastUsed);
          }
          this.metadata.set(item.provider, item);
        }
      }
    } catch {
      // Ignore load errors
    }
  }

  /**
   * Save metadata to storage
   */
  private saveMetadata(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const data = Array.from(this.metadata.values());
      localStorage.setItem(this.metadataKey, JSON.stringify(data));
    } catch {
      // Ignore save errors
    }
  }
}

/**
 * Create a keychain service instance
 */
export function createKeychainService(
  backendType?: KeychainBackendType
): KeychainService {
  return new KeychainService(backendType);
}

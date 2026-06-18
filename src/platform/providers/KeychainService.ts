// Keychain Service
// Secure API key storage with multiple backend support

import { invoke, isTauri } from '@tauri-apps/api/core';

export type KeyProvider = 'anthropic' | 'openai' | 'google';

const KEY_PROVIDERS: KeyProvider[] = ['anthropic', 'openai', 'google'];
const LEGACY_API_KEY_PREFIX = 'apiKey_';
const API_KEY_MIGRATION_SENTINEL = 'keepance_apikeys_migrated_v1';
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

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
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
 * One-time desktop migration for API keys saved by older builds under
 * `apiKey_<provider>` in renderer localStorage.
 */
export async function migrateLocalStorageApiKeysToKeychain(): Promise<void> {
  if (!isTauri()) return;
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(API_KEY_MIGRATION_SENTINEL)) return;

  const backend = new TauriKeychainBackend();
  let migrationComplete = true;

  for (const provider of KEY_PROVIDERS) {
    const legacyStorageKey = `${LEGACY_API_KEY_PREFIX}${provider}`;
    const encodedKey = localStorage.getItem(legacyStorageKey);
    if (encodedKey === null) continue;

    let decodedKey: string;
    try {
      decodedKey = atob(encodedKey);
    } catch {
      migrationComplete = false;
      continue;
    }

    try {
      await backend.set(provider, decodedKey);
      const verifiedKey = await backend.get(provider);
      if (verifiedKey !== decodedKey) {
        migrationComplete = false;
        continue;
      }

      upsertStoredKeyMetadata(provider, decodedKey);
      localStorage.removeItem(legacyStorageKey);
    } catch {
      migrationComplete = false;
    }
  }

  if (migrationComplete) {
    localStorage.setItem(API_KEY_MIGRATION_SENTINEL, 'true');
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

    // Update metadata
    this.metadata.set(provider, {
      provider,
      keyPrefix: key.slice(0, 8),
      addedAt: new Date(),
      lastUsed: new Date(),
    });
    this.saveMetadata();
  }

  /**
   * Delete an API key
   */
  async deleteKey(provider: KeyProvider): Promise<void> {
    await this.backend.delete(provider);
    this.metadata.delete(provider);
    this.saveMetadata();
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
   * Get all stored key metadata (without the actual keys)
   */
  getStoredKeys(): StoredKey[] {
    return Array.from(this.metadata.values());
  }

  /**
   * Get key metadata for a provider
   */
  getKeyMetadata(provider: KeyProvider): StoredKey | undefined {
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

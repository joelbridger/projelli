import { describe, expect, it } from 'vitest';
import {
  cloudKeyPresenceFromValues,
  modelBelongsToCloudProvider,
  resolvePreferredCloudProvider,
  toTemplateProviderId,
} from '@/platform/providers/resolvePreferredCloudProvider';

describe('resolvePreferredCloudProvider', () => {
  it('lets the settings default provider win when that provider has a key', () => {
    const result = resolvePreferredCloudProvider({
      availableKeys: cloudKeyPresenceFromValues({
        anthropic: 'stale-but-present',
        openai: 'valid-openai',
      }),
      settings: { defaultProvider: 'openai', defaultModel: 'gpt-4o' },
    });

    expect(result).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('falls back to stable key-presence order when the default provider has no key', () => {
    const result = resolvePreferredCloudProvider({
      availableKeys: cloudKeyPresenceFromValues({
        openai: 'valid-openai',
        google: 'valid-google',
      }),
      settings: { defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-4-6' },
    });

    expect(result?.provider).toBe('openai');
  });

  it('uses the default model when it belongs to the chosen provider', () => {
    const result = resolvePreferredCloudProvider({
      availableKeys: cloudKeyPresenceFromValues({ google: 'valid-google' }),
      settings: { defaultProvider: 'google', defaultModel: 'gemini-1.5-pro' },
    });

    expect(result).toEqual({ provider: 'google', model: 'gemini-1.5-pro' });
  });

  it("substitutes the chosen provider's default model when the configured model belongs elsewhere", () => {
    const result = resolvePreferredCloudProvider({
      availableKeys: cloudKeyPresenceFromValues({ openai: 'valid-openai' }),
      settings: { defaultProvider: 'openai', defaultModel: 'claude-sonnet-4-6' },
    });

    expect(result?.provider).toBe('openai');
    expect(result?.model).toBe('gpt-4o');
  });

  it('never returns a provider without a key', () => {
    const result = resolvePreferredCloudProvider({
      availableKeys: cloudKeyPresenceFromValues({ anthropic: null }),
      settings: { defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-4-6' },
    });

    expect(result).toBeNull();
  });

  it('never returns a cross-provider model', () => {
    const result = resolvePreferredCloudProvider({
      availableKeys: cloudKeyPresenceFromValues({
        openai: 'valid-openai',
        google: 'valid-google',
      }),
      settings: { defaultProvider: 'openai', defaultModel: 'gemini-1.5-pro' },
    });

    expect(result).toEqual({ provider: 'openai', model: 'gpt-4o' });
    expect(modelBelongsToCloudProvider(result!.provider, result!.model)).toBe(true);
  });

  it('excludes known-invalid providers and can pick the next provider instead', () => {
    const result = resolvePreferredCloudProvider({
      availableKeys: cloudKeyPresenceFromValues({
        anthropic: 'known-bad',
        openai: 'valid-openai',
      }),
      invalidProviders: new Set(['anthropic']),
    });

    expect(result?.provider).toBe('openai');
  });

  it('prefers verified providers when at least one available provider is verified', () => {
    const result = resolvePreferredCloudProvider({
      availableKeys: cloudKeyPresenceFromValues({
        anthropic: 'unknown-anthropic',
        openai: 'verified-openai',
      }),
      verifiedProviders: new Set(['openai']),
    });

    expect(result?.provider).toBe('openai');
  });

  it('maps cloud provider ids to workflow template provider ids', () => {
    expect(toTemplateProviderId('anthropic')).toBe('claude');
    expect(toTemplateProviderId('openai')).toBe('openai');
    expect(toTemplateProviderId('google')).toBe('gemini');
  });
});

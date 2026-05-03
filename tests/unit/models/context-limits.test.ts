import { describe, it, expect } from 'vitest';
import {
  getMaxContextTokens,
  getTier2Warning,
  isLimitExceedingCapability,
  formatContextSize,
} from '@/modules/models/context-limits';

describe('getMaxContextTokens', () => {
  it('returns 200K for known Claude Sonnet model', () => {
    expect(getMaxContextTokens('anthropic', 'claude-3-5-sonnet-20241022')).toBe(200000);
  });

  it('returns 200K for claude-sonnet-4-5-20250514', () => {
    expect(getMaxContextTokens('anthropic', 'claude-sonnet-4-5-20250514')).toBe(200000);
  });

  it('returns 200K for claude-haiku-4-5-20251001', () => {
    expect(getMaxContextTokens('anthropic', 'claude-haiku-4-5-20251001')).toBe(200000);
  });

  it('returns 1M for Gemini 1.5 Pro', () => {
    expect(getMaxContextTokens('gemini', 'gemini-1.5-pro')).toBe(1_000_000);
  });

  it('returns 1M for Gemini 2.0 flash', () => {
    expect(getMaxContextTokens('gemini', 'gemini-2.0-flash')).toBe(1_000_000);
  });

  it('returns 128K for gpt-4o', () => {
    expect(getMaxContextTokens('openai', 'gpt-4o')).toBe(128_000);
  });

  it('returns 128K for gpt-4o-mini', () => {
    expect(getMaxContextTokens('openai', 'gpt-4o-mini')).toBe(128_000);
  });

  it('returns 200K for o1', () => {
    expect(getMaxContextTokens('openai', 'o1')).toBe(200_000);
  });

  it('returns 200K for o3', () => {
    expect(getMaxContextTokens('openai', 'o3')).toBe(200_000);
  });

  it('falls back to provider default for unknown Claude model', () => {
    expect(getMaxContextTokens('anthropic', 'claude-unknown-future')).toBe(200_000);
  });

  it('falls back to provider default for unknown Ollama model', () => {
    expect(getMaxContextTokens('ollama', 'custom-local-model')).toBe(8_192);
  });

  it('falls back to 8192 for completely unknown provider', () => {
    expect(getMaxContextTokens('unknown-provider', 'some-model')).toBe(8_192);
  });

  it('returns 8192 for llama3', () => {
    expect(getMaxContextTokens('ollama', 'llama3')).toBe(8_192);
  });

  it('returns 131072 for llama3.1', () => {
    expect(getMaxContextTokens('ollama', 'llama3.1')).toBe(131_072);
  });

  it('returns 1M for Gemini fallback (unknown model)', () => {
    expect(getMaxContextTokens('gemini', 'gemini-unknown-next')).toBe(1_000_000);
  });
});

describe('getTier2Warning', () => {
  it('returns null for standard Sonnet', () => {
    expect(getTier2Warning('anthropic', 'claude-3-5-sonnet-20241022')).toBeNull();
  });

  it('returns null for unknown model', () => {
    expect(getTier2Warning('anthropic', 'claude-unknown')).toBeNull();
  });

  it('returns warning string for 1M Sonnet variant', () => {
    const warning = getTier2Warning('anthropic', 'claude-sonnet-4-5-20250514-1m');
    expect(warning).not.toBeNull();
    expect(warning).toContain('Tier 2+');
  });
});

describe('isLimitExceedingCapability', () => {
  it('returns false when limit is within model capability', () => {
    expect(isLimitExceedingCapability('anthropic', 'claude-3-5-sonnet-20241022', 100_000)).toBe(false);
  });

  it('returns false when limit equals model capability', () => {
    expect(isLimitExceedingCapability('anthropic', 'claude-3-5-sonnet-20241022', 200_000)).toBe(false);
  });

  it('returns true when limit exceeds model capability', () => {
    expect(isLimitExceedingCapability('openai', 'gpt-4', 200_000)).toBe(true);
  });

  it('does not warn when 200K limit with Sonnet (200K cap)', () => {
    expect(isLimitExceedingCapability('anthropic', 'claude-3-5-sonnet-20241022', 200_000)).toBe(false);
  });

  it('warns when 500K limit with gpt-4o (128K cap)', () => {
    expect(isLimitExceedingCapability('openai', 'gpt-4o', 500_000)).toBe(true);
  });

  it('does not warn when 1M limit with Gemini 1.5 Pro (1M cap)', () => {
    expect(isLimitExceedingCapability('gemini', 'gemini-1.5-pro', 1_000_000)).toBe(false);
  });

  it('warns when 1M limit with standard Sonnet (200K cap)', () => {
    expect(isLimitExceedingCapability('anthropic', 'claude-3-5-sonnet-20241022', 1_000_000)).toBe(true);
  });
});

describe('formatContextSize', () => {
  it('formats 200K', () => expect(formatContextSize(200_000)).toBe('200K'));
  it('formats 1M', () => expect(formatContextSize(1_000_000)).toBe('1M'));
  it('formats small numbers', () => expect(formatContextSize(8192)).toBe('8K'));
  it('formats 128K', () => expect(formatContextSize(128_000)).toBe('128K'));
  it('formats 32K', () => expect(formatContextSize(32_768)).toBe('33K'));
});

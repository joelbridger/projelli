import { describe, it, expect } from 'vitest';
import { isLimitExceedingCapability, getMaxContextTokens } from '@/modules/models/context-limits';

describe('chatContextTokenLimit capability warning logic', () => {
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

  it('new default 200K stays within Sonnet capability', () => {
    const defaultLimit = 200_000;
    const sonnetCap = getMaxContextTokens('anthropic', 'claude-sonnet-4-5-20250514');
    expect(defaultLimit).toBeLessThanOrEqual(sonnetCap);
  });

  it('max 1M is within Gemini 1.5 Pro capability', () => {
    const maxLimit = 1_000_000;
    const geminiCap = getMaxContextTokens('gemini', 'gemini-1.5-pro');
    expect(maxLimit).toBeLessThanOrEqual(geminiCap);
  });
});

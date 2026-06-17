import { describe, it, expect } from 'vitest';
import {
  isVisionModel,
  getSuggestedVisionModel,
  SUPPORTED_IMAGE_MIMES,
} from '@/platform/providers/vision-capability';

describe('isVisionModel', () => {
  // Claude vision models
  it('claude-3-5-sonnet-20241022 is vision-capable', () => {
    expect(isVisionModel('claude', 'claude-3-5-sonnet-20241022')).toBe(true);
  });
  it('claude-3-opus-20240229 is vision-capable', () => {
    expect(isVisionModel('claude', 'claude-3-opus-20240229')).toBe(true);
  });
  it('claude-3-haiku-20240307 is vision-capable', () => {
    expect(isVisionModel('claude', 'claude-3-haiku-20240307')).toBe(true);
  });
  // claude-3-5-haiku is text-only
  it('claude-3-5-haiku is NOT vision-capable', () => {
    expect(isVisionModel('claude', 'claude-3-5-haiku-20251001')).toBe(false);
  });
  // Modern claude models
  it('claude-sonnet-4-6 is vision-capable', () => {
    expect(isVisionModel('claude', 'claude-sonnet-4-6')).toBe(true);
  });

  // OpenAI vision models
  it('gpt-4o is vision-capable', () => {
    expect(isVisionModel('openai', 'gpt-4o')).toBe(true);
  });
  it('gpt-4o-mini is vision-capable', () => {
    expect(isVisionModel('openai', 'gpt-4o-mini')).toBe(true);
  });
  it('o1 is vision-capable', () => {
    expect(isVisionModel('openai', 'o1')).toBe(true);
  });
  it('gpt-3.5-turbo is NOT vision-capable', () => {
    expect(isVisionModel('openai', 'gpt-3.5-turbo')).toBe(false);
  });
  it('gpt-4 (non-o) is NOT vision-capable', () => {
    expect(isVisionModel('openai', 'gpt-4')).toBe(false);
  });

  // Gemini vision models
  it('gemini-1.5-pro is vision-capable', () => {
    expect(isVisionModel('gemini', 'gemini-1.5-pro')).toBe(true);
  });
  it('gemini-2.0-flash is vision-capable', () => {
    expect(isVisionModel('gemini', 'gemini-2.0-flash')).toBe(true);
  });
  it('gemini-pro (no version suffix) is NOT vision-capable', () => {
    expect(isVisionModel('gemini', 'gemini-pro')).toBe(false);
  });

  // Ollama runtime probe
  it('llava:13b is vision-capable', () => {
    expect(isVisionModel('ollama', 'llava:13b')).toBe(true);
  });
  it('LLAVA is vision-capable (case-insensitive)', () => {
    expect(isVisionModel('ollama', 'LLAVA')).toBe(true);
  });
  it('qwen2.5-vl:7b is vision-capable', () => {
    expect(isVisionModel('ollama', 'qwen2.5-vl:7b')).toBe(true);
  });
  it('moondream:vision is vision-capable', () => {
    expect(isVisionModel('ollama', 'moondream:vision')).toBe(true);
  });
  it('llama3.2:3b is NOT vision-capable', () => {
    expect(isVisionModel('ollama', 'llama3.2:3b')).toBe(false);
  });
  it('mistral:7b is NOT vision-capable', () => {
    expect(isVisionModel('ollama', 'mistral:7b')).toBe(false);
  });

  // Mock provider always returns true
  it('mock provider always vision-capable', () => {
    expect(isVisionModel('mock', 'mock-model')).toBe(true);
  });

  // Unknown provider
  it('unknown provider returns false', () => {
    expect(isVisionModel('unknown-provider', 'some-model')).toBe(false);
  });
});

describe('getSuggestedVisionModel', () => {
  it('suggests claude vision model for claude provider', () => {
    const m = getSuggestedVisionModel('claude');
    expect(isVisionModel('claude', m)).toBe(true);
  });
  it('suggests openai vision model for openai provider', () => {
    const m = getSuggestedVisionModel('openai');
    expect(isVisionModel('openai', m)).toBe(true);
  });
  it('suggests gemini vision model for gemini provider', () => {
    const m = getSuggestedVisionModel('gemini');
    expect(isVisionModel('gemini', m)).toBe(true);
  });
  it('ollama suggestion is the llava probe string', () => {
    expect(getSuggestedVisionModel('ollama')).toBe('llava');
  });
  it('unknown provider suggestion is empty string', () => {
    expect(getSuggestedVisionModel('unknown')).toBe('');
  });
});

describe('SUPPORTED_IMAGE_MIMES', () => {
  it('includes png, jpeg, gif, webp', () => {
    expect(SUPPORTED_IMAGE_MIMES).toContain('image/png');
    expect(SUPPORTED_IMAGE_MIMES).toContain('image/jpeg');
    expect(SUPPORTED_IMAGE_MIMES).toContain('image/gif');
    expect(SUPPORTED_IMAGE_MIMES).toContain('image/webp');
  });
});

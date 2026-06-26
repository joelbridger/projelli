/**
 * New-chat default model seeding (UX-39).
 *
 * The live model list can put a weak/dated model first (OpenAI returns
 * gpt-3.5-turbo ahead of gpt-4o-mini). Seeding a new chat with `models[0]` then
 * picks the weak model, so the very first AI experience is visibly worse for no
 * reason the user can see. The curated per-provider default must win over the
 * arbitrary first list entry (when it is actually available).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveModelForProvider,
  resolveNewChatDefault,
} from '@/features/ask/chat/providerModelResolution';

function seedOpenAiModels(ids: string[]): void {
  localStorage.setItem(
    'keepance_models_openai',
    JSON.stringify({
      models: ids.map((id) => ({ id, displayName: id, provider: 'openai' })),
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('resolveModelForProvider — curated default wins over a weak models[0]', () => {
  it('prefers the curated gpt-4o-mini over gpt-3.5-turbo even when gpt-3.5-turbo is first', () => {
    seedOpenAiModels(['gpt-3.5-turbo', 'gpt-4o-mini', 'gpt-4o']);
    expect(resolveModelForProvider('openai')).toBe('gpt-4o-mini');
  });

  it('still honors an explicit preferred model when it belongs to the provider', () => {
    seedOpenAiModels(['gpt-3.5-turbo', 'gpt-4o-mini', 'gpt-4o']);
    expect(resolveModelForProvider('openai', 'gpt-4o')).toBe('gpt-4o');
  });

  it('falls back to the first listed model when the curated default is unavailable', () => {
    seedOpenAiModels(['gpt-3.5-turbo', 'gpt-4-turbo']);
    expect(resolveModelForProvider('openai')).toBe('gpt-3.5-turbo');
  });

  it('prefers the CURRENT curated Google model (gemini-2.5-flash), not an older one', () => {
    // Regression guard (Codex review): the curated Google default must be the
    // current gemini-2.5-flash, never the older gemini-1.5-flash, even when the
    // live list happens to put 1.5-flash first.
    localStorage.setItem(
      'keepance_models_google',
      JSON.stringify({
        models: [
          { id: 'gemini-1.5-flash', displayName: 'g', provider: 'google' },
          { id: 'gemini-2.5-flash', displayName: 'g', provider: 'google' },
        ],
      }),
    );
    expect(resolveModelForProvider('google')).toBe('gemini-2.5-flash');
  });
});

describe('resolveNewChatDefault — a freshly-keyed OpenAI chat seeds gpt-4o-mini', () => {
  it('does not seed gpt-3.5-turbo for a new OpenAI chat', () => {
    seedOpenAiModels(['gpt-3.5-turbo', 'gpt-4o-mini']);
    const result = resolveNewChatDefault([
      { provider: 'openai', key: 'sk-test', isValid: true },
    ]);
    expect(result?.provider).toBe('openai');
    expect(result?.model).toBe('gpt-4o-mini');
  });
});

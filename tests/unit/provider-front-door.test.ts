// F2.2 — the "one front door" contract for AI-provider construction.
//
// Background: at least five surfaces (Ask, chat send, AIChatViewer, the DOCX
// redline resolver, Client Map / At-a-Glance, the workflow runner) used to each
// `new ClaudeProvider(…)` / `new OpenAIProvider(…)` / … independently to decide
// which AI to talk to. They drifted — a BYOK user with only an OpenAI key once
// got a DEAD redline button because one surface fell back to a hardcoded
// 'anthropic' default. Every construction now flows through ONE door:
// createProvider() in providerFactory.ts, so all surfaces agree on which AI a
// selection maps to and the egress indicator can never disagree with the send.
//
// This test does two things:
//   1. Documents intent: createProvider is the delegate every surface resolves
//      through, and it maps each id to the intended concrete Provider (identity),
//      throws on an unknown id (no silent cloud default), and never turns a LOCAL
//      selection into a cloud provider.
//   2. Enforces the rule a SECOND way (besides scripts/gate.sh): it reuses the
//      exact scan from scripts/check-provider-construction.mjs to assert no
//      surface reintroduces a raw `new …Provider(` outside the providers layer —
//      so the invariant is checked inside `vitest run`, not only in the gate.

import { describe, it, expect } from 'vitest';
import { createProvider, isLocalProviderId } from '@/platform/providers/providerFactory';
import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';
import { OpenAIProvider } from '@/platform/providers/OpenAIProvider';
import { GeminiProvider } from '@/platform/providers/GeminiProvider';
import { OllamaProvider } from '@/platform/providers/OllamaProvider';
import { AppLocalProvider } from '@/platform/providers/AppLocalProvider';
// The gate check's scan, imported directly so the test and the gate enforce the
// SAME rule from one source of truth.
import { findProviderConstructionViolations } from '../../scripts/check-provider-construction.mjs';

describe('provider front door (F2.2): createProvider is the one door', () => {
  it('maps every id to its intended concrete Provider (cloud + local)', () => {
    // Cloud: BYOK-direct, identity fixed by id (never a hardcoded default).
    expect(createProvider({ provider: 'anthropic', apiKey: 'k' })).toBeInstanceOf(ClaudeProvider);
    expect(createProvider({ provider: 'openai', apiKey: 'k' })).toBeInstanceOf(OpenAIProvider);
    expect(createProvider({ provider: 'google', apiKey: 'k' })).toBeInstanceOf(GeminiProvider);
    // Local: on-device engines, keyless — a local id can NEVER become a cloud provider.
    expect(createProvider({ provider: 'ollama' })).toBeInstanceOf(OllamaProvider);
    expect(createProvider({ provider: 'keepance-local' })).toBeInstanceOf(AppLocalProvider);
  });

  it('throws loudly on an unknown id instead of defaulting to a cloud provider', () => {
    // The drift bug was a silent fallback to 'anthropic'. The front door fails
    // closed: a bad id is a hard error, not a Claude request.
    expect(() =>
      // @ts-expect-error — deliberately an id outside ChatProviderId.
      createProvider({ provider: 'totally-unknown' }),
    ).toThrow(/Unsupported provider/i);
  });

  it('agrees with isLocalProviderId on which selections are on-device', () => {
    expect(isLocalProviderId('ollama')).toBe(true);
    expect(isLocalProviderId('keepance-local')).toBe(true);
    expect(isLocalProviderId('anthropic')).toBe(false);
    expect(isLocalProviderId('openai')).toBe(false);
    expect(isLocalProviderId('google')).toBe(false);
  });

  it('honors an explicit model and falls back to the provider default otherwise', () => {
    expect(createProvider({ provider: 'anthropic', apiKey: 'k', model: 'claude-3-5-haiku-latest' })
      .getMetadata().model).toBe('claude-3-5-haiku-latest');
    // No model → the provider fills in its own default (non-empty string).
    expect(createProvider({ provider: 'ollama' }).getMetadata().model.length).toBeGreaterThan(0);
  });
});

describe('provider front door (F2.2): no surface reintroduces raw construction', () => {
  it('has zero `new …Provider(` outside the providers layer', () => {
    const violations = findProviderConstructionViolations();
    // A readable failure message: list any offending sites so a future author
    // knows exactly what to route through createProvider().
    expect(
      violations,
      violations.length
        ? 'Route these through createProvider() (fix F2.2):\n' +
            violations.map((v) => `  ${v.relPath}:${v.line}  ${v.text}`).join('\n')
        : '',
    ).toEqual([]);
  });
});

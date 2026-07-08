// BUG-009 — resolveRedlineProvider: the .docx AI-redline provider resolution.
//
// Guards the MainPanel -> DocxEditor `aiProvider` wiring that, when missing, made
// "Revise with AI" dead for every non-Anthropic BYOK user. These cases encode
// the rule order and the two regressions Codex flagged on the first fix:
//   - reactive to a key added mid-session (don't pin to a stale provider), and
//   - a stale/invalid higher-priority key must not mask a valid lower one.

import { describe, it, expect } from 'vitest';
import { resolveRedlineProvider } from '@/app/shell/layout/resolveRedlineProvider';

const key = (provider: string, isValid: boolean) => ({ provider, key: 'sk-x', isValid });

describe('resolveRedlineProvider (BUG-009)', () => {
  it('uses the OpenAI provider when that is the only valid key (the original bug)', () => {
    expect(
      resolveRedlineProvider({
        localOnly: false,
        egressProvider: 'openai', // egress resolves to openai (only key present)
        apiKeys: [key('openai', true)],
      }),
    ).toBe('openai');
  });

  it('prefers the trust-bar (egress) provider when it has a valid key', () => {
    // Both anthropic and openai keys valid; trust bar resolved to anthropic.
    expect(
      resolveRedlineProvider({
        localOnly: false,
        egressProvider: 'anthropic',
        apiKeys: [key('anthropic', true), key('openai', true)],
      }),
    ).toBe('anthropic');
  });

  it('falls back to a valid key when the egress provider has only a STALE key', () => {
    // Stale/invalid anthropic key masks a valid openai key — must not stay dead.
    expect(
      resolveRedlineProvider({
        localOnly: false,
        egressProvider: 'anthropic',
        apiKeys: [key('anthropic', false), key('openai', true)],
      }),
    ).toBe('openai');
  });

  it('reacts to a key added this session even if egress still points at the no-key default', () => {
    // App started with no keys -> egress fell back to 'anthropic'; user just
    // added a valid OpenAI key. apiKeys is reactive, so redline picks openai.
    expect(
      resolveRedlineProvider({
        localOnly: false,
        egressProvider: 'anthropic', // stale no-key fallback
        apiKeys: [key('openai', true)],
      }),
    ).toBe('openai');
  });

  it('returns the egress provider (button stays disabled) when no key is valid', () => {
    expect(
      resolveRedlineProvider({
        localOnly: false,
        egressProvider: 'anthropic',
        apiKeys: [key('openai', false)],
      }),
    ).toBe('anthropic');
  });

  it('resolves the local engine directly in Local-only mode, ignoring cloud keys', () => {
    expect(
      resolveRedlineProvider({
        localOnly: true,
        egressProvider: 'ollama',
        apiKeys: [key('openai', true)],
      }),
    ).toBe('ollama');
  });

  it('never leaks a badge sentinel: a null egressProvider in Local-only still resolves a real local engine (item 2)', () => {
    // MainPanel narrows the badge status through toRealProviderId, so 'none' /
    // 'local-pending' arrive here as null. Local-only must still return a real
    // on-device engine, never null/sentinel.
    expect(
      resolveRedlineProvider({ localOnly: true, egressProvider: null, apiKeys: [], localModelReady: false }),
    ).toBe('ollama');
    expect(
      resolveRedlineProvider({ localOnly: true, egressProvider: null, apiKeys: [], localModelReady: true }),
    ).toBe('lantern-local');
  });

  it('a null egressProvider (badge sentinel) still picks any valid key in cloud mode', () => {
    expect(
      resolveRedlineProvider({ localOnly: false, egressProvider: null, apiKeys: [key('openai', true)] }),
    ).toBe('openai');
  });

  it('a null egressProvider with no valid key falls back to a REAL default, never a sentinel', () => {
    expect(
      resolveRedlineProvider({ localOnly: false, egressProvider: null, apiKeys: [] }),
    ).toBe('anthropic');
  });

  it('F-503: prefers the embedded Lantern Local AI in Local-only when its model is ready', () => {
    // The reported machine shape: embedded model downloaded, no Ollama daemon.
    expect(
      resolveRedlineProvider({
        localOnly: true,
        egressProvider: 'ollama',
        apiKeys: [key('openai', true)],
        localModelReady: true,
      }),
    ).toBe('lantern-local');
  });

  it('F-503: falls back to ollama in Local-only when the embedded model is NOT ready', () => {
    expect(
      resolveRedlineProvider({
        localOnly: true,
        egressProvider: 'ollama',
        apiKeys: [],
        localModelReady: false,
      }),
    ).toBe('ollama');
  });
});

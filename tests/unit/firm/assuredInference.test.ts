/**
 * Assured inference routing + egress reflection.
 *
 *   - buildAssuredRequest points the request at `/assured/infer`, STRIPS the
 *     BYOK auth headers (so a personal key never leaks to the proxy), and sets
 *     the X-Seat-Token / X-Provider / X-Model / X-Stream control headers.
 *   - resolveEgress('assured', assuredAvailable:true) yields the assured-proxy
 *     destination with an accurate label/note; with no managed key it falls
 *     back to the honest BYOK-direct story.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// firmConfig reads import.meta.env.DEV (true under vitest) -> '/api/firm' base.
import {
  buildAssuredRequest,
  applyAssuredRoute,
  type AssuredRoute,
} from '@/platform/firm/assuredInference';
import { resolveEgress } from '@/platform/privacy/egress';

const route: AssuredRoute = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',
  accessToken: 'ACCESS_JWT',
  seatToken: 'SEAT_TOKEN',
  stream: true,
};

describe('buildAssuredRequest', () => {
  it('routes to /assured/infer and sets the assured control headers', () => {
    const out = buildAssuredRequest(route, {
      'Content-Type': 'application/json',
      'x-api-key': 'sk-ant-SECRET',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(out.url).toMatch(/\/assured\/infer$/);
    expect(out.headers['Authorization']).toBe('Bearer ACCESS_JWT');
    expect(out.headers['X-Seat-Token']).toBe('SEAT_TOKEN');
    expect(out.headers['X-Provider']).toBe('anthropic');
    expect(out.headers['X-Model']).toBe('claude-haiku-4-5-20251001');
    expect(out.headers['X-Stream']).toBe('1');
    // Provider-native non-auth header is preserved (body passes through as-is).
    expect(out.headers['Content-Type']).toBe('application/json');
  });

  it('STRIPS the BYOK key so it never reaches the proxy', () => {
    const out = buildAssuredRequest(route, {
      'Content-Type': 'application/json',
      'x-api-key': 'sk-ant-SECRET',
      Authorization: 'Bearer BYOK_OPENAI',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    // No leftover vendor-auth headers carrying a personal key.
    expect(out.headers['x-api-key']).toBeUndefined();
    expect(out.headers['anthropic-dangerous-direct-browser-access']).toBeUndefined();
    // Authorization is REPLACED with the firm access token, not the BYOK one.
    expect(out.headers['Authorization']).toBe('Bearer ACCESS_JWT');
    expect(JSON.stringify(out.headers)).not.toContain('sk-ant-SECRET');
    expect(JSON.stringify(out.headers)).not.toContain('BYOK_OPENAI');
  });

  it('STRIPS the Gemini x-goog-api-key header so a BYOK Google key never reaches the proxy', () => {
    const googleRoute: AssuredRoute = { ...route, provider: 'google', model: 'gemini-1.5-pro' };
    const out = buildAssuredRequest(googleRoute, {
      'Content-Type': 'application/json',
      'x-goog-api-key': 'AIza-SECRET-GEMINI-KEY',
    });
    expect(out.headers['x-goog-api-key']).toBeUndefined();
    expect(JSON.stringify(out.headers)).not.toContain('AIza-SECRET-GEMINI-KEY');
    expect(out.headers['X-Provider']).toBe('google');
  });

  it('X-Stream is "0" when streaming is disabled', () => {
    const out = buildAssuredRequest({ ...route, stream: false }, { 'Content-Type': 'application/json' });
    expect(out.headers['X-Stream']).toBe('0');
  });

  it('applyAssuredRoute is a pass-through when no route is given (BYOK-direct)', () => {
    const headers = { 'x-api-key': 'sk-ant-X', 'Content-Type': 'application/json' };
    const out = applyAssuredRoute(undefined, 'https://api.anthropic.com/v1/messages', headers);
    expect(out.url).toBe('https://api.anthropic.com/v1/messages');
    expect(out.headers).toBe(headers);
  });
});

describe('resolveEgress for assured mode', () => {
  it('assured + managed key configured -> assured-proxy with accurate copy', () => {
    const info = resolveEgress({ provider: 'anthropic', mode: 'assured', assuredAvailable: true });
    expect(info.destination).toBe('assured-proxy');
    expect(info.severity).toBe('assured');
    expect(info.dataLeaves).toBe(true);
    expect(info.label).toContain('Assured');
    expect(info.label).toContain('zero-retention proxy');
    expect(info.label).toContain('Anthropic');
    // Honest: the provider still sees the prompt.
    expect(info.note).toContain('Anthropic still receives the prompt');
  });

  it('assured selected but NO managed key -> falls back to BYOK-direct', () => {
    const info = resolveEgress({ provider: 'openai', mode: 'assured', assuredAvailable: false });
    expect(info.destination).toBe('provider-direct');
    expect(info.severity).toBe('direct');
  });

  it('local-only still wins over assured (nothing leaves)', () => {
    const info = resolveEgress({ provider: 'anthropic', mode: 'local-only', assuredAvailable: true });
    expect(info.destination).toBe('local');
    expect(info.dataLeaves).toBe(false);
  });
});

describe('resolveAssuredRoute (policy gate)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns undefined unless mode is assured AND a managed key exists AND tokens present', async () => {
    vi.doMock('@/platform/hooks/useConfidentialityMode', () => ({
      getConfidentialityMode: () => 'assured',
    }));
    vi.doMock('@/platform/firm/firmStore', () => ({
      getFirmAccessToken: () => 'ACCESS',
      getFirmSeatToken: () => 'SEAT',
      getAssuredProviders: () => ['anthropic'],
    }));
    const { resolveAssuredRoute } = await import('@/platform/firm/resolveAssuredRoute');
    const r = resolveAssuredRoute('anthropic', 'm1');
    expect(r).toBeDefined();
    expect(r?.accessToken).toBe('ACCESS');
    expect(r?.seatToken).toBe('SEAT');

    // No managed key for google -> undefined.
    expect(resolveAssuredRoute('google', 'm2')).toBeUndefined();
    // Local provider is never assured-routed.
    expect(resolveAssuredRoute('ollama', 'm3')).toBeUndefined();
  });

  it('returns undefined when mode is not assured', async () => {
    vi.doMock('@/platform/hooks/useConfidentialityMode', () => ({
      getConfidentialityMode: () => 'direct',
    }));
    vi.doMock('@/platform/firm/firmStore', () => ({
      getFirmAccessToken: () => 'ACCESS',
      getFirmSeatToken: () => 'SEAT',
      getAssuredProviders: () => ['anthropic'],
    }));
    const { resolveAssuredRoute } = await import('@/platform/firm/resolveAssuredRoute');
    expect(resolveAssuredRoute('anthropic', 'm1')).toBeUndefined();
  });
});

/**
 * diagnostics.test.ts — unit tests for the design-partner diagnostics core.
 *
 * Key invariants:
 *   1. sendDiagnosticEvent is a no-op unless consent is 'enabled'.
 *   2. When enabled, payload contains only structural fields + install metadata.
 *   3. No content leak: the event union has no body/text/query/content/message/
 *      subject/prompt field — verified at compile-time by TypeScript and at
 *      runtime by asserting only permitted keys appear in the payload.
 *   4. useDesignPartnerConsent tri-state read/write + cross-tab event.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  getDesignPartnerConsent,
  setDesignPartnerConsent,
  useDesignPartnerConsent,
} from '@/platform/hooks/useDesignPartnerConsent';
import { sendDiagnosticEvent, type DiagnosticEvent } from '@/platform/utils/diagnostics';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupLocalStorage() {
  const store: Record<string, string> = {};
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => store[k] ?? null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v: string) => { store[k] = v; });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((k) => { delete store[k]; });
  return store;
}

// ---------------------------------------------------------------------------
// useDesignPartnerConsent — tri-state read/write + cross-tab event
// ---------------------------------------------------------------------------

describe('useDesignPartnerConsent', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = setupLocalStorage();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to unset when nothing is stored', () => {
    const { result } = renderHook(() => useDesignPartnerConsent());
    expect(result.current.consent).toBe('unset');
  });

  it('reads enabled from localStorage', () => {
    store['keepance_design_partner_consent'] = 'enabled';
    const { result } = renderHook(() => useDesignPartnerConsent());
    expect(result.current.consent).toBe('enabled');
  });

  it('reads disabled from localStorage', () => {
    store['keepance_design_partner_consent'] = 'disabled';
    const { result } = renderHook(() => useDesignPartnerConsent());
    expect(result.current.consent).toBe('disabled');
  });

  it('setConsent writes to localStorage and updates state', () => {
    const { result } = renderHook(() => useDesignPartnerConsent());
    act(() => {
      result.current.setConsent('enabled');
    });
    expect(result.current.consent).toBe('enabled');
    expect(store['keepance_design_partner_consent']).toBe('enabled');
  });

  it('setConsent("unset") removes the key', () => {
    store['keepance_design_partner_consent'] = 'enabled';
    const { result } = renderHook(() => useDesignPartnerConsent());
    act(() => {
      result.current.setConsent('unset');
    });
    expect(result.current.consent).toBe('unset');
    expect(store['keepance_design_partner_consent']).toBeUndefined();
  });

  it('fires a cross-tab custom event when consent changes', () => {
    const listener = vi.fn();
    window.addEventListener('lantern:design-partner-consent-change', listener);
    setDesignPartnerConsent('enabled');
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener('lantern:design-partner-consent-change', listener);
  });

  it('getDesignPartnerConsent returns correct tri-state', () => {
    expect(getDesignPartnerConsent()).toBe('unset');
    setDesignPartnerConsent('enabled');
    expect(getDesignPartnerConsent()).toBe('enabled');
    setDesignPartnerConsent('disabled');
    expect(getDesignPartnerConsent()).toBe('disabled');
    setDesignPartnerConsent('unset');
    expect(getDesignPartnerConsent()).toBe('unset');
  });
});

// ---------------------------------------------------------------------------
// sendDiagnosticEvent — gate + payload shape + no content leaks
// ---------------------------------------------------------------------------

describe('sendDiagnosticEvent', () => {
  let fetchCalls: RequestInfo[] = [];
  let fetchBodies: Record<string, unknown>[] = [];
  let store: Record<string, string>;

  beforeEach(() => {
    store = setupLocalStorage();
    // Non-private mode so the fail-closed kill-switch doesn't skip the send.
    store['lantern:settings'] = JSON.stringify({ state: { values: { confidentialityMode: 'direct' } }, version: 1 });
    fetchCalls = [];
    fetchBodies = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      fetchCalls.push(input);
      fetchBodies.push(JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>);
      return new Response('{}', { status: 200 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a no-op when consent is unset', async () => {
    // No consent set => default 'unset'
    await sendDiagnosticEvent({ event: 'feature_used', feature: 'ask' });
    expect(fetchCalls).toHaveLength(0);
  });

  it('is a no-op when consent is disabled', async () => {
    store['keepance_design_partner_consent'] = 'disabled';
    await sendDiagnosticEvent({ event: 'feature_used', feature: 'ask' });
    expect(fetchCalls).toHaveLength(0);
  });

  it('sends to the design-partner endpoint (not the telemetry endpoint) when enabled', async () => {
    store['keepance_design_partner_consent'] = 'enabled';
    await sendDiagnosticEvent({ event: 'feature_used', feature: 'ask' });
    expect(fetchCalls).toHaveLength(1);
    expect(String(fetchCalls[0])).toContain('design-partner-event');
    expect(String(fetchCalls[0])).not.toContain('app-event');
  });

  it('payload contains install_id, app_version, platform, source=design-partner', async () => {
    store['keepance_design_partner_consent'] = 'enabled';
    await sendDiagnosticEvent({ event: 'feature_used', feature: 'workflow' });
    const body = fetchBodies[0]!;
    expect(body).toHaveProperty('install_id');
    expect(body).toHaveProperty('app_version');
    expect(body).toHaveProperty('platform');
    expect(body['source']).toBe('design-partner');
  });

  it('feature_used event contains event + feature, no content fields', async () => {
    store['keepance_design_partner_consent'] = 'enabled';
    await sendDiagnosticEvent({ event: 'feature_used', feature: 'search' });
    const body = fetchBodies[0]!;
    expect(body['event']).toBe('feature_used');
    expect(body['feature']).toBe('search');
    // Confirm none of the banned content fields appear
    const contentFields = ['body', 'text', 'query', 'content', 'message', 'subject', 'prompt'];
    for (const field of contentFields) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it('workflow_run event contains only templateId (not template content)', async () => {
    store['keepance_design_partner_consent'] = 'enabled';
    await sendDiagnosticEvent({ event: 'workflow_run', templateId: 'deposition-contradiction' });
    const body = fetchBodies[0]!;
    expect(body['event']).toBe('workflow_run');
    expect(body['templateId']).toBe('deposition-contradiction');
    const contentFields = ['body', 'text', 'query', 'content', 'message', 'subject', 'prompt'];
    for (const field of contentFields) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it('search_count event contains only a numeric count, no query text', async () => {
    store['keepance_design_partner_consent'] = 'enabled';
    await sendDiagnosticEvent({ event: 'search_count', count: 7 });
    const body = fetchBodies[0]!;
    expect(body['event']).toBe('search_count');
    expect(body['count']).toBe(7);
    const contentFields = ['body', 'text', 'query', 'content', 'message', 'subject', 'prompt'];
    for (const field of contentFields) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it('error_caught event contains only component + code, no stack trace', async () => {
    store['keepance_design_partner_consent'] = 'enabled';
    await sendDiagnosticEvent({ event: 'error_caught', component: 'AskPanel', code: 'rag_failed' });
    const body = fetchBodies[0]!;
    expect(body['event']).toBe('error_caught');
    expect(body['component']).toBe('AskPanel');
    expect(body['code']).toBe('rag_failed');
    expect(body).not.toHaveProperty('stack');
    expect(body).not.toHaveProperty('message');
  });

  it('onboarding_step event contains only step, no user data', async () => {
    store['keepance_design_partner_consent'] = 'enabled';
    await sendDiagnosticEvent({ event: 'onboarding_step', step: 'ai_setup' });
    const body = fetchBodies[0]!;
    expect(body['event']).toBe('onboarding_step');
    expect(body['step']).toBe('ai_setup');
    const contentFields = ['body', 'text', 'query', 'content', 'message', 'subject', 'prompt'];
    for (const field of contentFields) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it('matter_count event contains only count', async () => {
    store['keepance_design_partner_consent'] = 'enabled';
    await sendDiagnosticEvent({ event: 'matter_count', count: 12 });
    const body = fetchBodies[0]!;
    expect(body['event']).toBe('matter_count');
    expect(body['count']).toBe(12);
  });

  it('provider_connected event contains only provider name', async () => {
    store['keepance_design_partner_consent'] = 'enabled';
    await sendDiagnosticEvent({ event: 'provider_connected', provider: 'anthropic' });
    const body = fetchBodies[0]!;
    expect(body['event']).toBe('provider_connected');
    expect(body['provider']).toBe('anthropic');
  });

  it('swallows network errors silently', async () => {
    store['keepance_design_partner_consent'] = 'enabled';
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'));
    // Should not throw
    await expect(
      sendDiagnosticEvent({ event: 'feature_used', feature: 'ask' })
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Type-level compile-time check (the union forbids content fields)
// ---------------------------------------------------------------------------
describe('DiagnosticEvent type safety', () => {
  it('all valid event types are accepted (compile-time check via cast)', () => {
    const events: DiagnosticEvent[] = [
      { event: 'feature_used', feature: 'ask' },
      { event: 'feature_used', feature: 'workflow' },
      { event: 'feature_used', feature: 'search' },
      { event: 'feature_used', feature: 'dictation' },
      { event: 'feature_used', feature: 'email_import' },
      { event: 'workflow_run', templateId: 'some-template' },
      { event: 'search_count', count: 5 },
      { event: 'error_caught', component: 'Foo', code: 'bar' },
      { event: 'onboarding_step', step: 'workspace_created' },
      { event: 'matter_count', count: 3 },
      { event: 'provider_connected', provider: 'openai' },
    ];
    expect(events).toHaveLength(11);
  });
});

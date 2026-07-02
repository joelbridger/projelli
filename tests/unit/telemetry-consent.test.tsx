/**
 * telemetry-consent.test.ts — unit tests for the anonymous-telemetry consent gate.
 *
 * This test guards the "no telemetry by default" promise that the Keepance
 * trust story depends on. Any regression that lets events escape without
 * explicit consent breaks the product's core privacy claim.
 *
 * Covers:
 *   1. useTelemetryConsent tri-state read/write + cross-tab event.
 *   2. sendEvent is a no-op unless consent === 'enabled'.
 *   3. sendEvent payload shape: only structural fields, no PII.
 *   4. sendEvent posts to the /app-event endpoint (not the design-partner endpoint).
 *   5. sendEventOnce deduplication logic.
 *   6. PrivacySettings telemetry toggle enables/disables consent.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import {
  getTelemetryConsent,
  setTelemetryConsent,
  useTelemetryConsent,
} from '@/platform/hooks/useTelemetryConsent';
import { sendEvent, sendEventOnce } from '@/platform/utils/telemetry';
import { PrivacySettings } from '@/features/settings/PrivacySettings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockLocalStorage() {
  const store: Record<string, string> = {};
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => store[k] ?? null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v: string) => { store[k] = v; });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((k) => { delete store[k]; });
  return store;
}

// ---------------------------------------------------------------------------
// useTelemetryConsent — tri-state read/write + cross-tab event
// ---------------------------------------------------------------------------

describe('useTelemetryConsent', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = mockLocalStorage();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to unset when nothing is stored', () => {
    const { result } = renderHook(() => useTelemetryConsent());
    expect(result.current.consent).toBe('unset');
  });

  it('reads enabled from localStorage', () => {
    store['keepance_telemetry_consent'] = 'enabled';
    const { result } = renderHook(() => useTelemetryConsent());
    expect(result.current.consent).toBe('enabled');
  });

  it('reads disabled from localStorage', () => {
    store['keepance_telemetry_consent'] = 'disabled';
    const { result } = renderHook(() => useTelemetryConsent());
    expect(result.current.consent).toBe('disabled');
  });

  it('setConsent writes to localStorage and updates state', () => {
    const { result } = renderHook(() => useTelemetryConsent());
    act(() => {
      result.current.setConsent('enabled');
    });
    expect(result.current.consent).toBe('enabled');
    expect(store['keepance_telemetry_consent']).toBe('enabled');
  });

  it('setConsent("unset") removes the key', () => {
    store['keepance_telemetry_consent'] = 'enabled';
    const { result } = renderHook(() => useTelemetryConsent());
    act(() => {
      result.current.setConsent('unset');
    });
    expect(result.current.consent).toBe('unset');
    expect(store['keepance_telemetry_consent']).toBeUndefined();
  });

  it('fires a cross-tab custom event when consent changes', () => {
    const listener = vi.fn();
    window.addEventListener('lantern:telemetry-consent-change', listener);
    setTelemetryConsent('enabled');
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener('lantern:telemetry-consent-change', listener);
  });

  it('getTelemetryConsent returns correct tri-state', () => {
    expect(getTelemetryConsent()).toBe('unset');
    setTelemetryConsent('enabled');
    expect(getTelemetryConsent()).toBe('enabled');
    setTelemetryConsent('disabled');
    expect(getTelemetryConsent()).toBe('disabled');
    setTelemetryConsent('unset');
    expect(getTelemetryConsent()).toBe('unset');
  });
});

// ---------------------------------------------------------------------------
// sendEvent — gate (the privacy promise) + payload shape + endpoint
// ---------------------------------------------------------------------------

describe('sendEvent', () => {
  let fetchCalls: (RequestInfo | URL)[] = [];
  let fetchBodies: Record<string, unknown>[] = [];
  let store: Record<string, string>;

  beforeEach(() => {
    store = mockLocalStorage();
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

  it('is a no-op when consent is unset (the privacy default)', async () => {
    await sendEvent('app_launch');
    expect(fetchCalls).toHaveLength(0);
  });

  it('is a no-op when consent is disabled', async () => {
    store['keepance_telemetry_consent'] = 'disabled';
    await sendEvent('app_launch');
    expect(fetchCalls).toHaveLength(0);
  });

  it('sends only when consent is enabled', async () => {
    store['keepance_telemetry_consent'] = 'enabled';
    await sendEvent('app_launch');
    expect(fetchCalls).toHaveLength(1);
  });

  it('sends to the /app-event endpoint (not the design-partner endpoint)', async () => {
    store['keepance_telemetry_consent'] = 'enabled';
    await sendEvent('app_launch');
    expect(String(fetchCalls[0])).toContain('app-event');
    expect(String(fetchCalls[0])).not.toContain('design-partner');
  });

  it('payload contains install_id, app_version, platform, event', async () => {
    store['keepance_telemetry_consent'] = 'enabled';
    await sendEvent('license_activated');
    const body = fetchBodies[0]!;
    expect(body).toHaveProperty('install_id');
    expect(body).toHaveProperty('app_version');
    expect(body).toHaveProperty('platform');
    expect(body['event']).toBe('license_activated');
  });

  it('payload includes license_tier when provided', async () => {
    store['keepance_telemetry_consent'] = 'enabled';
    await sendEvent('license_activated', { license_tier: 'professional' });
    const body = fetchBodies[0]!;
    expect(body['license_tier']).toBe('professional');
  });

  it('payload converts days_since_install to string', async () => {
    store['keepance_telemetry_consent'] = 'enabled';
    await sendEvent('app_launch', { days_since_install: 14 });
    const body = fetchBodies[0]!;
    expect(body['days_since_install']).toBe('14');
  });

  it('swallows network errors silently', async () => {
    store['keepance_telemetry_consent'] = 'enabled';
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network error'));
    await expect(sendEvent('app_launch')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sendEventOnce — deduplication
// ---------------------------------------------------------------------------

describe('sendEventOnce', () => {
  let fetchCallCount = 0;
  let store: Record<string, string>;

  beforeEach(() => {
    store = mockLocalStorage();
    fetchCallCount = 0;
    store['keepance_telemetry_consent'] = 'enabled';
    // Non-private mode so the fail-closed kill-switch doesn't skip the send.
    store['lantern:settings'] = JSON.stringify({ state: { values: { confidentialityMode: 'direct' } }, version: 1 });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fetchCallCount++;
      return new Response('{}', { status: 200 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the first time', async () => {
    await sendEventOnce('trial_start');
    expect(fetchCallCount).toBe(1);
  });

  it('does not send a second time for the same event name', async () => {
    await sendEventOnce('trial_start');
    await sendEventOnce('trial_start');
    expect(fetchCallCount).toBe(1);
  });

  it('sends different event names independently', async () => {
    await sendEventOnce('trial_start');
    await sendEventOnce('license_activated');
    expect(fetchCallCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// PrivacySettings telemetry toggle — UI gate
// ---------------------------------------------------------------------------

describe('PrivacySettings telemetry toggle', () => {
  beforeEach(() => {
    mockLocalStorage();
    render(<PrivacySettings />);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the telemetry toggle', () => {
    expect(screen.getByTestId('privacy-telemetry-toggle')).toBeInTheDocument();
  });

  it('toggle shows "Disabled" when consent is unset', () => {
    const toggle = screen.getByTestId('privacy-telemetry-toggle');
    expect(toggle).toHaveTextContent('Disabled');
  });

  it('clicking toggle enables telemetry', () => {
    const toggle = screen.getByTestId('privacy-telemetry-toggle');
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent('Enabled');
  });

  it('clicking again disables telemetry', () => {
    const toggle = screen.getByTestId('privacy-telemetry-toggle');
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent('Disabled');
  });
});

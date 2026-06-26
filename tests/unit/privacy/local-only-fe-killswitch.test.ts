/**
 * Phase A — Local-only FE kill-switch: external boundaries.
 *
 * In Local-only mode ("nothing leaves this device"), these external calls must
 * NOT be issued. Each test mocks the boundary (fetch / Tauri invoke) and asserts
 * it is never called when Local-only is on, and IS called when it is off.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import {
  assertLocalOnlyAllowsExternal,
  LocalOnlyExternalError,
} from '@/platform/privacy/localOnlyGuard';

// Consent is required for telemetry/diagnostics to even consider sending; force
// it ON so the ONLY thing that can stop the send is the Local-only guard.
vi.mock('@/platform/hooks/useTelemetryConsent', () => ({
  getTelemetryConsent: () => 'enabled',
}));
vi.mock('@/platform/hooks/useDesignPartnerConsent', () => ({
  getDesignPartnerConsent: () => 'enabled',
}));

import { sendEvent } from '@/platform/utils/telemetry';
import { sendDiagnosticEvent } from '@/platform/utils/diagnostics';

function setMode(mode: string) {
  useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, mode);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useSettingsStore.setState({ values: {} });
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assertLocalOnlyAllowsExternal', () => {
  it('throws LocalOnlyExternalError when Local-only is on', () => {
    setMode('local-only');
    expect(() => assertLocalOnlyAllowsExternal('thing')).toThrow(LocalOnlyExternalError);
    expect(() => assertLocalOnlyAllowsExternal('thing')).toThrow(/local-only/i);
  });

  it('does NOT throw when not in Local-only', () => {
    setMode('direct');
    expect(() => assertLocalOnlyAllowsExternal('thing')).not.toThrow();
    setMode('assured');
    expect(() => assertLocalOnlyAllowsExternal('thing')).not.toThrow();
  });
});

describe('telemetry.sendEvent', () => {
  it('does NOT POST when Local-only is on', async () => {
    setMode('local-only');
    await sendEvent('app_launch');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('DOES POST when not in Local-only (consent enabled)', async () => {
    setMode('direct');
    await sendEvent('app_launch');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('diagnostics.sendDiagnosticEvent', () => {
  it('does NOT POST when Local-only is on', async () => {
    setMode('local-only');
    await sendDiagnosticEvent({ event: 'matter_count', count: 3 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('DOES POST when not in Local-only (consent enabled)', async () => {
    setMode('direct');
    await sendDiagnosticEvent({ event: 'matter_count', count: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

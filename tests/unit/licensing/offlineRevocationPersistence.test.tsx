import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

import { useLicense } from '@/platform/hooks/useLicense';
import { useEntitlement } from '@/platform/hooks/useEntitlement';
import {
  SK_LICENSE_LAST_GOOD_AT,
  SK_LICENSE_REVOCATION,
  SK_LICENSE_TOKEN,
} from '@/config/identity';

function licenseToken(): string {
  const payload = btoa(
    JSON.stringify({
      tier: 'personal',
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
      status: 'active',
      type: 'subscription',
    }),
  ).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${payload}.signature`;
}

describe('persisted license revocation in Offline Mode', () => {
  let offlineMode = false;
  let token: string;

  beforeEach(() => {
    localStorage.clear();
    token = licenseToken();
    localStorage.setItem(SK_LICENSE_TOKEN, token);
    localStorage.setItem(SK_LICENSE_LAST_GOOD_AT, new Date().toISOString());
    isTauriMock.mockReturnValue(true);
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'network_policy_status') {
        return { offlineMode, generation: offlineMode ? 2 : 1 };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('keeps a server-revoked token degraded after restart while Offline Mode is on', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ valid: false, reason: 'revoked' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    // Drive the public refresh path that receives and records a real server
    // revocation verdict; do not shortcut this by calling decideEntitlement.
    const firstRun = renderHook(() => useLicense());
    await act(async () => {
      await expect(firstRun.result.current.refresh()).resolves.toEqual({
        valid: false,
        reason: 'revoked',
      });
    });
    expect(firstRun.result.current.status).toBe('revoked');
    expect(localStorage.getItem(SK_LICENSE_REVOCATION)).toContain('revoked');
    firstRun.unmount();

    // A fresh hook is the renderer-side equivalent of restarting the app.
    // The native policy now blocks validation, so any restored entitlement must
    // come from durable state rather than a fresh server request.
    offlineMode = true;
    const restarted = renderHook(() => useEntitlement());
    await waitFor(() => {
      expect(restarted.result.current.reason).toBe('subscription-revoked');
    });
    expect(restarted.result.current.state).toBe('subscription-lapsed');
    expect(restarted.result.current.aiEnabled).toBe(false);
    expect(restarted.result.current.updatesEnabled).toBe(false);
    // The ownership promise remains true even for a revoked paid license.
    expect(restarted.result.current.dataAccessAlwaysTrue).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });
});

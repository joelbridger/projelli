/**
 * FirmAdminConsole.sso.test.tsx
 *
 * Tests for the "Single sign-on (SSO)" card added to FirmAdminConsole in Task 11.
 *
 * Asserted:
 *   - On mount, ssoConfigGet() is called.
 *   - The redirect URI returned by ssoConfigGet is displayed (and copyable).
 *   - Filling issuer / client_id / client_secret then clicking "Save SSO" calls
 *     ssoConfigSet() with those exact values.
 *   - The client_secret field is NEVER pre-populated from has_secret; when
 *     has_secret is true, a hint is shown instead.
 *   - When configured is false, the "Remove SSO" button is absent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── Mock keychain (firm store imports @tauri-apps/api/core for keychain ops) ──
const keychainStore = new Map<string, string>();
const invokeMock = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
  const svc = (args.service as string) ?? 'com.keepance.app';
  const key = args.key as string;
  const id = `${svc}::${key}`;
  if (cmd === 'keychain_set') { keychainStore.set(id, args.value as string); return undefined; }
  if (cmd === 'keychain_get') {
    if (!keychainStore.has(id)) throw { kind: 'notFound', message: 'no entry' };
    return keychainStore.get(id);
  }
  if (cmd === 'keychain_delete') { keychainStore.delete(id); return undefined; }
  throw new Error(`unexpected invoke: ${cmd}`);
});
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...(a as [string, Record<string, unknown>])),
  isTauri: () => true,
}));

// ── Mock the HTTP fetch the FirmApiClient uses ─────────────────────────────────
const fetchMock = vi.fn();
vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: async () => fetchMock as unknown as typeof fetch,
}));

// ── Import AFTER mocks ─────────────────────────────────────────────────────────
import { useFirmStore } from '@/stores/firmStore';
import { FirmAdminConsole } from '@/features/firm/FirmAdminConsole';

// ── SSO mock helpers ───────────────────────────────────────────────────────────

const REDIRECT_URI = 'https://api.keepance.com/auth/sso/callback';

function ssoGetUnconfigured(): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ configured: false, redirect_uri: REDIRECT_URI }),
  } as unknown as Response;
}

function ssoGetConfigured(): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      configured: true,
      provider: 'entra',
      issuer: 'https://login.microsoftonline.com/tenant-123/v2.0',
      client_id: 'client-abc',
      enabled: true,
      has_secret: true,
      redirect_uri: REDIRECT_URI,
    }),
  } as unknown as Response;
}

function ssoSetOk(): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, redirect_uri: REDIRECT_URI }),
  } as unknown as Response;
}

function ssoDeleteOk(): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true }),
  } as unknown as Response;
}

// listMatters, listSeats, listProviderKeys, listOrgUsers return empty arrays
function emptyListResponse(): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ matters: [], seats: [], keys: [], users: [] }),
  } as unknown as Response;
}

function resetAll() {
  keychainStore.clear();
  fetchMock.mockReset();
  // Reset the firm store to a signed-in admin state
  useFirmStore.setState({
    session: {
      user_id: 'u-admin',
      email: 'admin@firm.com',
      role: 'admin',
      status: 'active',
      activated: false,
      org: { org_id: 'org-1', name: 'Firm LLP', plan: 'practice', packs: ['legal'], seat_limit: 10 },
    },
    accessToken: 'access-token-admin',
    seatPublicKeyPem: null,
    seatToken: null,
    offlineSeatValid: false,
    serverVerdict: null,
    assuredProviders: [],
    error: null,
    signingIn: false,
  } as Parameters<typeof useFirmStore.setState>[0]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FirmAdminConsole SSO section', () => {
  beforeEach(() => {
    resetAll();
  });

  it('calls ssoConfigGet on mount', async () => {
    // First burst of fetch calls: matters, seats, keys, users (each empty), then ssoConfigGet
    fetchMock.mockResolvedValue(emptyListResponse());
    // override the ssoConfigGet call specifically (it will be called after the initial 4)
    let ssoGetCallCount = 0;
    fetchMock.mockImplementation((url: string) => {
      if ((url as string).includes('/org/sso/config/get')) {
        ssoGetCallCount++;
        return Promise.resolve(ssoGetUnconfigured());
      }
      return Promise.resolve(emptyListResponse());
    });

    await act(async () => { render(<FirmAdminConsole />); });
    await waitFor(() => expect(ssoGetCallCount).toBeGreaterThan(0));
  });

  it('displays the redirect URI from ssoConfigGet', async () => {
    fetchMock.mockImplementation((url: string) => {
      if ((url as string).includes('/org/sso/config/get')) return Promise.resolve(ssoGetUnconfigured());
      return Promise.resolve(emptyListResponse());
    });

    await act(async () => { render(<FirmAdminConsole />); });
    await waitFor(() => expect(screen.getByDisplayValue(REDIRECT_URI)).toBeInTheDocument());
  });

  it('calls ssoConfigSet with issuer, client_id, and client_secret when Save SSO is clicked', async () => {
    let setSsoBody: unknown = null;
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if ((url as string).includes('/org/sso/config/set')) {
        setSsoBody = JSON.parse(init.body as string);
        return Promise.resolve(ssoSetOk());
      }
      if ((url as string).includes('/org/sso/config/get')) return Promise.resolve(ssoGetUnconfigured());
      return Promise.resolve(emptyListResponse());
    });

    await act(async () => { render(<FirmAdminConsole />); });
    await waitFor(() => expect(screen.getByLabelText(/issuer/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/issuer/i), {
      target: { value: 'https://login.microsoftonline.com/t/v2.0' },
    });
    fireEvent.change(screen.getByLabelText(/client id/i), {
      target: { value: 'client-abc' },
    });
    fireEvent.change(screen.getByLabelText(/client secret/i), {
      target: { value: 'shh' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save sso/i }));

    await waitFor(() => expect(setSsoBody).not.toBeNull());
    expect(setSsoBody).toMatchObject({
      issuer: 'https://login.microsoftonline.com/t/v2.0',
      client_id: 'client-abc',
      client_secret: 'shh',
    });
  });

  it('never pre-populates the client secret field even when has_secret is true', async () => {
    fetchMock.mockImplementation((url: string) => {
      if ((url as string).includes('/org/sso/config/get')) return Promise.resolve(ssoGetConfigured());
      return Promise.resolve(emptyListResponse());
    });

    await act(async () => { render(<FirmAdminConsole />); });
    await waitFor(() => expect(screen.getByLabelText(/client secret/i)).toBeInTheDocument());

    const secretInput = screen.getByLabelText(/client secret/i) as HTMLInputElement;
    expect(secretInput.value).toBe('');
    // And the hint should be visible
    expect(screen.getByText(/secret saved/i)).toBeInTheDocument();
  });

  it('shows Remove SSO button only when SSO is configured', async () => {
    // Unconfigured: no Remove SSO button
    fetchMock.mockImplementation((url: string) => {
      if ((url as string).includes('/org/sso/config/get')) return Promise.resolve(ssoGetUnconfigured());
      return Promise.resolve(emptyListResponse());
    });

    const { unmount } = await act(async () => render(<FirmAdminConsole />));
    await waitFor(() => expect(screen.getByRole('button', { name: /save sso/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /remove sso/i })).toBeNull();
    unmount();

    // Configured: Remove SSO button appears
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if ((url as string).includes('/org/sso/config/get')) return Promise.resolve(ssoGetConfigured());
      return Promise.resolve(emptyListResponse());
    });

    await act(async () => { render(<FirmAdminConsole />); });
    await waitFor(() => expect(screen.getByRole('button', { name: /remove sso/i })).toBeInTheDocument());
  });

  it('calls ssoConfigDelete when Remove SSO is clicked', async () => {
    let deleteCalled = false;
    fetchMock.mockImplementation((url: string) => {
      if ((url as string).includes('/org/sso/config/delete')) {
        deleteCalled = true;
        return Promise.resolve(ssoDeleteOk());
      }
      if ((url as string).includes('/org/sso/config/get')) return Promise.resolve(ssoGetConfigured());
      return Promise.resolve(emptyListResponse());
    });

    await act(async () => { render(<FirmAdminConsole />); });
    await waitFor(() => expect(screen.getByRole('button', { name: /remove sso/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /remove sso/i }));
    await waitFor(() => expect(deleteCalled).toBe(true));
  });

  it('omits client_secret from payload when secret field is not touched (keep-existing path)', async () => {
    // SSO is already configured with a secret.
    let setSsoBody: unknown = null;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if ((url as string).includes('/org/sso/config/set')) {
        setSsoBody = JSON.parse((init as RequestInit).body as string);
        return Promise.resolve(ssoSetOk());
      }
      if ((url as string).includes('/org/sso/config/get')) return Promise.resolve(ssoGetConfigured());
      return Promise.resolve(emptyListResponse());
    });

    await act(async () => { render(<FirmAdminConsole />); });
    // Wait for the form to be populated from ssoConfigGet.
    await waitFor(() => expect(screen.getByLabelText(/issuer/i)).toBeInTheDocument());
    await waitFor(() =>
      expect((screen.getByLabelText(/issuer/i) as HTMLInputElement).value).toContain('microsoftonline'),
    );

    // Admin edits ONLY the issuer; leaves secret blank (not touched).
    fireEvent.change(screen.getByLabelText(/issuer/i), {
      target: { value: 'https://login.microsoftonline.com/new-tenant/v2.0' },
    });
    // Do NOT touch the client secret field.

    fireEvent.click(screen.getByRole('button', { name: /save sso/i }));

    await waitFor(() => expect(setSsoBody).not.toBeNull());

    // client_secret must be absent (undefined → not serialized) or explicitly undefined.
    expect((setSsoBody as Record<string, unknown>)['client_secret']).toBeUndefined();
    expect((setSsoBody as Record<string, unknown>)['issuer']).toBe(
      'https://login.microsoftonline.com/new-tenant/v2.0',
    );
  });
});

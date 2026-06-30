/**
 * orgClaim.test.tsx — purchase-to-provision claim flow tests.
 *
 * Asserted:
 *   - happy path: orgClaim() calls the right endpoint, tokens are stored in the
 *     OS keychain (firmKeychain), the store session is populated as admin, and
 *     claimedLicenseKey is returned for pre-filling the activation form.
 *   - 409 already_claimed: claimOrg() returns ok=false with an error; the store
 *     is not mutated (no session established).
 *   - 404 license_key_not_found: same — ok=false, descriptive error.
 *   - validation (password mismatch): the FirmSignIn UI shows the mismatch
 *     error BEFORE calling claimOrg (the API is never hit).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

// ── Mock OS keychain ──────────────────────────────────────────────────────────
const keychainStore = new Map<string, string>();
const invokeMock = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
  const svc = (args.service as string) ?? 'com.lantern.app';
  const key = args.key as string;
  const id = `${svc}::${key}`;
  if (cmd === 'keychain_set') {
    keychainStore.set(id, args.value as string);
    return undefined;
  }
  if (cmd === 'keychain_get') {
    if (!keychainStore.has(id)) throw { kind: 'notFound', message: 'no entry' };
    return keychainStore.get(id);
  }
  if (cmd === 'keychain_delete') {
    keychainStore.delete(id);
    return undefined;
  }
  throw new Error(`unexpected invoke ${cmd}`);
});
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...(a as [string, Record<string, unknown>])),
  isTauri: () => true,
}));

// ── Mock the HTTP fetch the FirmApiClient uses ────────────────────────────────
const fetchMock = vi.fn();
vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: async () => fetchMock as unknown as typeof fetch,
}));

// ── Import AFTER mocks (store has side effects on import) ─────────────────────
import { useFirmStore } from '@/platform/firm/firmStore';
import { FirmSignIn } from '@/features/firm/FirmSignIn';

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A minimal OrgClaimResponse. */
function claimOk(licenseKey: string) {
  return jsonResponse(200, {
    access_token: 'access-tok-claim',
    access_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    refresh_token: 'refresh-tok-claim',
    refresh_expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
    org: {
      org_id: 'org-claim-1',
      name: 'Test Firm',
      plan: 'practice',
      packs: ['legal'],
      seat_limit: 5,
    },
    user: {
      user_id: 'user-claim-1',
      email: 'admin@testfirm.com',
      role: 'admin',
      status: 'active',
      created_at: new Date().toISOString(),
    },
  });
}

function claimError(status: number, error: string, detail?: string) {
  return jsonResponse(status, { error, detail: detail ?? error });
}

// Reset store and mocks between tests.
function resetAll() {
  keychainStore.clear();
  fetchMock.mockReset();
  useFirmStore.setState({
    session: null,
    accessToken: null,
    seatToken: null,
    seatPublicKeyPem: null,
    serverVerdict: 'unknown',
    offlineSeatValid: false,
    isOffline: false,
    isLoading: false,
    error: null,
    assuredProviders: [],
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('claimOrg store action', () => {
  beforeEach(resetAll);

  it('happy path: tokens stored in keychain, session populated as admin', async () => {
    const LICENSE = 'KEEP-TEST-CLAIM-HAPPY-1';

    // /org/claim succeeds; /.well-known/seat-pubkey fails (non-fatal).
    fetchMock
      .mockResolvedValueOnce(claimOk(LICENSE))
      .mockRejectedValueOnce(new Error('offline')); // getSeatPublicKey

    const { claimOrg } = useFirmStore.getState();
    const result = await claimOrg(LICENSE, 'admin@testfirm.com', 'hunter2hunter2', 'Test Firm LLC');

    expect(result.ok).toBe(true);
    expect(result.claimedLicenseKey).toBe(LICENSE);

    // Session populated.
    const state = useFirmStore.getState();
    expect(state.session).toBeTruthy();
    expect(state.session?.userId).toBe('user-claim-1');
    expect(state.session?.email).toBe('admin@testfirm.com');
    expect(state.session?.role).toBe('admin');
    expect(state.session?.org?.name).toBe('Test Firm');
    expect(state.session?.activated).toBe(false);
    expect(state.accessToken).toBe('access-tok-claim');

    // Access token + refresh token stored individually in the OS keychain (NOT in plain state).
    // firmKeychain stores each token as a separate key:
    //   service = com.lantern.user.<userId>, key = access_token / refresh_token
    const accessKey = `com.lantern.user.user-claim-1::access_token`;
    const refreshKey = `com.lantern.user.user-claim-1::refresh_token`;
    expect(keychainStore.get(accessKey)).toBe('access-tok-claim');
    expect(keychainStore.get(refreshKey)).toBe('refresh-tok-claim');

    // The POST hit /org/claim with the right body.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/org/claim');
    const body = JSON.parse(init.body as string);
    expect(body.license_key).toBe(LICENSE);
    expect(body.email).toBe('admin@testfirm.com');
    expect(body.password).toBe('hunter2hunter2');
    expect(body.org_name).toBe('Test Firm LLC');

    // No Authorization header: claim is a public endpoint.
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('409 already_claimed: returns ok=false, session NOT populated', async () => {
    fetchMock.mockResolvedValueOnce(
      claimError(409, 'already_claimed', 'org is already active'),
    );

    const { claimOrg } = useFirmStore.getState();
    const result = await claimOrg('KEEP-ALREADY', 'a@b.com', 'password1234567');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('already');
    expect(useFirmStore.getState().session).toBeNull();
    expect(useFirmStore.getState().accessToken).toBeNull();
    expect(keychainStore.size).toBe(0);
  });

  it('404 license_key_not_found: returns ok=false, session NOT populated', async () => {
    fetchMock.mockResolvedValueOnce(
      claimError(404, 'license_key_not_found'),
    );

    const { claimOrg } = useFirmStore.getState();
    const result = await claimOrg('KEEP-UNKNOWN', 'a@b.com', 'password1234567');

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(useFirmStore.getState().session).toBeNull();
  });
});

describe('FirmSignIn — claim panel validation', () => {
  beforeEach(resetAll);

  it('password mismatch shows error without calling the API', async () => {
    // Navigate to the claim panel.
    render(<FirmSignIn />);

    const justBoughtBtn = screen.getByTestId('firm-just-bought');
    await act(async () => { fireEvent.click(justBoughtBtn); });

    // Fill in the form with mismatched passwords.
    fireEvent.change(screen.getByTestId('firm-claim-license-key'), { target: { value: 'KEEP-MISMATCH' } });
    fireEvent.change(screen.getByTestId('firm-claim-email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByTestId('firm-claim-password'), { target: { value: 'correcthorse123' } });
    fireEvent.change(screen.getByTestId('firm-claim-confirm-password'), { target: { value: 'wronghorse123' } });

    await act(async () => {
      fireEvent.submit(screen.getByTestId('firm-claim-form'));
    });

    // Error shown, API never called.
    await waitFor(() => {
      expect(screen.getByTestId('firm-claim-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('firm-claim-error').textContent).toContain('Passwords do not match');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('happy path: after claim the user is signed in and the activation form is shown', async () => {
    const LICENSE = 'KEEP-UI-HAPPY';
    fetchMock
      .mockResolvedValueOnce(claimOk(LICENSE))
      .mockRejectedValueOnce(new Error('offline')); // getSeatPublicKey (non-fatal)

    render(<FirmSignIn />);

    const justBoughtBtn = screen.getByTestId('firm-just-bought');
    await act(async () => { fireEvent.click(justBoughtBtn); });

    fireEvent.change(screen.getByTestId('firm-claim-license-key'), { target: { value: LICENSE } });
    fireEvent.change(screen.getByTestId('firm-claim-email'), { target: { value: 'admin@testfirm.com' } });
    fireEvent.change(screen.getByTestId('firm-claim-password'), { target: { value: 'hunter2hunter2' } });
    fireEvent.change(screen.getByTestId('firm-claim-confirm-password'), { target: { value: 'hunter2hunter2' } });

    await act(async () => {
      fireEvent.submit(screen.getByTestId('firm-claim-form'));
    });

    // After a successful claim the store is signed in as admin.
    const state = useFirmStore.getState();
    expect(state.session?.email).toBe('admin@testfirm.com');
    expect(state.session?.role).toBe('admin');
    expect(state.session?.activated).toBe(false);

    // The UI flips to signed-in mode; the activation form is present because
    // hasActiveSeat is false. The license key is pre-filled (claimedLicenseKey).
    await waitFor(() => {
      // Signed-in state: email display is visible.
      expect(screen.getByTestId('firm-email-display')).toBeInTheDocument();
    });
    // Activation form pre-filled with the license key.
    const licenseInput = screen.getByTestId('firm-license-key') as HTMLInputElement;
    expect(licenseInput.value).toBe(LICENSE);
  });

  it('409 branch: shows already-claimed error message in the UI', async () => {
    fetchMock.mockResolvedValueOnce(claimError(409, 'already_claimed', 'org is already active'));

    render(<FirmSignIn />);
    await act(async () => { fireEvent.click(screen.getByTestId('firm-just-bought')); });

    fireEvent.change(screen.getByTestId('firm-claim-license-key'), { target: { value: 'KEEP-CLAIMED' } });
    fireEvent.change(screen.getByTestId('firm-claim-email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByTestId('firm-claim-password'), { target: { value: 'password1234567' } });
    fireEvent.change(screen.getByTestId('firm-claim-confirm-password'), { target: { value: 'password1234567' } });

    await act(async () => {
      fireEvent.submit(screen.getByTestId('firm-claim-form'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('firm-claim-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('firm-claim-error').textContent).toContain('already been claimed');
  });

  it('404 branch: shows license-key-not-found message in the UI', async () => {
    fetchMock.mockResolvedValueOnce(claimError(404, 'license_key_not_found'));

    render(<FirmSignIn />);
    await act(async () => { fireEvent.click(screen.getByTestId('firm-just-bought')); });

    fireEvent.change(screen.getByTestId('firm-claim-license-key'), { target: { value: 'KEEP-UNKNOWN' } });
    fireEvent.change(screen.getByTestId('firm-claim-email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByTestId('firm-claim-password'), { target: { value: 'password1234567' } });
    fireEvent.change(screen.getByTestId('firm-claim-confirm-password'), { target: { value: 'password1234567' } });

    await act(async () => {
      fireEvent.submit(screen.getByTestId('firm-claim-form'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('firm-claim-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('firm-claim-error').textContent).toContain("don't recognize");
  });
});

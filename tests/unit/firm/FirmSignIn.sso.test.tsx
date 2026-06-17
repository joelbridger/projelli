/**
 * FirmSignIn.sso.test.tsx
 *
 * Tests for the "Sign in with SSO" affordance added in Task 10.
 *
 * Asserted:
 *   - When running under Tauri (isTauri() === true) and an email is entered,
 *     clicking "Sign in with SSO" calls signInSso with that email.
 *   - When NOT running under Tauri (isTauri() === false), the SSO button is
 *     not rendered at all.
 *   - The SSO button is disabled when the email field is empty.
 *   - The SSO button is disabled when a sign-in is in flight (isLoading === true).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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
  // SSO command — should not be called in unit tests (we mock signInSso directly)
  throw new Error(`unexpected invoke: ${cmd}`);
});

// isTauri is controlled per-test via the `mockIsTauri` ref below.
let mockIsTauriValue = true;
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...(a as [string, Record<string, unknown>])),
  isTauri: () => mockIsTauriValue,
}));

// ── Mock the HTTP fetch the FirmApiClient uses ─────────────────────────────────
const fetchMock = vi.fn();
vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: async () => fetchMock as unknown as typeof fetch,
}));

// ── Import AFTER mocks ─────────────────────────────────────────────────────────
import { useFirmStore } from '@/stores/firmStore';
import { FirmSignIn } from '@/features/firm/FirmSignIn';

// ── Helpers ────────────────────────────────────────────────────────────────────

function resetAll() {
  keychainStore.clear();
  fetchMock.mockReset();
  mockIsTauriValue = true;
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('FirmSignIn — SSO affordance', () => {
  beforeEach(resetAll);

  it('calls signInSso with the entered email when clicking Sign in with SSO', async () => {
    // Spy on the store's signInSso action (resolves immediately — no real Tauri).
    const signInSsoSpy = vi.fn().mockResolvedValue(undefined);
    useFirmStore.setState({ signInSso: signInSsoSpy } as any);

    render(<FirmSignIn />);

    // Type an email address into the email field.
    const emailInput = screen.getByTestId('firm-email');
    fireEvent.change(emailInput, { target: { value: 'jane@weston-llp.com' } });

    // The SSO button should now be visible and enabled (isTauri = true, email filled).
    const ssoButton = screen.getByRole('button', { name: /sign in with sso/i });
    expect(ssoButton).toBeInTheDocument();
    expect(ssoButton).not.toBeDisabled();

    // Click it.
    await act(async () => {
      fireEvent.click(ssoButton);
    });

    expect(signInSsoSpy).toHaveBeenCalledOnce();
    expect(signInSsoSpy).toHaveBeenCalledWith('jane@weston-llp.com');
  });

  it('does NOT render the SSO button when isTauri() returns false (browser mode)', () => {
    mockIsTauriValue = false;

    render(<FirmSignIn />);

    // The SSO button must be absent entirely in browser mode.
    expect(screen.queryByRole('button', { name: /sign in with sso/i })).toBeNull();
  });

  it('the SSO button is disabled when the email field is empty', () => {
    render(<FirmSignIn />);

    // No email entered.
    const ssoButton = screen.getByRole('button', { name: /sign in with sso/i });
    expect(ssoButton).toBeDisabled();
  });

  it('the SSO button is disabled when isLoading is true', () => {
    // Simulate a sign-in already in flight.
    useFirmStore.setState({ isLoading: true });

    render(<FirmSignIn />);

    const emailInput = screen.getByTestId('firm-email');
    fireEvent.change(emailInput, { target: { value: 'jane@weston.com' } });

    const ssoButton = screen.getByRole('button', { name: /sign in with sso/i });
    expect(ssoButton).toBeDisabled();
  });
});

/**
 * Fix 1 (dress-rehearsal finding #1): the "✓ Working" state shown by the
 * "Manage AI Account Keys" dialog must survive closing and reopening the
 * dialog (with NO app restart) — it was previously reset to "Unverified"
 * every time the dialog remounted, because the row's status lived only in
 * this component's own useState, never read from the persistent
 * markKeyVerified/markKeyInvalid record in keyVerification.ts. A dead key
 * must still flip back to "Invalid" the next time it actually fails a live
 * "Check" (that wiring already exists and is untouched here).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { createKeychainService } from '@/platform/providers/KeychainService';
import { markKeyVerified, markKeyInvalid } from '@/platform/providers/keyVerification';
import { ApiKeyManager } from '@/features/settings/ApiKeyManager';

const VALID_ANTHROPIC_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';
const VALID_OPENAI_KEY = 'sk-abcdefghijklmnopqrstuvwx';

describe('ApiKeyManager — persisted verify status survives a dialog reopen (Fix 1)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('shows "Working" on open for a provider already marked verified, with no Check click', async () => {
    const keychain = createKeychainService('localStorage');
    await keychain.setKey('anthropic', VALID_ANTHROPIC_KEY);
    markKeyVerified('anthropic');

    render(
      <ApiKeyManager open onOpenChange={vi.fn()} keychainService={keychain} onAddKey={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('api-key-manager-status-working')).toBeInTheDocument(),
    );
    // An honest "when" label, not just a bare badge (finding #1's ask).
    expect(screen.getByText(/checked/i)).toBeInTheDocument();
  });

  it('shows "Invalid" on open for a provider already marked invalid, with no Check click', async () => {
    const keychain = createKeychainService('localStorage');
    await keychain.setKey('openai', VALID_OPENAI_KEY);
    markKeyInvalid('openai');

    render(
      <ApiKeyManager open onOpenChange={vi.fn()} keychainService={keychain} onAddKey={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('api-key-manager-status-invalid')).toBeInTheDocument(),
    );
  });

  it('shows "Unverified" for a saved key with no prior check', async () => {
    const keychain = createKeychainService('localStorage');
    await keychain.setKey('anthropic', VALID_ANTHROPIC_KEY);

    render(
      <ApiKeyManager open onOpenChange={vi.fn()} keychainService={keychain} onAddKey={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('api-key-manager-status-unverified')).toBeInTheDocument(),
    );
  });

  it('reproduces finding #1: closing and reopening the dialog (no restart) keeps the verified state, instead of resetting to Unverified', async () => {
    const keychain = createKeychainService('localStorage');
    await keychain.setKey('anthropic', VALID_ANTHROPIC_KEY);
    markKeyVerified('anthropic');

    const { rerender } = render(
      <ApiKeyManager open onOpenChange={vi.fn()} keychainService={keychain} onAddKey={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('api-key-manager-status-working')).toBeInTheDocument(),
    );

    // Close the dialog...
    rerender(
      <ApiKeyManager open={false} onOpenChange={vi.fn()} keychainService={keychain} onAddKey={vi.fn()} />,
    );
    // ...then reopen it ~2 minutes later (simulated — no app restart, no new
    // markKeyVerified call). The persisted marker in keyVerification.ts is the
    // only thing that could still say "verified" at this point.
    rerender(
      <ApiKeyManager open onOpenChange={vi.fn()} keychainService={keychain} onAddKey={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('api-key-manager-status-working')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('api-key-manager-status-unverified')).not.toBeInTheDocument();
  });
});

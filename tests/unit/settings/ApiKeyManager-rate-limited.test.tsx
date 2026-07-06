/**
 * Fix 2 (connect-flow demo hardening): a 429 from the provider means the key
 * is real (it authenticated) but the account is over its usage limit right
 * now — apiKeyValidation.ts now returns a distinct 'rate_limited' outcome
 * instead of folding it into 'ok'. This locks in how ApiKeyManager's "Check"
 * button surfaces that: a warning row, not "Working" and not "Invalid", and
 * it must NOT call markKeyInvalid (a rate-limited key is not a bad key).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/platform/providers/apiKeyValidation', async () => {
  const actual = await vi.importActual<typeof import('@/platform/providers/apiKeyValidation')>(
    '@/platform/providers/apiKeyValidation',
  );
  return {
    ...actual,
    validateApiKeyLive: vi.fn(),
  };
});
import { validateApiKeyLive } from '@/platform/providers/apiKeyValidation';
import * as keyVerification from '@/platform/providers/keyVerification';
import { ApiKeyManager } from '@/features/settings/ApiKeyManager';
import type { ApiKeyManagerKeychain } from '@/features/settings/ApiKeyManager';
import type { StoredKey } from '@/platform/providers/KeychainService';

const validateApiKeyLiveMock = vi.mocked(validateApiKeyLive);

function keychainWithAnthropicKey(): ApiKeyManagerKeychain {
  const stored: StoredKey[] = [
    { provider: 'anthropic', keyPrefix: 'sk-ant-', addedAt: new Date() },
  ];
  return {
    getStoredKeys: () => stored,
    getMaskedKey: () => Promise.resolve('sk-ant-...'),
    getKey: () => Promise.resolve('sk-ant-api03-abcdefghijklmnopqrstuvwx'),
    deleteKey: () => Promise.resolve(),
  };
}

describe('ApiKeyManager — 429 shows a distinct rate-limited warning (Fix 2)', () => {
  beforeEach(() => {
    validateApiKeyLiveMock.mockReset();
    vi.spyOn(keyVerification, 'markKeyInvalid');
    vi.spyOn(keyVerification, 'markKeyVerified');
  });

  it('shows "Rate limited" (not Working, not Invalid) and does not mark the key invalid or verified', async () => {
    validateApiKeyLiveMock.mockResolvedValue({
      outcome: 'rate_limited',
      message: 'This key is real, but the account is over its limit right now. Wait a bit and try again.',
    });

    render(
      <ApiKeyManager
        open
        onOpenChange={vi.fn()}
        keychainService={keychainWithAnthropicKey()}
        onAddKey={vi.fn()}
      />,
    );

    await screen.findByTestId('api-key-manager-row-anthropic');
    fireEvent.click(screen.getByTestId('api-key-manager-check-anthropic'));

    await waitFor(() =>
      expect(screen.getByTestId('api-key-manager-status-rate_limited')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('api-key-manager-status-working')).not.toBeInTheDocument();
    expect(screen.queryByTestId('api-key-manager-status-invalid')).not.toBeInTheDocument();
    expect(screen.getByText(/over its limit/i)).toBeInTheDocument();

    expect(keyVerification.markKeyInvalid).not.toHaveBeenCalled();
    expect(keyVerification.markKeyVerified).not.toHaveBeenCalled();
  });
});

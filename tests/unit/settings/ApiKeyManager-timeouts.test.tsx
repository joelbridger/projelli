/**
 * ApiKeyManager — timeout / hang-recovery behavior.
 *
 * Both `loadRows()` (reads from the keychain) and `handleCheck()` (a live
 * network call to the provider) used to have no deadline: a hung keychain
 * read left the dialog on "Loading..." forever, and a provider that never
 * answers left a row stuck on "Checking" forever, both with no error and no
 * way to recover. These tests pin down that a hang now surfaces a clear
 * error and a way to retry, instead of spinning forever.
 *
 * NB: fake timers + @testing-library `waitFor` don't mix (waitFor polls on
 * real timers and deadlocks), so — matching the existing convention in
 * MailConnect.test.tsx's stall-watchdog suite — these flush with
 * `act(async () => { await vi.advanceTimersByTimeAsync(ms); })` and assert
 * synchronously afterward instead of using `waitFor`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import type { ApiKeyManagerKeychain } from '@/features/settings/ApiKeyManager';
import { ApiKeyManager } from '@/features/settings/ApiKeyManager';
import type { StoredKey } from '@/platform/providers/KeychainService';

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

const validateApiKeyLiveMock = vi.mocked(validateApiKeyLive);

function hangingKeychain(overrides: Partial<ApiKeyManagerKeychain> = {}): ApiKeyManagerKeychain {
  const stored: StoredKey[] = [
    { provider: 'anthropic', keyPrefix: 'sk-ant-', addedAt: new Date() },
  ];
  return {
    getStoredKeys: () => stored,
    getMaskedKey: () => new Promise<string | null>(() => {}), // never resolves
    getKey: () => Promise.resolve('sk-ant-api03-abcdefghijklmnopqrstuvwx'),
    deleteKey: () => Promise.resolve(),
    ...overrides,
  };
}

describe('ApiKeyManager — loadRows timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows an error with a Retry button instead of hanging on "Loading..." forever', async () => {
    render(
      <ApiKeyManager
        open
        onOpenChange={vi.fn()}
        keychainService={hangingKeychain()}
        onAddKey={vi.fn()}
      />,
    );

    // Flush the deferred mount-time loadRows() microtask.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(screen.getByTestId('api-key-manager-load-error')).toBeInTheDocument();
    expect(screen.getByTestId('api-key-manager-load-retry')).toBeInTheDocument();
  });

  it('Retry re-attempts the load and recovers once the keychain answers', async () => {
    let attempt = 0;
    const keychain = hangingKeychain({
      getMaskedKey: () => {
        attempt += 1;
        if (attempt === 1) return new Promise<string | null>(() => {});
        return Promise.resolve('sk-ant-...');
      },
    });

    render(
      <ApiKeyManager open onOpenChange={vi.fn()} keychainService={keychain} onAddKey={vi.fn()} />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.getByTestId('api-key-manager-load-error')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('api-key-manager-load-retry'));
      await Promise.resolve();
    });

    expect(screen.getByTestId('api-key-manager-row-anthropic')).toBeInTheDocument();
  });
});

describe('ApiKeyManager — handleCheck timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    validateApiKeyLiveMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recovers from a Check that never responds, with a clear inline error', async () => {
    validateApiKeyLiveMock.mockImplementation(() => new Promise(() => {})); // never resolves
    const keychain = hangingKeychain({ getMaskedKey: () => Promise.resolve('sk-ant-...') });

    render(
      <ApiKeyManager open onOpenChange={vi.fn()} keychainService={keychain} onAddKey={vi.fn()} />,
    );

    // Flush mount-time loadRows().
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('api-key-manager-row-anthropic')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('api-key-manager-check-anthropic'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('api-key-manager-check-anthropic')).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });

    expect(screen.getByTestId('api-key-manager-check-error-anthropic')).toBeInTheDocument();
    // Button is usable again — not stuck disabled on "Checking".
    expect(screen.getByTestId('api-key-manager-check-anthropic')).not.toBeDisabled();
  });
});

/**
 * Fix 1: the ApiKeyWizard verifies the pasted key with the provider before
 * declaring success.
 *
 *   - A key the provider REJECTS (401/403) shows the failure message, keeps the
 *     wizard open, and does NOT call onSaveKey.
 *   - A key the provider ACCEPTS saves (onSaveKey called) and closes the wizard.
 *
 * validateApiKeyLive is mocked so no real network call happens; we assert on the
 * wizard's reaction to each outcome.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockValidateApiKeyLive = vi.fn();

vi.mock('@/platform/providers/apiKeyValidation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/providers/apiKeyValidation')>();
  return {
    ...actual,
    validateApiKeyLive: (...args: unknown[]) => mockValidateApiKeyLive(...args),
  };
});

// openExternal touches Tauri / window.open; stub it so step 1 is inert.
vi.mock('@/platform/utils/openExternal', () => ({ openExternal: vi.fn() }));

import { ApiKeyWizard } from '@/features/onboarding/ApiKeyWizard';

/** Navigate the (anthropic-default) wizard from step 1 to step 3. */
function goToPasteStep() {
  // Stepper: Next (1->2), Next (2->3).
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
}

const VALID_ANTHROPIC_KEY = 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa';

describe('ApiKeyWizard — verify key on save (Fix 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the rejection message and does NOT report success for a rejected key', async () => {
    mockValidateApiKeyLive.mockResolvedValue({
      outcome: 'rejected',
      message: 'The provider rejected this key. Go back to console.anthropic.com and make sure you copied an active key.',
    });
    const onSaveKey = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <ApiKeyWizard open onOpenChange={onOpenChange} onSaveKey={onSaveKey} />,
    );

    goToPasteStep();
    fireEvent.change(screen.getByTestId('api-key-wizard-input'), {
      target: { value: VALID_ANTHROPIC_KEY },
    });
    fireEvent.click(screen.getByTestId('api-key-wizard-submit'));

    // The rejection result surfaces...
    expect(await screen.findByTestId('api-key-wizard-result-rejected')).toBeInTheDocument();
    expect(screen.getByText(/rejected this key/i)).toBeInTheDocument();

    // ...the key is never saved...
    expect(onSaveKey).not.toHaveBeenCalled();
    // ...and the wizard is NOT closed as if it succeeded.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('saves and closes the wizard when the provider accepts the key', async () => {
    mockValidateApiKeyLive.mockResolvedValue({ outcome: 'ok', message: 'This key works.' });
    const onSaveKey = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <ApiKeyWizard open onOpenChange={onOpenChange} onSaveKey={onSaveKey} />,
    );

    goToPasteStep();
    fireEvent.change(screen.getByTestId('api-key-wizard-input'), {
      target: { value: VALID_ANTHROPIC_KEY },
    });
    fireEvent.click(screen.getByTestId('api-key-wizard-submit'));

    await waitFor(() =>
      expect(onSaveKey).toHaveBeenCalledWith('anthropic', VALID_ANTHROPIC_KEY),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('saves anyway (saved-anyway fallback) when the key cannot be verified', async () => {
    mockValidateApiKeyLive.mockResolvedValue({
      outcome: 'network',
      message: "Couldn't reach the provider. Check your internet connection and try again.",
    });
    const onSaveKey = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <ApiKeyWizard open onOpenChange={onOpenChange} onSaveKey={onSaveKey} />,
    );

    goToPasteStep();
    fireEvent.change(screen.getByTestId('api-key-wizard-input'), {
      target: { value: VALID_ANTHROPIC_KEY },
    });
    fireEvent.click(screen.getByTestId('api-key-wizard-submit'));

    // A network/unknown failure still saves and closes (the key may be fine).
    await waitFor(() =>
      expect(onSaveKey).toHaveBeenCalledWith('anthropic', VALID_ANTHROPIC_KEY),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

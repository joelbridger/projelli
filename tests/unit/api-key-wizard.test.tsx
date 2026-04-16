/**
 * Q20 (Wave 1.5) — ApiKeyWizard stepper + submit path.
 *
 * Verifies:
 *   - The three steps render with the expected testids
 *   - Next/Back moves between them
 *   - Provider switcher resets state
 *   - Submit calls the supplied `onSaveKey` with the trimmed key
 *   - Format validation blocks obviously-malformed Anthropic keys
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiKeyWizard } from '@/components/onboarding/ApiKeyWizard';

// Mock openExternal so clicking "Open console" doesn't try to open a real URL
vi.mock('@/utils/openExternal', () => ({
  openExternal: vi.fn(async () => {}),
}));

describe('ApiKeyWizard (Q20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens on step 1 and renders the provider selector', () => {
    render(
      <ApiKeyWizard open={true} onOpenChange={vi.fn()} onSaveKey={vi.fn()} />
    );
    expect(screen.getByTestId('api-key-wizard-step-1')).toBeInTheDocument();
    expect(screen.getByTestId('api-key-wizard-provider-anthropic')).toBeInTheDocument();
    expect(screen.getByTestId('api-key-wizard-provider-openai')).toBeInTheDocument();
    expect(screen.getByTestId('api-key-wizard-provider-google')).toBeInTheDocument();
  });

  it('advances step 1 → 2 → 3 via Next', () => {
    render(
      <ApiKeyWizard open={true} onOpenChange={vi.fn()} onSaveKey={vi.fn()} />
    );
    expect(screen.getByTestId('api-key-wizard-step-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByTestId('api-key-wizard-step-2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByTestId('api-key-wizard-step-3')).toBeInTheDocument();
  });

  it('Back moves 3 → 2 → 1', () => {
    render(
      <ApiKeyWizard open={true} onOpenChange={vi.fn()} onSaveKey={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByTestId('api-key-wizard-step-3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByTestId('api-key-wizard-step-2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByTestId('api-key-wizard-step-1')).toBeInTheDocument();
  });

  it('switching provider resets the step back to 1', () => {
    render(
      <ApiKeyWizard open={true} onOpenChange={vi.fn()} onSaveKey={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByTestId('api-key-wizard-step-3')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('api-key-wizard-provider-openai'));
    expect(screen.getByTestId('api-key-wizard-step-1')).toBeInTheDocument();
  });

  it('submit calls onSaveKey with trimmed key and closes the wizard', async () => {
    const onSaveKey = vi.fn(async () => {});
    const onOpenChange = vi.fn();
    render(
      <ApiKeyWizard open={true} onOpenChange={onOpenChange} onSaveKey={onSaveKey} />
    );
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    const input = screen.getByTestId('api-key-wizard-input');
    fireEvent.change(input, { target: { value: '  sk-ant-api03-real-looking-key-value  ' } });

    const submit = screen.getByTestId('api-key-wizard-submit');
    fireEvent.click(submit);

    await waitFor(() =>
      expect(onSaveKey).toHaveBeenCalledWith('anthropic', 'sk-ant-api03-real-looking-key-value')
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('submit with malformed Anthropic prefix shows an inline error and does NOT save', async () => {
    const onSaveKey = vi.fn();
    render(
      <ApiKeyWizard open={true} onOpenChange={vi.fn()} onSaveKey={onSaveKey} />
    );
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    const input = screen.getByTestId('api-key-wizard-input');
    // Missing the `sk-ant-` prefix; Anthropic should warn.
    fireEvent.change(input, { target: { value: 'definitely-not-an-anthropic-key' } });

    fireEvent.click(screen.getByTestId('api-key-wizard-submit'));

    // The warning surfaces; save is blocked.
    await waitFor(() => expect(screen.getByText(/sk-ant-/i)).toBeInTheDocument());
    expect(onSaveKey).not.toHaveBeenCalled();
  });

  it('Google provider accepts keys without a fixed prefix', async () => {
    const onSaveKey = vi.fn(async () => {});
    render(
      <ApiKeyWizard open={true} onOpenChange={vi.fn()} onSaveKey={onSaveKey} />
    );
    fireEvent.click(screen.getByTestId('api-key-wizard-provider-google'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    const input = screen.getByTestId('api-key-wizard-input');
    fireEvent.change(input, { target: { value: 'AIzaSyA_fake_google_key_value' } });

    fireEvent.click(screen.getByTestId('api-key-wizard-submit'));

    await waitFor(() =>
      expect(onSaveKey).toHaveBeenCalledWith('google', 'AIzaSyA_fake_google_key_value')
    );
  });
});

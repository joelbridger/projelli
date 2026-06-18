/**
 * Fix 2: "Manage AI Account Keys" lists the saved provider keys and can remove
 * them through the KeychainService abstraction.
 *
 *   - A saved provider shows up as a row with its name + masked prefix.
 *   - Clicking Remove deletes the key via the keychain and drops the row.
 *   - With no keys saved, an empty state is shown.
 *   - "Add a provider key" hands off to the wizard (onAddKey).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { createKeychainService } from '@/platform/providers/KeychainService';
import { ApiKeyManager } from '@/features/settings/ApiKeyManager';

const VALID_ANTHROPIC_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';

describe('ApiKeyManager — list + remove saved keys (Fix 2)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('lists a saved provider with its name and a masked prefix', async () => {
    const keychain = createKeychainService('localStorage');
    await keychain.setKey('anthropic', VALID_ANTHROPIC_KEY);

    render(
      <ApiKeyManager
        open
        onOpenChange={vi.fn()}
        keychainService={keychain}
        onAddKey={vi.fn()}
      />,
    );

    const row = await screen.findByTestId('api-key-manager-row-anthropic');
    expect(row).toBeInTheDocument();
    expect(screen.getByText(/anthropic \(claude\)/i)).toBeInTheDocument();
    // Masked prefix from KeychainService.getMaskedKey (sk-ant-...).
    expect(screen.getByText(/^sk-ant-/)).toBeInTheDocument();
    // A provider that is NOT saved must not appear.
    expect(screen.queryByTestId('api-key-manager-row-openai')).not.toBeInTheDocument();
  });

  it('Remove deletes the key via the keychain and drops the row', async () => {
    const keychain = createKeychainService('localStorage');
    await keychain.setKey('anthropic', VALID_ANTHROPIC_KEY);
    // Auto-confirm the "are you sure" prompt.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onKeyRemoved = vi.fn();

    render(
      <ApiKeyManager
        open
        onOpenChange={vi.fn()}
        keychainService={keychain}
        onAddKey={vi.fn()}
        onKeyRemoved={onKeyRemoved}
      />,
    );

    await screen.findByTestId('api-key-manager-row-anthropic');
    fireEvent.click(screen.getByTestId('api-key-manager-remove-anthropic'));

    // The underlying keychain no longer has the key...
    await waitFor(async () => expect(await keychain.hasKey('anthropic')).toBe(false));
    // ...the row is gone (empty state shows)...
    await waitFor(() =>
      expect(screen.queryByTestId('api-key-manager-row-anthropic')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('api-key-manager-empty')).toBeInTheDocument();
    // ...and the caller was told which provider was removed.
    expect(onKeyRemoved).toHaveBeenCalledWith('anthropic');
  });

  it('does not remove the key when the confirm prompt is cancelled', async () => {
    const keychain = createKeychainService('localStorage');
    await keychain.setKey('anthropic', VALID_ANTHROPIC_KEY);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <ApiKeyManager open onOpenChange={vi.fn()} keychainService={keychain} onAddKey={vi.fn()} />,
    );

    await screen.findByTestId('api-key-manager-row-anthropic');
    fireEvent.click(screen.getByTestId('api-key-manager-remove-anthropic'));

    // Still present.
    expect(await keychain.hasKey('anthropic')).toBe(true);
    expect(screen.getByTestId('api-key-manager-row-anthropic')).toBeInTheDocument();
  });

  it('shows an empty state when no keys are saved', async () => {
    const keychain = createKeychainService('localStorage');

    render(
      <ApiKeyManager open onOpenChange={vi.fn()} keychainService={keychain} onAddKey={vi.fn()} />,
    );

    expect(await screen.findByTestId('api-key-manager-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('api-key-manager-list')).not.toBeInTheDocument();
  });

  it('"Add a provider key" calls onAddKey (hands off to the wizard)', async () => {
    const keychain = createKeychainService('localStorage');
    const onAddKey = vi.fn();

    render(
      <ApiKeyManager open onOpenChange={vi.fn()} keychainService={keychain} onAddKey={onAddKey} />,
    );

    fireEvent.click(await screen.findByTestId('api-key-manager-add'));
    expect(onAddKey).toHaveBeenCalledTimes(1);
  });
});

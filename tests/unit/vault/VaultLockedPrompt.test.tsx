/**
 * VaultLockedPrompt.test.tsx
 *
 * RTL tests for VaultLockedPrompt and VaultEscapeHatchDialog.
 *
 * Strategy:
 *   - Mock the vaultStore so unlockWithRecovery is a spy we control.
 *   - Mock vaultClient so vault_decrypt_all / vault_disable calls are captured.
 *   - Verify component behavior without touching Tauri IPC.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ── Mock vaultStore ──────────────────────────────────────────────────────────

const unlockWithRecoveryMock = vi.fn();
const mockStoreState = {
  status: 'idle' as 'idle' | 'loading' | 'error',
  error: null as string | null,
  unlockWithRecovery: unlockWithRecoveryMock,
  clearError: vi.fn(),
};

vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: (selector?: (s: typeof mockStoreState) => unknown) => {
    if (typeof selector === 'function') return selector(mockStoreState);
    return mockStoreState;
  },
}));

// ── Mock vaultClient ─────────────────────────────────────────────────────────

const vaultDecryptAllMock = vi.fn();
const vaultDisableMock = vi.fn();

vi.mock('@/modules/vault/vaultClient', () => ({
  vaultDecryptAll: (...a: unknown[]) => vaultDecryptAllMock(...a),
  vaultDisable: (...a: unknown[]) => vaultDisableMock(...a),
}));

// Import components AFTER mocks are established.
import { VaultLockedPrompt } from '@/components/vault/VaultLockedPrompt';
import { VaultEscapeHatchDialog } from '@/components/vault/VaultEscapeHatchDialog';

const WORKSPACE = '/home/user/test-workspace';
const VALID_PHRASE = Array.from({ length: 24 }, (_, i) => `word${i + 1}`).join(' ');

// ── VaultLockedPrompt ────────────────────────────────────────────────────────

describe('VaultLockedPrompt', () => {
  beforeEach(() => {
    unlockWithRecoveryMock.mockReset();
    mockStoreState.status = 'idle';
    mockStoreState.error = null;
  });

  it('(a) renders a phrase input and an Unlock button', () => {
    render(<VaultLockedPrompt workspace={WORKSPACE} />);

    // A textarea or input for the recovery phrase
    const input = screen.getByTestId('recovery-phrase-input');
    expect(input).toBeDefined();

    // An unlock button
    const btn = screen.getByRole('button', { name: /unlock/i });
    expect(btn).toBeDefined();
  });

  it('(b) Unlock button is disabled when the phrase input is empty', () => {
    render(<VaultLockedPrompt workspace={WORKSPACE} />);

    const btn = screen.getByRole('button', { name: /unlock/i });
    expect(btn).toBeDisabled();
  });

  it('(c) entering a phrase enables the Unlock button', () => {
    render(<VaultLockedPrompt workspace={WORKSPACE} />);

    const input = screen.getByTestId('recovery-phrase-input');
    fireEvent.change(input, { target: { value: VALID_PHRASE } });

    const btn = screen.getByRole('button', { name: /unlock/i });
    expect(btn).not.toBeDisabled();
  });

  it('(d) clicking Unlock calls unlockWithRecovery with workspace and the typed phrase', async () => {
    unlockWithRecoveryMock.mockResolvedValueOnce(undefined);

    render(<VaultLockedPrompt workspace={WORKSPACE} />);

    const input = screen.getByTestId('recovery-phrase-input');
    fireEvent.change(input, { target: { value: VALID_PHRASE } });

    const btn = screen.getByRole('button', { name: /unlock/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(unlockWithRecoveryMock).toHaveBeenCalledOnce();
    expect(unlockWithRecoveryMock).toHaveBeenCalledWith(WORKSPACE, VALID_PHRASE);
  });

  it('(e) invalid_phrase error renders a friendly message about phrase format', () => {
    mockStoreState.status = 'error';
    mockStoreState.error = 'invalid_phrase';

    render(<VaultLockedPrompt workspace={WORKSPACE} />);

    const err = screen.getByTestId('vault-unlock-error');
    expect(err.textContent?.toLowerCase()).toMatch(/phrase|word|format|invalid/);
  });

  it('(f) recovery_failed error renders a message that phrase does not match this vault', () => {
    mockStoreState.status = 'error';
    mockStoreState.error = 'recovery_failed';

    render(<VaultLockedPrompt workspace={WORKSPACE} />);

    const err = screen.getByTestId('vault-unlock-error');
    // Should tell the user the phrase does not match this vault
    expect(err.textContent?.toLowerCase()).toMatch(/match|vault|correct|wrong/);
  });

  it('(g) generic error messages are shown verbatim (or with a fallback)', () => {
    mockStoreState.status = 'error';
    mockStoreState.error = 'Some unexpected error occurred';

    render(<VaultLockedPrompt workspace={WORKSPACE} />);

    const err = screen.getByTestId('vault-unlock-error');
    expect(err.textContent).toBeTruthy();
  });
});

// ── VaultEscapeHatchDialog ───────────────────────────────────────────────────

describe('VaultEscapeHatchDialog', () => {
  beforeEach(() => {
    vaultDecryptAllMock.mockReset();
    vaultDisableMock.mockReset();
  });

  it('(a) renders when open=true', () => {
    render(
      <VaultEscapeHatchDialog
        open
        onOpenChange={vi.fn()}
        workspace={WORKSPACE}
      />,
    );

    // Should show some title text mentioning vault/decrypt/disable
    expect(document.body.textContent?.toLowerCase()).toMatch(/decrypt|vault|turn off|disable/);
  });

  it('(b) explains that files return to normal unencrypted files on disk', () => {
    render(
      <VaultEscapeHatchDialog
        open
        onOpenChange={vi.fn()}
        workspace={WORKSPACE}
      />,
    );

    // Must have some warning/description text
    const body = document.body.textContent?.toLowerCase() ?? '';
    expect(body).toMatch(/unencrypt|plain|normal|disk/);
  });

  it('(c) on confirm, calls vaultDecryptAll THEN vaultDisable in order', async () => {
    const callOrder: string[] = [];
    vaultDecryptAllMock.mockImplementation(async () => {
      callOrder.push('decrypt_all');
    });
    vaultDisableMock.mockImplementation(async () => {
      callOrder.push('disable');
    });

    render(
      <VaultEscapeHatchDialog
        open
        onOpenChange={vi.fn()}
        workspace={WORKSPACE}
      />,
    );

    // Click the confirm/proceed button (not cancel)
    const confirmBtn = screen.getByTestId('escape-hatch-confirm');
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    await waitFor(() => {
      expect(callOrder).toEqual(['decrypt_all', 'disable']);
    });

    expect(vaultDecryptAllMock).toHaveBeenCalledWith(WORKSPACE);
    expect(vaultDisableMock).toHaveBeenCalledWith(WORKSPACE);
  });

  it('(d) does NOT call disable when decryptAll fails (order guarantee)', async () => {
    vaultDecryptAllMock.mockRejectedValueOnce(new Error('decryption failed'));
    vaultDisableMock.mockResolvedValue(undefined);

    render(
      <VaultEscapeHatchDialog
        open
        onOpenChange={vi.fn()}
        workspace={WORKSPACE}
      />,
    );

    const confirmBtn = screen.getByTestId('escape-hatch-confirm');
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    await waitFor(() => {
      // Error state should be shown
      expect(screen.getByTestId('escape-hatch-error')).toBeDefined();
    });

    // disable must NOT have been called
    expect(vaultDisableMock).not.toHaveBeenCalled();
  });

  it('(e) cancel button closes the dialog without calling any vault command', () => {
    const onOpenChange = vi.fn();
    render(
      <VaultEscapeHatchDialog
        open
        onOpenChange={onOpenChange}
        workspace={WORKSPACE}
      />,
    );

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(vaultDecryptAllMock).not.toHaveBeenCalled();
    expect(vaultDisableMock).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

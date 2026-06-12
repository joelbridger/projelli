/**
 * vaultStore.ts — Zustand state for the encrypted workspace vault.
 *
 * State and phases:
 *   idle    — vault not being set up
 *   explain — user is reading the "what is this?" explanation
 *   ceremony — user is viewing the 24-word phrase + confirmation step
 *   escrow  — user is confirming firm-admin escrow (firm tier only)
 *   encrypting — vault_encrypt_all is running
 *   done    — vault is enabled and all files encrypted
 *
 * Key rule: recoveryPhrase is held ONLY during the ceremony phase.
 * continueEnableAfterCeremony() MUST null it before returning.
 */

import { create } from 'zustand';
import {
  vaultCreate,
  vaultEncryptAll,
  vaultUnlockWithRecovery,
  provisionEscrow,
  type AdminDevice,
} from '@/modules/vault/vaultClient';

export type VaultPhase =
  | 'explain'
  | 'ceremony'
  | 'escrow'
  | 'encrypting'
  | 'done';

/**
 * Normalize an error from a vault Tauri command into a message/code string.
 * The backend `VaultCommandError` serializes as `{ kind, message }` (serde tag/content,
 * snake_case) — e.g. `{ kind: 'invalid_phrase', message: '...' }`. We surface the `kind`
 * so the UI can branch on the typed code; otherwise fall back to an Error message,
 * a plain string, or the provided default.
 */
function vaultErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'kind' in err) {
    const kind = (err as { kind: unknown }).kind;
    if (typeof kind === 'string') return kind;
  }
  return fallback;
}

interface VaultState {
  /** The current phase of the enable flow, or null when idle. */
  phase: VaultPhase | null;
  /** Whether an async vault operation is in progress. */
  status: 'idle' | 'loading' | 'error';
  /** The most recent error message, or null. */
  error: string | null;
  /**
   * The 24-word BIP39 recovery phrase — populated by vault_create and held
   * ONLY during the ceremony phase. Cleared (nulled) by continueEnableAfterCeremony.
   * Never persisted to localStorage or returned from the store after clearing.
   */
  recoveryPhrase: string | null;

  // ── Actions ──────────────────────────────────────────────────────────
  /**
   * Start the enable flow.
   * Calls vault_create, stores the returned phrase in state, and transitions
   * to the 'ceremony' phase so the UI can render RecoveryPhraseCeremony.
   * The enable flow continues via continueEnableAfterCeremony once confirmed.
   */
  enableVault: (workspace: string, escrow: boolean) => Promise<void>;

  /**
   * Called by the enable flow AFTER the ceremony's onConfirmed fires.
   * 1. Nulls the in-memory recoveryPhrase immediately.
   * 2. Transitions to 'escrow' if firm + adminDevices supplied, else 'encrypting'.
   * 3. Calls vault_encrypt_all.
   * 4. If firm: calls provisionEscrow.
   * 5. Transitions to 'done'.
   */
  continueEnableAfterCeremony: (
    workspace: string,
    escrow: boolean,
    adminDevices?: AdminDevice[],
  ) => Promise<void>;

  /**
   * Unlock a locked vault using the 24-word recovery phrase.
   * On success the Tauri layer re-stores the VMK in the OS keychain.
   */
  unlockWithRecovery: (workspace: string, phrase: string) => Promise<void>;

  /** Manually advance/set the phase (used by VaultEnableFlow for explain → ceremony). */
  setPhase: (phase: VaultPhase | null) => void;

  /** Clear error state. */
  clearError: () => void;

  /** Reset the store to initial idle state. */
  reset: () => void;
}

export const useVaultStore = create<VaultState>()((set, _get) => ({
  phase: null,
  status: 'idle',
  error: null,
  recoveryPhrase: null,

  enableVault: async (workspace, escrow) => {
    set({ status: 'loading', error: null, phase: 'explain' });
    try {
      const { recoveryPhrase } = await vaultCreate(workspace, escrow);
      set({ status: 'idle', phase: 'ceremony', recoveryPhrase });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create vault';
      set({ status: 'error', error: message });
    }
  },

  continueEnableAfterCeremony: async (workspace, escrow, adminDevices) => {
    // CRITICAL: null the phrase immediately — it must not linger in state.
    set({ recoveryPhrase: null });

    const nextPhase: VaultPhase = escrow && adminDevices && adminDevices.length > 0
      ? 'escrow'
      : 'encrypting';
    set({ status: 'loading', error: null, phase: nextPhase });

    try {
      // Transition to encrypting regardless of whether we showed 'escrow' first.
      set({ phase: 'encrypting' });
      await vaultEncryptAll(workspace);

      if (escrow && adminDevices && adminDevices.length > 0) {
        await provisionEscrow(workspace, adminDevices, 1);
      }

      set({ status: 'idle', phase: 'done' });
    } catch (err) {
      set({ status: 'error', error: vaultErrorMessage(err, 'Vault enable failed') });
    }
  },

  unlockWithRecovery: async (workspace, phrase) => {
    set({ status: 'loading', error: null });
    try {
      await vaultUnlockWithRecovery(workspace, phrase);
      set({ status: 'idle' });
    } catch (err) {
      // Surface the typed code (e.g. 'invalid_phrase' / 'recovery_failed') so the
      // locked prompt can show a precise message; fall back to a generic string.
      set({ status: 'error', error: vaultErrorMessage(err, 'Recovery failed') });
    }
  },

  setPhase: (phase) => { set({ phase }); },
  clearError: () => { set({ error: null }); },
  reset: () => { set({ phase: null, status: 'idle', error: null, recoveryPhrase: null }); },
}));

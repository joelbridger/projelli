/**
 * VaultLockedPrompt.tsx — shown when a workspace vault is enabled but locked.
 *
 * This happens when the OS keychain does not have the vault master key,
 * meaning the user is on a different machine or the keychain was cleared.
 * The only way to regain access is the 24-word BIP39 recovery phrase.
 *
 * Props:
 *   workspace  — absolute path to the workspace root.
 *   onUnlocked — optional callback when unlock succeeds (e.g. to continue
 *                opening the workspace).
 *   onEscapeHatch — optional callback to open the VaultEscapeHatchDialog.
 */

import { useState, useEffect } from 'react';
import { Lock, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useVaultStore } from '@/stores/vaultStore';

interface VaultLockedPromptProps {
  workspace: string;
  onUnlocked?: () => void;
  onEscapeHatch?: () => void;
}

/**
 * Returns a user-friendly message for a typed Tauri vault error string.
 * The Rust backend returns snake_case error codes; we translate them here.
 */
function friendlyError(err: string | null): string {
  if (!err) return '';
  if (err === 'invalid_phrase') {
    return 'That phrase has an invalid format. Check each word and try again.';
  }
  if (err === 'recovery_failed') {
    return 'That phrase is valid, but it does not match this vault. Make sure you are using the correct recovery phrase.';
  }
  return err;
}

export function VaultLockedPrompt({
  workspace,
  onUnlocked,
  onEscapeHatch,
}: VaultLockedPromptProps) {
  const { status, error, unlockWithRecovery, clearError } = useVaultStore();
  const [phrase, setPhrase] = useState('');
  // Track whether we have an unlock attempt in flight so we can detect success.
  const [unlocking, setUnlocking] = useState(false);

  const canSubmit = phrase.trim().length > 0 && status !== 'loading';

  // When status transitions back to idle while an unlock is in flight (meaning
  // no error was set), the unlock succeeded.
  useEffect(() => {
    if (unlocking && status === 'idle' && !error) {
      setUnlocking(false);
      onUnlocked?.();
    } else if (unlocking && (status === 'error' || status === 'idle')) {
      setUnlocking(false);
    }
  }, [status, error, unlocking, onUnlocked]);

  const handleUnlock = async () => {
    clearError();
    setUnlocking(true);
    await unlockWithRecovery(workspace, phrase.trim());
    // The useEffect above will detect the status change and call onUnlocked.
  };

  return (
    <div className="flex flex-col gap-5 p-1">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
          <Lock className="h-5 w-5 text-amber-600" aria-hidden />
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-900">Vault locked</h3>
          <p className="text-sm text-slate-500">
            This workspace is encrypted and the key is not on this machine.
          </p>
        </div>
      </div>

      {/* Explanation */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 space-y-1">
        <p>
          Enter your 24-word recovery phrase to unlock this vault. Keepance will restore
          the key to your keychain so you can open this workspace normally from now on.
        </p>
        <p className="text-slate-500 text-xs">
          Recovery phrases are 24 words separated by spaces.
        </p>
      </div>

      {/* Phrase input */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="vault-recovery-phrase"
          className="text-sm font-medium text-slate-700"
        >
          Recovery phrase
        </label>
        <textarea
          id="vault-recovery-phrase"
          data-testid="recovery-phrase-input"
          rows={3}
          placeholder="word1 word2 word3 ..."
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="none"
        />
      </div>

      {/* Error */}
      {status === 'error' && error && (
        <p
          data-testid="vault-unlock-error"
          className="text-sm text-red-600"
          role="alert"
        >
          {friendlyError(error)}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        {onEscapeHatch && (
          <button
            type="button"
            onClick={onEscapeHatch}
            className="text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2"
          >
            Turn off vault and decrypt files
          </button>
        )}
        <div className="flex gap-2 ml-auto">
          <Button
            type="button"
            onClick={handleUnlock}
            disabled={!canSubmit}
            className="bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <KeyRound className="mr-2 h-4 w-4" aria-hidden />
            Unlock
          </Button>
        </div>
      </div>
    </div>
  );
}

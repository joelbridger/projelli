/**
 * VaultEscapeHatchDialog.tsx — confirmation dialog for turning off the vault.
 *
 * Decrypts every file in the workspace back to plaintext, then disables the
 * vault entirely.  The order is strictly:
 *   1. vault_decrypt_all  (returns files to normal unencrypted files on disk)
 *   2. vault_disable      (removes .keepance-vault.json + keychain entry)
 *
 * vault_disable is never called if vault_decrypt_all fails; the Rust backend
 * also enforces this independently (`files_still_encrypted` guard).
 *
 * Props:
 *   open         — whether the dialog is visible.
 *   onOpenChange — called with false to close.
 *   workspace    — absolute path to the workspace root.
 *   onComplete   — called after the vault is fully disabled.
 */

import { useState } from 'react';
import { ShieldOff, Loader2, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { vaultDecryptAll, vaultDisable } from '@/modules/vault/vaultClient';

interface VaultEscapeHatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: string;
  onComplete?: () => void;
}

type Phase = 'confirm' | 'working' | 'done' | 'error';

export function VaultEscapeHatchDialog({
  open,
  onOpenChange,
  workspace,
  onComplete,
}: VaultEscapeHatchDialogProps) {
  const [phase, setPhase] = useState<Phase>('confirm');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleConfirm = async () => {
    setPhase('working');
    setErrorMsg(null);

    try {
      // Step 1: decrypt every file — MUST succeed before we touch the metadata.
      await vaultDecryptAll(workspace);

      // Step 2: remove the vault metadata + keychain entry.
      await vaultDisable(workspace);

      setPhase('done');
      onComplete?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setErrorMsg(msg);
      setPhase('error');
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const handleClose = () => {
    // Reset local state when the dialog is re-opened later.
    setPhase('confirm');
    setErrorMsg(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md bg-white">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-100">
              <ShieldOff className="h-4 w-4 text-orange-600" aria-hidden />
            </div>
            <DialogTitle className="text-base font-semibold text-slate-900">
              Decrypt this workspace and turn off the vault
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-slate-500 mt-1">
            This will convert every encrypted file back to a normal, unencrypted file
            on this disk. The vault will be disabled and removed from this workspace.
          </DialogDescription>
        </DialogHeader>

        {/* Warning banner */}
        {phase === 'confirm' && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800 space-y-1">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
              <div className="space-y-1">
                <p className="font-medium">After this, at-rest protection reverts to OS disk encryption only.</p>
                <p>
                  Your files will be readable by any process that has access to this folder.
                  Make sure your operating system's full-disk encryption is enabled if you
                  handle sensitive documents.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Working state */}
        {phase === 'working' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-7 w-7 animate-spin text-blue-600" aria-hidden />
            <p className="text-sm text-slate-700 text-center">
              Decrypting files&hellip; this may take a moment for large workspaces.
            </p>
          </div>
        )}

        {/* Done state */}
        {phase === 'done' && (
          <p className="text-sm text-slate-700">
            All files have been decrypted and the vault has been removed.
            Your files are normal unencrypted files on disk.
          </p>
        )}

        {/* Error state */}
        {phase === 'error' && errorMsg && (
          <p
            data-testid="escape-hatch-error"
            role="alert"
            className="text-sm text-red-600"
          >
            {errorMsg}
          </p>
        )}

        <DialogFooter>
          {phase === 'confirm' && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                className="border-slate-300 text-slate-700"
              >
                Cancel
              </Button>
              <Button
                type="button"
                data-testid="escape-hatch-confirm"
                onClick={handleConfirm}
                className="bg-orange-600 text-white hover:bg-orange-700"
              >
                Decrypt and turn off vault
              </Button>
            </>
          )}
          {phase === 'working' && (
            <Button type="button" disabled className="bg-orange-600 text-white opacity-50">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Working&hellip;
            </Button>
          )}
          {phase === 'done' && (
            <Button
              type="button"
              onClick={handleClose}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              Done
            </Button>
          )}
          {phase === 'error' && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                className="border-slate-300 text-slate-700"
              >
                Cancel
              </Button>
              <Button
                type="button"
                data-testid="escape-hatch-confirm"
                onClick={handleConfirm}
                className="bg-orange-600 text-white hover:bg-orange-700"
              >
                Try again
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

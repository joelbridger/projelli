/**
 * VaultControlCard — the reachable entry point for the encrypted workspace vault.
 *
 * Lives in the Privacy Center ("Where your data is"). It reads the live vault
 * status for the open workspace and surfaces the right control:
 *   - vault off      → "Enable vault"  → opens VaultEnableFlow in a dialog
 *   - vault unlocked → "Turn off vault and decrypt files" → VaultEscapeHatchDialog
 *   - vault locked   → an explanatory note (locked workspaces are normally
 *                      unlocked at the workspace selector, so this is rare here)
 *
 * The encrypted vault is a Tauri-only feature, so the whole card is hidden in
 * the browser build. Status is fetched imperatively (there is no reactive vault
 * store) and refreshed after enable/disable.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@tauri-apps/api/core';
import { Lock, ShieldCheck, Loader2 } from 'lucide-react';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useVaultStore } from '@/platform/firm/vaultStore';
import { vaultStatus, type VaultStatus } from '@/platform/firm/vault/vaultClient';
import { VaultEnableFlow } from './VaultEnableFlow';
import { VaultEscapeHatchDialog } from './VaultEscapeHatchDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/kp';

export function VaultControlCard() {
  const { t } = useTranslation();
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const resetVaultFlow = useVaultStore((s) => s.reset);
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [enableOpen, setEnableOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  // Load (and reset) vault status whenever the workspace changes. `status === null`
  // means "not yet known": we render a neutral checking state and NEVER offer
  // "Enable vault" until we have confirmed the workspace is actually unvaulted.
  // (vault_create overwrites metadata + the master key, so enabling a vault that
  // already exists would orphan its encrypted files — the control must never
  // appear on a stale or unknown status.) The ignore flag drops a response that
  // arrives after rootPath has changed.
  useEffect(() => {
    if (!isTauri() || !rootPath) {
      setStatus(null);
      return undefined;
    }
    let ignore = false;
    setStatus(null);
    vaultStatus(rootPath)
      .then((s) => { if (!ignore) setStatus(s); })
      .catch(() => { if (!ignore) setStatus(null); });
    return () => { ignore = true; };
  }, [rootPath]);

  // Re-check after an enable/disable action (or a cancelled enable that may have
  // written metadata before the ceremony) so the card reflects the real on-disk
  // state, not a stale one.
  const refresh = useCallback(async () => {
    if (!isTauri() || !rootPath) {
      setStatus(null);
      return;
    }
    try {
      setStatus(await vaultStatus(rootPath));
    } catch {
      setStatus(null);
    }
  }, [rootPath]);

  // Vault is desktop-only; render nothing in the browser or with no workspace.
  if (!isTauri() || !rootPath) return null;

  const loaded = status !== null;
  const enabled = status?.enabled ?? false;
  const locked = status?.locked ?? false;

  const closeEnable = () => {
    setEnableOpen(false);
    // VaultEnableFlow holds its phase in the shared vault store; reset it so a
    // dismissed-mid-flow dialog doesn't reopen on a stale phase. Re-check status
    // too: enableVault writes vault metadata before the recovery ceremony, so a
    // cancel mid-flow can leave the workspace marked enabled — surface that.
    resetVaultFlow();
    void refresh();
  };

  return (
    <div
      data-testid="vault-control-card"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--kp-radius-md, 10px)',
        background: 'var(--color-card, #ffffff)',
        padding: 'var(--kp-space-md)',
        marginBottom: 'var(--kp-space-md)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--kp-space-sm)',
      }}
    >
      <div
        style={{
          display: 'flex',
          height: 36,
          width: 36,
          flexShrink: 0,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: enabled ? 'rgba(22, 163, 74, 0.12)' : 'rgba(37, 99, 235, 0.12)',
        }}
      >
        {enabled ? (
          <ShieldCheck size={18} color="#16a34a" aria-hidden />
        ) : (
          <Lock size={18} color="#2563eb" aria-hidden />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 'var(--kp-font-sm)',
            fontWeight: 600,
            color: 'var(--kp-navy, #0f172a)',
          }}
        >
          {enabled ? t('vault.control.on-title') : t('vault.enable.title')}
        </h3>
        <p
          style={{
            margin: '4px 0 12px',
            fontSize: 'var(--kp-font-xs)',
            color: 'var(--color-muted-foreground)',
          }}
        >
          {enabled
            ? locked
              ? t('vault.control.locked-note')
              : t('vault.control.on-body')
            : t('vault.enable.subtitle')}
        </p>

        {!loaded ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 'var(--kp-font-xs)',
              color: 'var(--color-muted-foreground)',
            }}
          >
            <Loader2 size={14} className="animate-spin" aria-hidden /> {t('vault.control.checking')}
          </span>
        ) : !enabled ? (
          <Button
            variant="primary"
            size="sm"
            data-testid="vault-enable-trigger"
            onClick={() => { setEnableOpen(true); }}
          >
            {t('vault.enable.enable-button')}
          </Button>
        ) : !locked ? (
          <Button
            variant="secondary"
            size="sm"
            data-testid="vault-disable-trigger"
            onClick={() => { setDisableOpen(true); }}
          >
            {t('vault.locked.escape-hatch')}
          </Button>
        ) : (
          <span
            data-testid="vault-locked-note"
            style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}
          >
            {t('vault.control.locked-note')}
          </span>
        )}
      </div>

      {/* Enable flow, hosted in a dialog */}
      <Dialog open={enableOpen} onOpenChange={(open) => { if (!open) closeEnable(); }}>
        <DialogContent className="max-w-md bg-white" data-testid="vault-enable-dialog">
          <DialogHeader>
            <DialogTitle className="sr-only">{t('vault.enable.title')}</DialogTitle>
          </DialogHeader>
          <VaultEnableFlow
            workspace={rootPath}
            onComplete={() => { closeEnable(); void refresh(); }}
            onCancel={closeEnable}
          />
        </DialogContent>
      </Dialog>

      {/* Escape hatch: decrypt every file then disable the vault */}
      <VaultEscapeHatchDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        workspace={rootPath}
        onComplete={() => { void refresh(); }}
      />
    </div>
  );
}

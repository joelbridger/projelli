/**
 * VaultEnableFlow.tsx — orchestrates the vault enable sequence.
 *
 * Phases:
 *   explain    — description of what the vault does, a warning about recovery,
 *                and an "Enable vault" button that starts vault_create.
 *   ceremony   — RecoveryPhraseCeremony (mandatory confirm; onConfirmed advances).
 *   escrow     — (firm only) confirmation that a firm admin can recover the vault.
 *   encrypting — progress feedback while vault_encrypt_all runs.
 *   done       — success state.
 *
 * Props:
 *   workspace     — absolute path to the workspace root.
 *   isFirm        — whether this is a firm-tier workspace (shows escrow consent).
 *   adminDevices  — firm admin devices to escrow to (firm tier only).
 *   onComplete    — called when the vault is fully enabled (done phase).
 *   onCancel      — called when the user dismisses before completing.
 */

import { useTranslation } from 'react-i18next';
import { useVaultStore } from '@/stores/vaultStore';
import { RecoveryPhraseCeremony } from './RecoveryPhraseCeremony';
import { Button } from '@/ui/button';
import { Loader2, ShieldCheck, Lock, KeyRound } from 'lucide-react';
import type { AdminDevice } from '@/platform/firm/vault/vaultClient';

interface VaultEnableFlowProps {
  workspace: string;
  isFirm?: boolean;
  adminDevices?: AdminDevice[];
  onComplete?: () => void;
  onCancel?: () => void;
}

export function VaultEnableFlow({
  workspace,
  isFirm = false,
  adminDevices = [],
  onComplete,
  onCancel,
}: VaultEnableFlowProps) {
  const { t } = useTranslation();
  const { phase, status, error, recoveryPhrase, enableVault, continueEnableAfterCeremony, reset } =
    useVaultStore();

  const handleStart = async () => {
    await enableVault(workspace, isFirm && adminDevices.length > 0);
  };

  const handleCeremonyConfirmed = async () => {
    await continueEnableAfterCeremony(workspace, isFirm, adminDevices);
  };

  const handleCancel = () => {
    reset();
    onCancel?.();
  };

  // ── Explain (initial) ────────────────────────────────────────────────────────
  if (!phase || phase === 'explain') {
    return (
      <div className="flex flex-col gap-5 p-1">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
            <Lock className="h-5 w-5 text-blue-600" aria-hidden />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">{t('vault.enable.title')}</h3>
            <p className="text-sm text-slate-500">{t('vault.enable.subtitle')}</p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 space-y-2">
          <p>{t('vault.enable.detail')}</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>{t('vault.enable.bullet-names-visible')}</li>
            <li>{t('vault.enable.bullet-phrase-once')}</li>
            <li>{t('vault.enable.bullet-no-recovery')}</li>
            {isFirm && <li>{t('vault.enable.bullet-firm-escrow')}</li>}
          </ul>
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={handleCancel} className="border-slate-300 text-slate-700">
            {t('vault.enable.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => { void handleStart(); }}
            disabled={status === 'loading'}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {status === 'loading' ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> {t('vault.enable.setting-up')}</>
            ) : (
              t('vault.enable.enable-button')
            )}
          </Button>
        </div>
      </div>
    );
  }

  // ── Ceremony ──────────────────────────────────────────────────────────────────
  if (phase === 'ceremony') {
    if (!recoveryPhrase) {
      return <p className="text-sm text-slate-500">{t('vault.enable.loading-phrase')}</p>;
    }
    return (
      <div className="flex flex-col gap-4 p-1">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
            <KeyRound className="h-5 w-5 text-amber-600" aria-hidden />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">{t('vault.enable.ceremony-heading')}</h3>
            <p className="text-sm text-slate-500">{t('vault.enable.ceremony-subheading')}</p>
          </div>
        </div>
        <RecoveryPhraseCeremony phrase={recoveryPhrase} onConfirmed={() => { void handleCeremonyConfirmed(); }} />
      </div>
    );
  }

  // ── Escrow consent (firm only) ────────────────────────────────────────────────
  if (phase === 'escrow') {
    return (
      <div className="flex flex-col gap-5 p-1">
        <p className="text-sm text-slate-700">
          {t('vault.enable.escrow-notice')}
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            onClick={() => { void handleCeremonyConfirmed(); }}
            disabled={status === 'loading'}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {status === 'loading' ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> {t('vault.enable.setting-up')}</>
            ) : (
              t('vault.enable.confirm-continue')
            )}
          </Button>
        </div>
      </div>
    );
  }

  // ── Encrypting ────────────────────────────────────────────────────────────────
  if (phase === 'encrypting') {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" aria-hidden />
        <div className="text-center">
          <p className="font-medium text-slate-800">{t('vault.enable.encrypting-title')}</p>
          <p className="text-sm text-slate-500">{t('vault.enable.encrypting-subtitle')}</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center gap-4 py-8 p-1">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
        <ShieldCheck className="h-6 w-6 text-green-600" aria-hidden />
      </div>
      <div className="text-center">
        <p className="font-semibold text-slate-900">{t('vault.enable.done-title')}</p>
        <p className="text-sm text-slate-500">{t('vault.enable.done-subtitle')}</p>
      </div>
      <Button
        type="button"
        onClick={() => {
          reset();
          onComplete?.();
        }}
        className="bg-blue-600 text-white hover:bg-blue-700"
      >
        {t('vault.enable.done-button')}
      </Button>
    </div>
  );
}

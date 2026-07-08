/**
 * LicenseSettings — UI for activating, viewing, and deactivating a Lantern license.
 *
 * Renders three states:
 *   1. Not activated: shows a license key input and an "Activate" button
 *   2. Activated: shows the current tier, expiration, and a "Deactivate" button
 *   3. Loading: spinner during activation/validation
 *
 * Sits inside Settings, alongside ApiKeySettings.
 */

import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useLicense } from '@/platform/hooks/useLicense';
import { useTrial } from '@/platform/hooks/useTrial';
import { useEntitlement } from '@/platform/hooks/useEntitlement';
import { entitlementMessage } from '@/platform/licensing';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { InfoHelp } from '@/ui/InfoHelp';
import { CostDashboard } from '@/features/ask/CostDashboard';
import { PricingTiers } from '@/features/settings/PricingTiers';
import { displayName } from '@/config/pricing';
import { BRAND } from '@/config/brand';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/ui/ConfirmDialog';

export function LicenseSettings() {
  const { t } = useTranslation();
  const { tier, packs, seats, isLoading, isActivated, expiresAt, error, activate, deactivate, refresh } = useLicense();
  const trial = useTrial();
  const entitlement = useEntitlement();
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  // In-app confirm dialog (native window.confirm is dead in the Tauri WebView2
  // build, so the deactivate confirmation renders in the DOM instead).
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  // A calm, non-alarming status line driven by the central entitlement layer.
  // Surfaced for grandfathered, lapsed/degraded, and offline-grace states so
  // the user always sees, in plain language, that their files stay theirs.
  const entMsg = entitlementMessage(entitlement);
  const showDegradedNotice =
    entitlement.state === 'subscription-lapsed' || entitlement.state === 'offline-grace';
  const showGrandfatheredNotice = entitlement.isGrandfathered;

  const handleActivate = async () => {
    if (!licenseKeyInput.trim()) return;
    const result = await activate(licenseKeyInput);
    if (result.success) {
      setLicenseKeyInput('');
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    }
  };

  const handleDeactivate = () => {
    void (async () => {
      const confirmed = await confirm(t('settings.license.deactivate-confirm'), {
        title: t('settings.license.deactivate'),
        variant: 'destructive',
      });
      if (confirmed) {
        deactivate();
      }
    })();
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">{t('settings.license.title')}</h2>
          <InfoHelp
            label={`About ${t('settings.license.title')}`}
            content={
              <Trans
                i18nKey="settings.license.description"
                components={{
                  pricingLink: (
                    <a
                      href={BRAND.urls.pricing}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    />
                  ),
                }}
              />
            }
          />
        </div>
      </div>

      {/* Degraded notice: a lapsed subscription or an offline-grace state. AI
          features are paused, but the data-ownership guarantee holds — the user
          can still open, edit, and export everything. Calm tone, clear CTA. */}
      {showDegradedNotice && (
        <div
          data-testid="license-degraded-notice"
          data-entitlement-state={entitlement.state}
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30"
        >
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{entMsg.headline}</p>
          <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-200/90">{entMsg.body}</p>
          {entitlement.state === 'subscription-lapsed' && (
            <Button asChild size="sm" className="mt-3">
              <a
                href={BRAND.urls.pricing}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="license-resubscribe-button"
              >
                {t('settings.license.get-license-cta')}
              </a>
            </Button>
          )}
        </div>
      )}

      {/* Activated state */}
      {isActivated && (
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                  {t('settings.license.badge.activated')}
                </span>
                <span className="text-lg font-medium" data-testid="license-tier-name">
                  {/* 3.0 display name; the wire/license code is unchanged. */}
                  {displayName(tier)}
                </span>
                <span data-testid="license-ownership-guarantee">
                  <InfoHelp
                    content={t('settings.license.ownership-tagline')}
                    label="About your data ownership"
                  />
                </span>
              </div>
              {/* Profession pack(s): Practice gets all packs; Professional shows its one pack. */}
              {tier === 'practice' ? (
                <p className="text-sm text-muted-foreground mt-1">
                  {t('settings.license.all-packs')}
                </p>
              ) : (
                packs.length > 0 && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('settings.license.active-pack', {
                      pack: packs.map((p) => t(`settings.license.packs.${p}`)).join(', '),
                    })}
                  </p>
                )
              )}
              {/* Seat count, only meaningful when more than one. */}
              {seats > 1 && (
                <p className="text-sm text-muted-foreground mt-1">
                  {t('settings.license.seats', { count: seats })}
                </p>
              )}
              {/* A grandfathered (perpetual / pre-3.0) license never expires,
                  so we never show a misleading expiry date for it. */}
              {expiresAt && !entitlement.isGrandfathered && (
                <p className="text-sm text-muted-foreground mt-1">
                  {t('settings.license.valid-until', { date: expiresAt.toLocaleDateString() })}
                </p>
              )}
              {showGrandfatheredNotice && (
                <p
                  className="text-sm text-emerald-700 dark:text-emerald-400 mt-2 font-medium"
                  data-testid="license-grandfathered-notice"
                >
                  {entMsg.body}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
                {t('settings.license.refresh')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDeactivate} disabled={isLoading}>
                {t('settings.license.deactivate')}
              </Button>
            </div>
          </div>
          <div className="border-t pt-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-2">{t('settings.license.unlocks-heading')}</p>
            <ul className="space-y-1 text-xs">
              {/* All paid tiers get the full app. */}
              <li>{t('settings.license.unlocks.ai-chat')}</li>
              <li>{t('settings.license.unlocks.workflows')}</li>
              <li>{t('settings.license.unlocks.workspaces')}</li>
              <li>{t('settings.license.unlocks.whiteboard-audio-research')}</li>
              <li>{t('settings.license.unlocks.multi-model')}</li>
              <li>{t('settings.license.unlocks.commercial')}</li>
              <li>{t('settings.license.unlocks.updates')}</li>
              {/* Pack / seat differentiators. */}
              {tier === 'professional' && <li>{t('settings.license.unlocks.one-pack')}</li>}
              {tier === 'practice' && <li>{t('settings.license.unlocks.all-packs')}</li>}
            </ul>
          </div>
        </div>
      )}

      {/* Not activated state — trial in progress OR trial expired */}
      {!isActivated && (
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div>
            {trial.isExpired ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                    {t('settings.license.badge.trial-ended')}
                  </span>
                  <span className="text-base font-medium">{t('settings.license.activate-to-continue')}</span>
                  <InfoHelp
                    label={`About ${t('settings.license.activate-to-continue')}`}
                    content={
                      <Trans
                        i18nKey="settings.license.trial-expired-detail"
                        values={{
                          days: trial.trialDays,
                          endDate: new Date(trial.firstLaunchAt.getTime() + trial.trialDays * 86400000).toLocaleDateString(),
                        }}
                        components={{ endDateBold: <strong /> }}
                      />
                    }
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200">
                    {t('settings.license.badge.trial')}
                  </span>
                  <span className="text-base font-medium">
                    {t('settings.license.days-left', { count: trial.daysRemaining })}
                  </span>
                  <InfoHelp
                    content={t('settings.license.trial-active-detail', { days: trial.trialDays })}
                    label="About your trial"
                  />
                </div>
              </>
            )}
          </div>
          <div className="border-t pt-5 space-y-4">
            {/* 3.0 per-seat subscription tiers, rendered from the canonical config. */}
            <PricingTiers />
            <Button
              asChild
              size="lg"
              className="w-full text-base font-semibold h-12"
            >
              <a
                href={BRAND.urls.pricing}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="license-buy-button"
              >
                {t('settings.license.get-license-cta')}
              </a>
            </Button>
            {/* Solo license recovery, no account. A returning buyer who
                reinstalled, or moved to a new machine, restores Lantern by
                re-entering the license code they kept. This drives the same
                activate() path (POSTs license_key + machine_id to the validator,
                no login), so recovery is local-first and account-free. */}
            <div
              data-testid="license-recovery"
              className="rounded-lg border border-border bg-muted/30 p-4"
            >
              <Label htmlFor="license-key" className="text-sm font-medium">
                {t('settings.license.recovery-heading')}
              </Label>
              <InfoHelp
                content={t('settings.license.recovery-detail')}
                label={`About ${t('settings.license.recovery-heading')}`}
              />
              <div className="flex gap-2 mt-3">
                <Input
                  id="license-key"
                  type="text"
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  value={licenseKeyInput}
                  onChange={(e) => setLicenseKeyInput(e.target.value)}
                  disabled={isLoading}
                  className="font-mono"
                  data-testid="license-recovery-input"
                />
                <Button
                  variant="outline"
                  onClick={handleActivate}
                  disabled={isLoading || !licenseKeyInput.trim()}
                  data-testid="license-recovery-submit"
                >
                  {isLoading ? t('settings.license.recovery-restoring') : t('settings.license.recovery-restore')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* F1 — AI Usage summary */}
      <div>
        <h2 className="text-lg font-semibold tracking-tight mb-2">AI Usage</h2>
        <CostDashboard />
      </div>

      {/* Error display */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Success toast */}
      {showSuccess && (
        <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-4">
          <p className="text-sm text-green-700 dark:text-green-400">{t('settings.license.activate-success')}</p>
        </div>
      )}
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}

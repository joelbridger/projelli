/**
 * LicenseSettings — UI for activating, viewing, and deactivating a Projelli license.
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
import { useLicense } from '@/hooks/useLicense';
import { useTrial } from '@/hooks/useTrial';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LicenseSettings() {
  const { t } = useTranslation();
  const { tier, isLoading, isActivated, expiresAt, error, activate, deactivate, refresh } = useLicense();
  const trial = useTrial();
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

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
    if (window.confirm(t('settings.license.deactivate-confirm'))) {
      deactivate();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{t('settings.license.title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          <Trans
            i18nKey="settings.license.description"
            components={{
              pricingLink: (
                <a
                  href="https://projelli.com/#pricing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                />
              ),
            }}
          />
        </p>
      </div>

      {/* Activated state */}
      {isActivated && (
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                  {t('settings.license.badge.activated')}
                </span>
                <span className="text-lg font-medium capitalize">
                  {tier === 'lifetime'
                    ? t('settings.license.tier.lifetime')
                    : tier === 'pro'
                      ? t('settings.license.tier.pro')
                      : t('settings.license.tier.free')}
                </span>
              </div>
              {expiresAt && tier !== 'lifetime' && (
                <p className="text-sm text-muted-foreground mt-1">
                  {t('settings.license.valid-until', { date: expiresAt.toLocaleDateString() })}
                </p>
              )}
              {tier === 'lifetime' && (
                <p className="text-sm text-muted-foreground mt-1">
                  {t('settings.license.lifetime-tagline')}
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
              <li>{t('settings.license.unlocks.ai-chat')}</li>
              <li>{t('settings.license.unlocks.workflows')}</li>
              <li>{t('settings.license.unlocks.workspaces')}</li>
              <li>{t('settings.license.unlocks.whiteboard-audio-research')}</li>
              {tier === 'lifetime' && <li>{t('settings.license.unlocks.multi-model')}</li>}
              {tier === 'lifetime' && <li>{t('settings.license.unlocks.commercial')}</li>}
              {tier === 'lifetime' && <li>{t('settings.license.unlocks.updates-forever')}</li>}
              {tier !== 'lifetime' && <li className="opacity-60">{t('settings.license.unlocks.lifetime-extras')}</li>}
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
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  <Trans
                    i18nKey="settings.license.trial-expired-detail"
                    values={{
                      days: trial.trialDays,
                      endDate: new Date(trial.firstLaunchAt.getTime() + trial.trialDays * 86400000).toLocaleDateString(),
                    }}
                    components={{ endDateBold: <strong /> }}
                  />
                </p>
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
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('settings.license.trial-active-detail', { days: trial.trialDays })}
                </p>
              </>
            )}
          </div>
          <div className="border-t pt-5 space-y-4">
            <Button
              asChild
              size="lg"
              className="w-full text-base font-semibold h-12"
            >
              <a
                href="https://projelli.com/#pricing"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="license-buy-button"
              >
                {t('settings.license.get-license-cta')}
              </a>
            </Button>
            <div>
              <Label htmlFor="license-key" className="text-sm">
                {t('settings.license.already-have-key')}
              </Label>
              <div className="flex gap-2 mt-2">
                <Input
                  id="license-key"
                  type="text"
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  value={licenseKeyInput}
                  onChange={(e) => setLicenseKeyInput(e.target.value)}
                  disabled={isLoading}
                  className="font-mono"
                />
                <Button
                  variant="outline"
                  onClick={handleActivate}
                  disabled={isLoading || !licenseKeyInput.trim()}
                >
                  {isLoading ? t('settings.license.activating') : t('settings.license.activate')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
}

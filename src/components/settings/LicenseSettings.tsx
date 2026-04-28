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
import { useLicense } from '@/hooks/useLicense';
import { useTrial } from '@/hooks/useTrial';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LicenseSettings() {
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
    if (window.confirm('Deactivate this license? You will lose access to paid features until you re-activate.')) {
      deactivate();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">License</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Activate Projelli with a license key purchased at{' '}
          <a href="https://projelli.com/#pricing" target="_blank" rel="noopener noreferrer" className="text-primary underline">
            projelli.com
          </a>
          .
        </p>
      </div>

      {/* Activated state */}
      {isActivated && (
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                  ACTIVATED
                </span>
                <span className="text-lg font-medium capitalize">
                  {tier === 'lifetime' ? 'Lifetime' : tier === 'pro' ? 'Pro' : 'Free'}
                </span>
              </div>
              {expiresAt && tier !== 'lifetime' && (
                <p className="text-sm text-muted-foreground mt-1">
                  Valid until: {expiresAt.toLocaleDateString()}
                </p>
              )}
              {tier === 'lifetime' && (
                <p className="text-sm text-muted-foreground mt-1">
                  Lifetime license — updates forever.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={handleDeactivate} disabled={isLoading}>
                Deactivate
              </Button>
            </div>
          </div>
          <div className="border-t pt-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-2">What your license unlocks:</p>
            <ul className="space-y-1 text-xs">
              <li>✓ AI chat with your own keys (Claude, OpenAI, Gemini)</li>
              <li>✓ All 15 founder workflow templates</li>
              <li>✓ Unlimited workspaces, files, and version history</li>
              <li>✓ Whiteboard, audio recording, research citations</li>
              {tier === 'lifetime' && <li>✓ Multi-model comparison</li>}
              {tier === 'lifetime' && <li>✓ Commercial use license</li>}
              {tier === 'lifetime' && <li>✓ Updates forever</li>}
              {tier !== 'lifetime' && <li className="opacity-60">+ Multi-model comparison &amp; commercial use on Lifetime</li>}
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
                    TRIAL ENDED
                  </span>
                  <span className="text-base font-medium">Activate to continue</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Your {trial.trialDays}-day free trial ended on{' '}
                  <strong>{new Date(trial.firstLaunchAt.getTime() + trial.trialDays * 86400000).toLocaleDateString()}</strong>.
                  AI chat and workflows are paused. Your existing files are still here, fully readable. Activate
                  a license to keep building.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200">
                    TRIAL
                  </span>
                  <span className="text-base font-medium">
                    {trial.daysRemaining === 1
                      ? '1 day left'
                      : `${trial.daysRemaining} days left`}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  You're on the free trial. Every Projelli feature is unlocked for {trial.trialDays} days from
                  first launch — bring your own AI keys, run workflows, edit files, the works.
                  When the trial ends, AI chat and workflows pause until you activate a license; your files
                  stay accessible.
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
                Get a license at projelli.com →
              </a>
            </Button>
            <div>
              <Label htmlFor="license-key" className="text-sm">
                Already have a license key?
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
                  {isLoading ? 'Activating…' : 'Activate'}
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
          <p className="text-sm text-green-700 dark:text-green-400">License activated successfully.</p>
        </div>
      )}
    </div>
  );
}

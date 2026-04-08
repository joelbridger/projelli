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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LicenseSettings() {
  const { tier, isLoading, isActivated, expiresAt, error, activate, deactivate, refresh } = useLicense();
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
            <p className="font-medium text-foreground mb-2">Unlocked features:</p>
            <ul className="space-y-1 text-xs">
              <li>✓ All 3 AI providers (Claude, OpenAI, Gemini)</li>
              <li>✓ All 15 workflow templates</li>
              <li>✓ Unlimited workspaces</li>
              <li>✓ Whiteboard, audio recording, research citations</li>
              <li>✓ Multi-model comparison</li>
              {tier === 'lifetime' && <li>✓ Commercial use license</li>}
              {tier === 'lifetime' && <li>✓ Updates forever</li>}
            </ul>
          </div>
        </div>
      )}

      {/* Not activated state */}
      {!isActivated && (
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div>
            <h3 className="text-base font-medium">Free tier</h3>
            <p className="text-sm text-muted-foreground mt-1">
              You're using the free version of Projelli. The free tier includes the core editor, file tree, version history, audit log,
              one AI provider (Claude), three workflow templates, and one workspace. To unlock all features, activate a paid license.
            </p>
          </div>
          <div className="border-t pt-4">
            <Label htmlFor="license-key">License key</Label>
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
              <Button onClick={handleActivate} disabled={isLoading || !licenseKeyInput.trim()}>
                {isLoading ? 'Activating…' : 'Activate'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Don't have a key yet?{' '}
              <a href="https://projelli.com/#pricing" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                Get one at projelli.com
              </a>
              .
            </p>
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

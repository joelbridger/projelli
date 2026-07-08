// API key setup card for the BYOK onboarding flow (UX-04).
//
// Displayed in the MainPanel's "no file open" slot immediately after a user
// picks a workspace folder when they still don't have an AI key saved.
// Lantern's core value prop is AI + local files, and without a key the AI
// side is dead. Silent dead-ends are the #1 first-run complaint, so this
// card tells users exactly what's missing and gives them one click to fix it.
//
// Dismissal is session-scoped (sessionStorage) so the card reappears on a
// fresh app launch if keys are still missing. The session-storage flag is
// intentionally NOT keyed to app version — app-version keying would be
// appropriate for "What's new" banners, but for a critical onboarding nudge
// we'd rather show the card every session until the user actually adds a key.
//
// Introduced: Wave 2 / UX-04.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Key, X, ArrowRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InfoHelp } from '@/ui/InfoHelp';
import { ApiKeyWizard, type WizardProvider } from './ApiKeyWizard';
import type { KeyProvider } from '@/platform/providers/KeychainService';
import { SK_API_KEY_CARD_DISMISSED } from '@/config/identity';

const DISMISS_STORAGE_KEY = SK_API_KEY_CARD_DISMISSED;

export function hasDismissedApiKeyCard(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_STORAGE_KEY) === 'true';
  } catch {
    // sessionStorage may be unavailable in strict privacy modes; treat as not
    // dismissed so the user still sees the nudge.
    return false;
  }
}

export function markApiKeyCardDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_STORAGE_KEY, 'true');
  } catch {
    // Ignore — worst case we show the card again on next action; still fine.
  }
}

interface ApiKeySetupCardProps {
  /**
   * Legacy behavior: opens the AI pane's Keys tab. Still supported so existing
   * callers work unchanged. When `onSaveKey` is NOT provided, clicking the CTA
   * falls back to calling this instead of launching the guided wizard.
   */
  onAddKey: () => void;
  onDismiss: () => void;
  className?: string;
  /**
   * Q20 (Wave 1.5): when supplied, clicking the CTA opens the guided 3-step
   * ApiKeyWizard modal. The wizard calls `onSaveKey` with the final validated
   * key string. This should route into the same save path that ApiKeySettings
   * uses (i.e. KeychainService.setKey).
   */
  onSaveKey?: (provider: KeyProvider, key: string) => void | Promise<void>;
}

export function ApiKeySetupCard({ onAddKey, onDismiss, className, onSaveKey }: ApiKeySetupCardProps) {
  const { t } = useTranslation();
  const [wizardOpen, setWizardOpen] = useState(false);

  const handleCta = () => {
    if (onSaveKey) {
      setWizardOpen(true);
    } else {
      onAddKey();
    }
  };

  return (
    <div
      data-testid="api-key-setup-card"
      className={cn(
        'flex-1 flex items-center justify-center p-8 h-full',
        className
      )}
    >
      <Card className="relative max-w-md w-full shadow-md">
        <Button
          data-testid="api-key-setup-card-dismiss"
          variant="ghost"
          size="sm"
          className="absolute right-2 top-2 h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss (will reappear next session)"
        >
          <X className="h-4 w-4" />
        </Button>
        <CardContent className="pt-6 pb-6 px-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-2.5">
              <Key className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold leading-tight">
                {t('onboarding.api-key-card.title')}
                <InfoHelp content={t('onboarding.api-key-card.description')} />
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                1 min setup
              </p>
            </div>
          </div>
          <Button
            data-testid="api-key-setup-card-cta"
            onClick={handleCta}
            className="w-full gap-2"
          >
            {onSaveKey ? (
              <>
                <Sparkles className="h-4 w-4" />
                {t('onboarding.api-key-card.walk-me-through')}
              </>
            ) : (
              <>
                {t('onboarding.api-key-card.add-key')}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            {t('onboarding.api-key-card.keys-local')}
          </p>
        </CardContent>
      </Card>

      {onSaveKey && (
        <ApiKeyWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          onSaveKey={(provider: WizardProvider, key: string) => onSaveKey(provider as KeyProvider, key)}
        />
      )}
    </div>
  );
}

export default ApiKeySetupCard;

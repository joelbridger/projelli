// src/platform/browserGuard/TabGateOverlay.tsx
//
// QA-15: shown instead of the app shell in a browser tab that lost (or never
// won) the single-writer lock. Mirrors the existing full-screen blocking
// pattern already used for the workspace auto-resume spinner in App.tsx
// (`fixed inset-0 z-50` over a white background) rather than inventing a new
// visual language for "the app isn't usable in this tab yet."

import { useTranslation } from 'react-i18next';
import { AppLogo } from '@/ui/brand/AppLogo';
import { Button } from '@/ui/button';

export function TabGateOverlay({ onTakeOver }: { onTakeOver: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="tab-write-guard-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-white"
    >
      <div className="max-w-sm text-center px-6">
        <AppLogo height={40} />
        <h1 className="mt-6 text-lg font-semibold text-foreground">
          {t('tab-guard.title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('tab-guard.description')}
        </p>
        <Button className="mt-6" onClick={onTakeOver} data-testid="tab-write-guard-take-over">
          {t('tab-guard.take-over')}
        </Button>
      </div>
    </div>
  );
}

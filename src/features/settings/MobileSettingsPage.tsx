/**
 * MobileSettingsPage — Settings → Mobile.
 *
 * Mirrors the public web docs at /docs/mobile-access/ in a compact Settings
 * form. The step-by-step setup stays in the full guide.
 *
 * Stream D1 of the v2.0 mega-release. The dedicated mobile reader (D2) is
 * still in beta; this page documents the cloud-sync workaround that ships
 * the v2.0 mobile story today.
 */

import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { InfoHelp } from '@/ui/InfoHelp';
import { ExternalLink } from 'lucide-react';
import { BRAND } from '@/config/brand';

type ProviderId = 'icloud' | 'dropbox' | 'syncthing' | 'gdrive';

interface ProviderTab {
  id: ProviderId;
  /** Deep link to the provider's iOS / native app, when stable. */
  deepLink?: { href: string };
  /** Web docs URL for the matching long-form guide. */
  docsHref: string;
}

const PROVIDERS: ProviderTab[] = [
  {
    id: 'icloud',
    // Apple's documented Files app deep link. Opens straight into Files.
    deepLink: { href: 'shareddocuments://' },
    docsHref: `${BRAND.urls.mobileDocsBase}/icloud`,
  },
  {
    id: 'dropbox',
    // Documented Dropbox iOS scheme used to open the app.
    deepLink: { href: 'dbapi-2://1/connect' },
    docsHref: `${BRAND.urls.mobileDocsBase}/dropbox`,
  },
  {
    id: 'syncthing',
    docsHref: `${BRAND.urls.mobileDocsBase}/syncthing`,
  },
  {
    id: 'gdrive',
    docsHref: `${BRAND.urls.mobileDocsBase}/google-drive`,
  },
];

export function MobileSettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6" data-testid="mobile-settings-page">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-medium">{t('settings.mobile-page.title')}</h3>
        <InfoHelp
          content={t('settings.mobile-page.description')}
          label={`About ${t('settings.mobile-page.title')}`}
        />
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
        <strong className="text-foreground">{t('settings.mobile-page.heads-up-label')}</strong>{' '}
        {t('settings.mobile-page.heads-up-text')}
      </div>

      <div className="space-y-2">
        {PROVIDERS.map((p) => (
          <section
            key={p.id}
            data-testid={`mobile-panel-${p.id}`}
            className="rounded-md border border-border/60 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h4
                  data-testid={`mobile-tab-${p.id}`}
                  className="text-sm font-semibold text-foreground"
                >
                  {t(`settings.mobile-page.providers.${p.id}.label`)}
                </h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(`settings.mobile-page.providers.${p.id}.guidance`)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
              {p.deepLink && (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  data-testid={`mobile-deeplink-${p.id}`}
                >
                  <a href={p.deepLink.href}>
                    {t(`settings.mobile-page.providers.${p.id}.open-app`)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              )}
              <Button
                asChild
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                data-testid={`mobile-docs-${p.id}`}
              >
                <a href={p.docsHref} target="_blank" rel="noopener noreferrer">
                  {t('settings.mobile-page.full-guide')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default MobileSettingsPage;

/**
 * MobileSettingsPage — Settings → Mobile.
 *
 * Mirrors the public web docs at /docs/mobile-access/ in a more compact form
 * suitable for the Settings modal. Four tabs (iCloud / Dropbox / Syncthing /
 * Google Drive), each rendering a short steps list, key tips, and a deep-link
 * "open" button when a stable iOS scheme is known.
 *
 * Stream D1 of the v2.0 mega-release. The dedicated mobile reader (D2) is
 * still in beta; this page documents the cloud-sync workaround that ships
 * the v2.0 mobile story today.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';
import { Button } from '@/ui/button';
import { InfoHelp } from '@/ui/InfoHelp';
import { ExternalLink } from 'lucide-react';
import { BRAND } from '@/config/brand';

type ProviderId = 'icloud' | 'dropbox' | 'syncthing' | 'gdrive';

interface ProviderTab {
  id: ProviderId;
  label: string;
  /** One-line tagline shown above the steps. */
  tagline: string;
  /** Numbered setup steps. Kept short; the website has the long form. */
  steps: string[];
  /** Bullet caveats / "things to know" list. */
  tips: string[];
  /** Deep link to the provider's iOS / native app, when stable. */
  deepLink?: { href: string; label: string };
  /** Web docs URL for the matching long-form guide. */
  docsHref: string;
}

const PROVIDERS: ProviderTab[] = [
  {
    id: 'icloud',
    label: 'iCloud Drive',
    tagline: 'Easiest path on Apple devices. About 5 minutes.',
    steps: [
      'On your Mac, make sure iCloud Drive is on under System Settings → Apple ID → iCloud.',
      'In Lantern, open File → Open Workspace and pick a folder inside ~/Library/Mobile Documents/com~apple~CloudDocs/. A folder called "Lantern" works well.',
      'Wait for the first sync to finish (watch the cloud icons in Finder).',
      'On your iPhone, open the Files app → Browse → iCloud Drive → Lantern to read your workspace.',
    ],
    tips: [
      'Treat your phone as read-only for now to avoid conflict copies.',
      'Free iCloud tier is 5 GB. A typical Lantern workspace fits easily.',
      'For nicer text file rendering on iPhone, install a reader app like Taio or 1Writer and point it at the same iCloud folder.',
    ],
    // Apple's documented Files app deep link. Opens straight into Files.
    deepLink: { href: 'shareddocuments://', label: 'Open Files on iPhone' },
    docsHref: `${BRAND.urls.mobileDocsBase}/icloud`,
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    tagline: 'Cross-platform. Reliable conflict handling. Works on iOS and Android.',
    steps: [
      'Install Dropbox for desktop from dropbox.com/install if you don\'t already have it.',
      'In Lantern, open File → Open Workspace and pick a folder inside your Dropbox folder.',
      'Wait for the green checkmark next to the folder in Finder / File Explorer.',
      'Install the Dropbox iOS or Android app, sign in, and navigate to the Lantern folder. Tap any .md file.',
    ],
    tips: [
      'Dropbox creates clearly labeled "conflicted copy" files when both devices edit at once. Still cleanest to edit on one at a time.',
      'Free tier is 2 GB. Text files are tiny so this is rarely the bottleneck.',
      'If you use Smart Sync, right-click your Lantern folder and "Make Available Offline" so Lantern can always read from disk.',
    ],
    // Documented Dropbox iOS scheme used to open the app.
    deepLink: { href: 'dbapi-2://1/connect', label: 'Open Dropbox on iPhone' },
    docsHref: `${BRAND.urls.mobileDocsBase}/dropbox`,
  },
  {
    id: 'syncthing',
    label: 'Syncthing',
    tagline: 'Open source, peer-to-peer. Your data stays on your devices.',
    steps: [
      'Install Syncthing on your computer from syncthing.net/downloads. The admin UI opens at http://127.0.0.1:8384.',
      'In Syncthing, add a folder (label "Lantern") pointing at a local path like ~/Lantern-Sync/.',
      'In Lantern, open File → Open Workspace and select that same folder.',
      'On Android: install Syncthing-Fork and pair using your computer\'s device ID. On iPhone: use Möbius Sync (paid) and follow the same pairing flow.',
    ],
    tips: [
      'Both devices must be running Syncthing for files to sync. Sleeping your laptop pauses sync.',
      'iOS does not have an official free Syncthing client. If you don\'t want to pay for Möbius Sync, the iCloud Drive tab is a better fit on iPhone.',
      'For nicer text file rendering on Android, install Markor and open .md files with that.',
    ],
    docsHref: `${BRAND.urls.mobileDocsBase}/syncthing`,
  },
  {
    id: 'gdrive',
    label: 'Google Drive',
    tagline: 'Best on Android. Requires the Google Drive desktop app in "Mirror" mode.',
    steps: [
      'Install Google Drive for desktop from google.com/drive/download. When asked, choose "Mirror files" (not "Stream files"), so a real local copy lives on your hard drive.',
      'In Lantern, open File → Open Workspace and pick a folder inside the mirrored Drive location.',
      'Wait for the green checkmark in Finder / File Explorer.',
      'On Android, open the Google Drive app and navigate to the Lantern folder. On iPhone, install Google Drive for iOS and do the same.',
    ],
    tips: [
      '"Mirror" mode is required. "Stream" mode keeps files cloud-only and Lantern won\'t reliably read them.',
      'Free tier is 15 GB shared across Drive, Gmail, and Photos. Check your overall Google storage isn\'t already full.',
      'On Android, tap a .md file to pick a default reader app once. Markor is a solid free choice.',
    ],
    docsHref: `${BRAND.urls.mobileDocsBase}/google-drive`,
  },
];

export function MobileSettingsPage() {
  const { t } = useTranslation();
  const [active, setActive] = useState<ProviderId>('icloud');

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

      <Tabs
        value={active}
        onValueChange={(v) => {
          setActive(v as ProviderId);
        }}
      >
        <TabsList className="grid w-full grid-cols-4">
          {PROVIDERS.map((p) => (
            <TabsTrigger
              key={p.id}
              value={p.id}
              data-testid={`mobile-tab-${p.id}`}
            >
              {p.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {PROVIDERS.map((p) => (
          <TabsContent
            key={p.id}
            value={p.id}
            data-testid={`mobile-panel-${p.id}`}
            className="space-y-5 pt-4"
          >
            <section>
              <div className="mb-2 flex items-center gap-1.5">
                <h3 className="text-sm font-semibold">{t('settings.mobile-page.setup-steps')}</h3>
                <InfoHelp content={p.tagline} label={`About ${p.label}`} />
              </div>
              <ol className="list-decimal list-inside space-y-2 text-sm text-foreground/90">
                {p.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </section>

            <section>
              <div className="mb-2 flex items-center gap-1.5">
                <h3 className="text-sm font-semibold">{t('settings.mobile-page.things-to-know')}</h3>
                <InfoHelp
                  label={`About ${t('settings.mobile-page.things-to-know')}`}
                  content={
                    <ul className="ml-4 list-disc space-y-1">
                      {p.tips.map((tip, i) => (
                        <li key={i}>{tip}</li>
                      ))}
                    </ul>
                  }
                />
              </div>
            </section>

            <div className="flex flex-wrap gap-2 pt-1">
              {p.deepLink && (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  data-testid={`mobile-deeplink-${p.id}`}
                >
                  <a href={p.deepLink.href}>
                    {p.deepLink.label}
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
                  Full guide
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export default MobileSettingsPage;

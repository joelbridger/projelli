/**
 * PrivacySettings — controls for the two opt-ins offered at first launch.
 *
 *   - Anonymous telemetry: lifecycle events (no PII, no content). Toggle
 *     can be flipped on or off at any time.
 *   - Email updates: the user's address (if they gave one) and the option
 *     to remove themselves. Currently unsubscribe is manual ("reply UNSUB
 *     to any email"); this panel just shows what's been recorded.
 *
 * Designed to be the most boring, transparent screen in the app — the
 * pitch is "you control this, and we tell you exactly what's collected."
 */

import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTelemetryConsent } from '@/hooks/useTelemetryConsent';
import { getInstallId } from '@/utils/installId';
import { DataMapDialog } from '@/components/privacy/DataMapDialog';

export function PrivacySettings() {
  const { t } = useTranslation();
  const { consent, setConsent } = useTelemetryConsent();
  const [dataMapOpen, setDataMapOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{t('settings.privacy.title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t('settings.privacy.description')}
        </p>
      </div>

      {/* WS-C — the data map: a plain-English, printable account of where data
          goes, reachable from Privacy (and from Settings → AI). */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-3">
        <h3 className="text-base font-semibold">{t('settings.privacy.data-map.title')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('settings.privacy.data-map.description')}
        </p>
        <Button
          data-testid="privacy-open-data-map"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setDataMapOpen(true);
          }}
        >
          <MapPin className="h-4 w-4" />
          {t('settings.privacy.data-map.cta')}
        </Button>
      </div>

      <DataMapDialog open={dataMapOpen} onOpenChange={setDataMapOpen} />

      {/* Telemetry opt-in */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-base font-semibold">{t('settings.privacy.telemetry.title')}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {t('settings.privacy.telemetry.description')}
            </p>
          </div>
          <Button
            variant={consent === 'enabled' ? 'default' : 'outline'}
            size="sm"
            onClick={() =>
              setConsent(consent === 'enabled' ? 'disabled' : 'enabled')
            }
            data-testid="privacy-telemetry-toggle"
          >
            {consent === 'enabled'
              ? t('settings.privacy.telemetry.enabled')
              : t('settings.privacy.telemetry.disabled')}
          </Button>
        </div>
        <div className="border-t pt-4 space-y-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{t('settings.privacy.telemetry.what-is-sent')}</p>
          <ul className="space-y-1 ml-4 list-disc">
            <li>
              <Trans
                i18nKey="settings.privacy.telemetry.field-install-id"
                components={{ c: <code /> }}
              />
            </li>
            <li>
              <Trans
                i18nKey="settings.privacy.telemetry.field-app-version"
                components={{ c: <code /> }}
              />
            </li>
            <li>
              <Trans
                i18nKey="settings.privacy.telemetry.field-event"
                components={{ c: <code /> }}
              />
            </li>
            <li>
              <Trans
                i18nKey="settings.privacy.telemetry.field-license-tier"
                components={{ c: <code /> }}
              />
            </li>
          </ul>
          <p>
            <Trans
              i18nKey="settings.privacy.telemetry.endpoint-note"
              components={{ c: <code /> }}
            />
          </p>
          <p>
            <Trans
              i18nKey="settings.privacy.telemetry.install-id-display"
              values={{ id: getInstallId() }}
              components={{ c: <code className="px-1 py-0.5 rounded bg-muted" /> }}
            />
          </p>
        </div>
      </div>

      {/* Email updates note */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-3">
        <h3 className="text-base font-semibold">{t('settings.privacy.email.title')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('settings.privacy.email.intro')}
        </p>
        <p className="text-sm text-muted-foreground">
          <Trans
            i18nKey="settings.privacy.email.unsub"
            components={{ c: <code /> }}
          />
        </p>
      </div>
    </div>
  );
}

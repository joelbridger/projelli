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
import { Button } from '@/ui/button';
import { InfoHelp } from '@/ui/InfoHelp';
import { useTelemetryConsent } from '@/platform/hooks/useTelemetryConsent';
import { useDesignPartnerConsent } from '@/platform/hooks/useDesignPartnerConsent';
import { getInstallId } from '@/platform/utils/installId';
import { DataMapDialog } from '@/platform/privacy/ui/DataMapDialog';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { RetentionSettings } from '@/features/settings/RetentionSettings';

export function PrivacySettings() {
  const { t } = useTranslation();
  const { consent, setConsent } = useTelemetryConsent();
  const { consent: dpConsent, setConsent: setDpConsent } = useDesignPartnerConsent();
  const [dataMapOpen, setDataMapOpen] = useState(false);
  const workspaceRoot = useWorkspaceStore((s) => s.rootPath);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-medium">{t('settings.privacy.title')}</h3>
        <InfoHelp
          content={t('settings.privacy.description')}
          label={`About ${t('settings.privacy.title')}`}
        />
      </div>

      {/* WS-C — a compact doorway to the printable Data Map. */}
      <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
          Data Map
        </span>
        <Button
          data-testid="privacy-open-data-map"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setDataMapOpen(true);
          }}
        >
          {t('settings.privacy.data-map.cta')}
        </Button>
      </div>

      <DataMapDialog open={dataMapOpen} onOpenChange={setDataMapOpen} />

      {/* Wave 4 Track D — per-workspace retention policy for meeting recordings. */}
      {workspaceRoot && (
        <div className="rounded-lg border border-border bg-card p-6">
          <RetentionSettings workspaceRoot={workspaceRoot} />
        </div>
      )}

      {/* Telemetry opt-in */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-semibold">{t('settings.privacy.telemetry.title')}</h3>
              <InfoHelp
                label={`About ${t('settings.privacy.telemetry.title')}`}
                content={
                  <div className="space-y-2">
                    <p>{t('settings.privacy.telemetry.description')}</p>
                    <p className="font-medium">{t('settings.privacy.telemetry.what-is-sent')}</p>
                    <ul className="ml-4 list-disc space-y-1">
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
                }
              />
            </div>
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
      </div>

      {/* Design-partner diagnostics opt-in — strictly optional, structure-only */}
      <div
        className="rounded-lg border border-border bg-card p-6 space-y-4"
        data-testid="privacy-design-partner-card"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-semibold">
                {t('settings.privacy.design-partner.title')}
              </h3>
              <InfoHelp
                label={`About ${t('settings.privacy.design-partner.title')}`}
                content={
                  <div className="space-y-2">
                    <p>{t('settings.privacy.design-partner.description')}</p>
                    <p className="font-medium">{t('settings.privacy.design-partner.what-is-sent')}</p>
                    <ul className="ml-4 list-disc space-y-1">
                      <li>{t('settings.privacy.design-partner.field-features')}</li>
                      <li>{t('settings.privacy.design-partner.field-workflow-id')}</li>
                      <li>{t('settings.privacy.design-partner.field-search-count')}</li>
                      <li>{t('settings.privacy.design-partner.field-install-id')}</li>
                    </ul>
                    <p>
                      <Trans
                        i18nKey="settings.privacy.design-partner.endpoint-note"
                        components={{ c: <code /> }}
                      />
                    </p>
                  </div>
                }
              />
            </div>
          </div>
          <Button
            variant={dpConsent === 'enabled' ? 'default' : 'outline'}
            size="sm"
            onClick={() =>
              setDpConsent(dpConsent === 'enabled' ? 'disabled' : 'enabled')
            }
            data-testid="privacy-design-partner-toggle"
          >
            {dpConsent === 'enabled'
              ? t('settings.privacy.design-partner.enabled')
              : t('settings.privacy.design-partner.disabled')}
          </Button>
        </div>
      </div>

      {/* Email updates note */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-base font-semibold">{t('settings.privacy.email.title')}</h3>
          <InfoHelp
            label={`About ${t('settings.privacy.email.title')}`}
            content={
              <div className="space-y-2">
                <p>{t('settings.privacy.email.intro')}</p>
                <p>
                  <Trans
                    i18nKey="settings.privacy.email.unsub"
                    components={{ c: <code /> }}
                  />
                </p>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}

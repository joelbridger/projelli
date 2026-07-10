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
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { EMAIL_REPLY_AI_CLASSIFICATION_SETTING_KEY } from '@/platform/settings/schema';

export function PrivacySettings() {
  const { t } = useTranslation();
  const { consent, setConsent } = useTelemetryConsent();
  const { consent: dpConsent, setConsent: setDpConsent } = useDesignPartnerConsent();
  const [dataMapOpen, setDataMapOpen] = useState(false);
  const [sharingDetailsOpen, setSharingDetailsOpen] = useState(false);
  const workspaceRoot = useWorkspaceStore((s) => s.rootPath);
  const emailReplyAiClassificationEnabled = useSettingsStore(
    (s) => s.getSetting<boolean>(EMAIL_REPLY_AI_CLASSIFICATION_SETTING_KEY) === true,
  );
  const setSetting = useSettingsStore((s) => s.setSetting);

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

      <div
        className="rounded-lg border border-border bg-card p-5"
        data-testid="privacy-email-reply-ai-classification"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">AI email reply classification</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Off by default. When enabled, Keepance sends the text of authenticated client email replies to your firm&apos;s configured AI provider to help match an onboarding item. Turn this on only when your firm approves that sharing.
            </p>
          </div>
          <Button
            variant={emailReplyAiClassificationEnabled ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setSetting(
                EMAIL_REPLY_AI_CLASSIFICATION_SETTING_KEY,
                !emailReplyAiClassificationEnabled,
              );
            }}
            data-testid="privacy-email-reply-ai-classification-toggle"
          >
            {emailReplyAiClassificationEnabled ? 'Enabled' : 'Off'}
          </Button>
        </div>
      </div>

      {/* Wave 4 Track D — per-workspace retention policy for meeting recordings. */}
      {workspaceRoot && (
        <div className="rounded-lg border border-border bg-card p-6">
          <RetentionSettings workspaceRoot={workspaceRoot} />
        </div>
      )}

      {/* Optional sharing: two opt-ins, one disclosure for the long details. */}
      <div
        className="rounded-lg border border-border bg-card p-5 space-y-4"
        data-testid="privacy-optional-sharing-card"
      >
        <div>
          <h3 className="text-base font-semibold">
            {t('settings.privacy.optional-sharing.title')}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('settings.privacy.optional-sharing.description')}
          </p>
        </div>

        <div className="divide-y divide-border/60">
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t('settings.privacy.telemetry.title')}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
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

          <div
            className="flex items-center justify-between gap-4 py-3"
            data-testid="privacy-design-partner-card"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t('settings.privacy.design-partner.title')}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('settings.privacy.design-partner.description')}
              </p>
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

        <div>
          <button
            type="button"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            data-testid="privacy-sharing-details-toggle"
            aria-expanded={sharingDetailsOpen}
            aria-controls="privacy-sharing-details"
            onClick={() => {
              setSharingDetailsOpen((open) => !open);
            }}
          >
            {t('settings.privacy.optional-sharing.details-label')}
          </button>

          {sharingDetailsOpen && (
            <div
              id="privacy-sharing-details"
              className="mt-3 grid gap-4 rounded-md bg-muted/40 p-4 text-sm text-muted-foreground md:grid-cols-2"
              data-testid="privacy-sharing-details"
            >
              <section className="space-y-2">
                <p className="font-medium text-foreground">
                  {t('settings.privacy.telemetry.what-is-sent')}
                </p>
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
                    components={{ c: <code className="px-1 py-0.5 rounded bg-background" /> }}
                  />
                </p>
              </section>

              <section className="space-y-2">
                <p className="font-medium text-foreground">
                  {t('settings.privacy.design-partner.what-is-sent')}
                </p>
                <p>{t('settings.privacy.design-partner.not-sent')}</p>
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
              </section>
            </div>
          )}
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
        <p className="text-sm text-muted-foreground">
          {t('settings.privacy.email.empty')}
        </p>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BookingPageAvailabilityConsumer } from './availability';
import { BookingPublicPage } from './BookingPublicPage';
import { createHostedBookingLink } from './hostedLink';
import { createLocalBookingImageSource, type BookingPageBranding } from './types';

export interface BookingPageSettingsProps {
  branding: BookingPageBranding;
  availability: BookingPageAvailabilityConsumer;
  pageId?: string | undefined;
  onBrandingChange?: ((next: BookingPageBranding) => void) | undefined;
  onCopyLink?: ((link: string) => void | Promise<void>) | undefined;
}

/**
 * The settings presentation owns only its draft. The enclosing settings owner
 * chooses if and how it persists branding after the feature is mounted.
 */
export function BookingPageSettings({ availability, branding, onBrandingChange, onCopyLink, pageId = 'advisor-booking-page' }: BookingPageSettingsProps) {
  const { t } = useTranslation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [photoSourceError, setPhotoSourceError] = useState(false);
  const hostedLink = createHostedBookingLink({ pageId });

  type BrandingTextField = Exclude<keyof BookingPageBranding, 'advisorPhotoSource'>;
  const update = (field: BrandingTextField, value: string) => {
    onBrandingChange?.({ ...branding, [field]: value });
  };

  const updateAdvisorPhoto = (value: string) => {
    if (value.trim() === '') {
      setPhotoSourceError(false);
      onBrandingChange?.({ ...branding, advisorPhotoSource: undefined });
      return;
    }
    try {
      const advisorPhotoSource = createLocalBookingImageSource(value);
      setPhotoSourceError(false);
      onBrandingChange?.({ ...branding, advisorPhotoSource });
    } catch {
      setPhotoSourceError(true);
    }
  };

  const copyLink = async () => {
    if (!onCopyLink) return;
    setCopied(false);
    try {
      await onCopyLink(hostedLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section data-testid="booking-page-settings" style={{ color: 'var(--kp-navy)' }}>
      <header
        style={{
          alignItems: 'start',
          display: 'flex',
          gap: 16,
          justifyContent: 'space-between',
          marginBottom: 22,
        }}
      >
        <div>
          <span
            style={{
              color: 'var(--color-muted-foreground)',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {t('booking-public-page.settings.eyebrow')}
          </span>
          <h1 style={{ fontSize: 28, margin: '6px 0' }}>{t('booking-public-page.settings.title')}</h1>
          <p style={{ color: 'var(--color-muted-foreground)', margin: 0 }}>{t('booking-public-page.settings.description')}</p>
        </div>
        <div aria-label={t('booking-public-page.settings.actions')} style={{ display: 'flex', gap: 8 }}>
          <button
            data-testid="booking-page-copy-link"
            disabled={!onCopyLink}
            onClick={() => {
              void copyLink().catch(() => {
                setCopied(false);
              });
            }}
            style={{
              ...secondaryButtonStyle,
              ...(!onCopyLink ? disabledButtonStyle : {}),
            }}
            type="button"
          >
            {copied ? t('booking-public-page.settings.copied') : t('booking-public-page.settings.copy-link')}
          </button>
          <button
            data-testid="booking-page-preview-button"
            onClick={() => {
              setPreviewOpen((open) => !open);
            }}
            style={primaryButtonStyle}
            type="button"
          >
            {t('booking-public-page.settings.preview')}
          </button>
        </div>
      </header>

      <div
        data-testid="booking-page-hosted-link-rail"
        style={{
          background: 'var(--color-secondary)',
          border: '1px solid var(--kp-divider)',
          borderRadius: 12,
          marginBottom: 20,
          padding: 16,
        }}
      >
        <strong>{t('booking-public-page.settings.hosted-link')}</strong>
        <code
          data-testid="booking-page-hosted-link"
          style={{
            color: 'var(--kp-accent)',
            display: 'block',
            marginTop: 6,
            overflowWrap: 'anywhere',
          }}
        >
          {hostedLink}
        </code>
        <p
          style={{
            color: 'var(--color-muted-foreground)',
            fontSize: 13,
            marginBottom: 0,
          }}
        >
          {t('booking-public-page.settings.hosted-link-help')}
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gap: 20,
          gridTemplateColumns: 'minmax(300px, 1fr) minmax(300px, 1fr)',
        }}
      >
        <section data-testid="booking-page-branding" style={panelStyle}>
          <h2 style={panelTitleStyle}>{t('booking-public-page.settings.branding-title')}</h2>
          <p style={mutedStyle}>{t('booking-public-page.settings.branding-help')}</p>
          <div style={formGridStyle}>
            <TextField
              label={t('booking-public-page.settings.firm-name')}
              value={branding.firmName}
              onChange={(value) => {
                update('firmName', value);
              }}
            />
            <TextField
              label={t('booking-public-page.settings.firm-mark')}
              value={branding.firmMark}
              onChange={(value) => {
                update('firmMark', value);
              }}
            />
            <TextField
              label={t('booking-public-page.settings.landing-copy')}
              value={branding.landingCopy}
              onChange={(value) => {
                update('landingCopy', value);
              }}
              wide
            />
            <TextField
              label={t('booking-public-page.settings.advisor-name')}
              value={branding.advisorName}
              onChange={(value) => {
                update('advisorName', value);
              }}
            />
            <TextField
              label={t('booking-public-page.settings.advisor-title')}
              value={branding.advisorTitle}
              onChange={(value) => {
                update('advisorTitle', value);
              }}
            />
            <TextField error={photoSourceError ? t('booking-public-page.settings.advisor-photo-local-only') : undefined} label={t('booking-public-page.settings.advisor-photo')} value={branding.advisorPhotoSource ?? ''} onChange={updateAdvisorPhoto} wide />
            <TextField
              label={t('booking-public-page.settings.meeting-title')}
              value={branding.meetingTitle}
              onChange={(value) => {
                update('meetingTitle', value);
              }}
              wide
            />
            <TextField
              label={t('booking-public-page.settings.meeting-details')}
              value={branding.meetingDetails}
              onChange={(value) => {
                update('meetingDetails', value);
              }}
              wide
            />
            <TextAreaField
              label={t('booking-public-page.settings.meeting-description')}
              value={branding.meetingDescription}
              onChange={(value) => {
                update('meetingDescription', value);
              }}
            />
            <TextAreaField
              label={t('booking-public-page.settings.disclosure')}
              value={branding.disclosure}
              onChange={(value) => {
                update('disclosure', value);
              }}
            />
          </div>
        </section>
        <section data-testid="booking-page-settings-preview" style={panelStyle}>
          <span style={{ color: 'var(--kp-accent)', fontSize: 13, fontWeight: 700 }}>{t('booking-public-page.settings.preview-label')}</span>
          <h2 style={panelTitleStyle}>{branding.firmName}</h2>
          <p style={mutedStyle}>{t('booking-public-page.settings.preview-help')}</p>
          <div
            style={{
              border: '1px solid var(--kp-divider)',
              borderRadius: 10,
              overflow: 'hidden',
              transform: 'scale(.92)',
              transformOrigin: 'top left',
              width: '108.7%',
            }}
          >
            <BookingPublicPage availability={availability} branding={branding} />
          </div>
        </section>
      </div>
      {previewOpen ? (
        <div data-testid="booking-page-expanded-preview" style={{ marginTop: 20 }}>
          <BookingPublicPage availability={availability} branding={branding} />
        </div>
      ) : null}
    </section>
  );
}

function TextField({ error, label, onChange, value, wide = false }: { error?: string | undefined; label: string; onChange: (value: string) => void; value: string; wide?: boolean }) {
  return (
    <label style={{ ...(wide ? { gridColumn: '1 / -1' } : {}) }}>
      {label}
      <input
        aria-invalid={Boolean(error)}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        style={inputStyle}
        value={value}
      />
      {error ? (
        <span
          role="alert"
          style={{
            color: 'var(--color-destructive)',
            display: 'block',
            fontSize: 12,
            marginTop: 4,
          }}
        >
          {error}
        </span>
      ) : null}
    </label>
  );
}

function TextAreaField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label style={{ gridColumn: '1 / -1' }}>
      {label}
      <textarea
        onChange={(event) => {
          onChange(event.target.value);
        }}
        style={{ ...inputStyle, minHeight: 72 }}
        value={value}
      />
    </label>
  );
}

const panelStyle = {
  background: 'var(--color-background)',
  border: '1px solid var(--kp-divider)',
  borderRadius: 14,
  padding: 20,
};
const panelTitleStyle = { fontSize: 19, margin: '8px 0' };
const mutedStyle = { color: 'var(--color-muted-foreground)', lineHeight: 1.5 };
const formGridStyle = {
  display: 'grid',
  gap: 14,
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  marginTop: 20,
};
const inputStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  boxSizing: 'border-box' as const,
  display: 'block',
  marginTop: 6,
  padding: 9,
  width: '100%',
};
const secondaryButtonStyle = {
  background: 'var(--color-background)',
  border: '1px solid var(--kp-divider-strong)',
  borderRadius: 8,
  color: 'var(--kp-navy)',
  cursor: 'pointer',
  padding: '9px 12px',
};
const primaryButtonStyle = {
  background: 'var(--kp-navy)',
  border: '1px solid var(--kp-navy)',
  borderRadius: 8,
  color: 'var(--color-primary-foreground)',
  cursor: 'pointer',
  padding: '9px 12px',
};
const disabledButtonStyle = { cursor: 'not-allowed', opacity: 0.55 };

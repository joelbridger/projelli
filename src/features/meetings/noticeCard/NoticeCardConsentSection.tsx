/**
 * Notice Card — the consent-dialog section (additive).
 *
 * Rendered inside the recording consent dialog. When calendar sync found an
 * online meeting happening now, it offers the Notice Card, pre-checked per firm
 * default. For Zoom it also offers the guided "press Zoom's Record button too"
 * self-attest. When nothing was auto-detected, it offers a small manual
 * paste-a-link affordance. Google Meet shows an honest "say it aloud" note (no
 * adapter). It NEVER blocks recording — it's purely an offer.
 */
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { NoticeCardPlatform } from './noticeCardTypes';
import { canAutoJoin } from './noticeCardTypes';

/** Localized platform name, via LITERAL t() keys (the i18n extractor needs to
 *  see them statically — the codebase avoids dynamic t() keys). */
function platformName(t: TFunction, platform: NoticeCardPlatform): string {
  switch (platform) {
    case 'teams':
      return t('meetings.notice-card.platform-teams');
    case 'zoom':
      return t('meetings.notice-card.platform-zoom');
    case 'meet':
      return t('meetings.notice-card.platform-meet');
    default:
      return t('meetings.notice-card.platform-other');
  }
}

export interface NoticeCardConsentSectionProps {
  /** Present when an online meeting was detected to offer the card for. */
  offer?: { platform: NoticeCardPlatform; meetingTitle?: string };
  /** Whether the card toggle is checked (pre-filled per firm setting). */
  checked: boolean;
  onToggle: (checked: boolean) => void;
  /** When set, a manual "paste the meeting link" input is shown (no auto offer). */
  manualUrl?: string;
  onManualUrlChange?: (url: string) => void;
  /** Zoom-only: the guided native-record self-attest checkbox. */
  zoomNativeRecord?: { checked: boolean; onToggle: (checked: boolean) => void };
}

const boxStyle: React.CSSProperties = {
  border: '1px solid var(--kp-border, #e2e6ea)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

export function NoticeCardConsentSection({
  offer,
  checked,
  onToggle,
  manualUrl,
  onManualUrlChange,
  zoomNativeRecord,
}: NoticeCardConsentSectionProps) {
  const { t } = useTranslation();

  // A platform we can't drive a guest join for: honest fallback, no toggle.
  // Google Meet has its own reason (needs a signed-in account); any other
  // unknown link (Webex, etc.) gets a generic message so we never state the
  // wrong reason.
  if (offer && !canAutoJoin(offer.platform)) {
    const isMeet = offer.platform === 'meet';
    return (
      <div data-testid={isMeet ? 'notice-card-meet-fallback' : 'notice-card-unsupported-fallback'} style={boxStyle}>
        <span style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--kp-navy)' }}>
          {isMeet ? t('meetings.notice-card.meet-fallback') : t('meetings.notice-card.unsupported-fallback')}
        </span>
      </div>
    );
  }

  if (offer) {
    const platform = platformName(t, offer.platform);
    const tag = offer.meetingTitle ? `${offer.meetingTitle} · ${platform}` : platform;
    return (
      <div data-testid="notice-card-offer" style={boxStyle}>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 'var(--kp-font-sm)' }}>
          <input
            type="checkbox"
            data-testid="notice-card-toggle"
            checked={checked}
            onChange={(e) => {
              onToggle(e.target.checked);
            }}
          />
          <span>
            <span style={{ fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
              {t('meetings.notice-card.offer-label')}
            </span>{' '}
            <span data-testid="notice-card-offer-tag" style={{ color: 'var(--color-muted-foreground)' }}>
              {tag}
            </span>
          </span>
        </label>
        <span style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
          {t('meetings.notice-card.offer-explain')}
        </span>
        {offer.platform === 'zoom' && zoomNativeRecord && (
          <label
            data-testid="notice-card-zoom-native"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 'var(--kp-font-xs)', marginTop: 2 }}
          >
            <input
              type="checkbox"
              data-testid="notice-card-zoom-native-toggle"
              checked={zoomNativeRecord.checked}
              onChange={(e) => {
                zoomNativeRecord.onToggle(e.target.checked);
              }}
            />
            <span style={{ color: 'var(--kp-navy)' }}>{t('meetings.notice-card.zoom-native-label')}</span>
          </label>
        )}
      </div>
    );
  }

  // No auto-detected meeting: optional manual paste.
  if (onManualUrlChange) {
    return (
      <div data-testid="notice-card-manual" style={boxStyle}>
        <label style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--kp-navy)' }}>
          {t('meetings.notice-card.manual-label')}
        </label>
        <input
          type="url"
          data-testid="notice-card-manual-input"
          value={manualUrl ?? ''}
          onChange={(e) => {
            onManualUrlChange(e.target.value);
          }}
          placeholder={t('meetings.notice-card.manual-placeholder')}
          style={{
            fontSize: 'var(--kp-font-sm)',
            padding: '6px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--kp-border, #e2e6ea)',
          }}
        />
      </div>
    );
  }

  return null;
}

export default NoticeCardConsentSection;

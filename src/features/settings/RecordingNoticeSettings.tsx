/**
 * Recording Notice Kit — the firm-level notice settings control (AI & Privacy).
 *
 * Two things:
 *   - the notification policy dial (Standard / Strict), shown as selectable
 *     cards with a gentle "recommend Strict for all-party-consent states" line
 *     (a recommendation, never an override — the app doesn't know the advisor's
 *     state, so this is conditional);
 *   - the firm-customizable spoken-notice script (blank = built-in wording).
 *
 * Light-theme first, to match the rest of Settings.
 */
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { useNoticeSettings, type NoticePolicy } from '@/features/meetings/noticeSettings';
import { saveRecordingBackgroundImage } from '@/features/meetings/noticeCard/recordingBackground';

const CARD_VALUES: NoticePolicy[] = ['standard', 'strict'];

export function RecordingNoticeSettings() {
  const { t } = useTranslation();
  const setSetting = useSettingsStore((s) => s.setSetting);
  // Subscribe to the actual values so the picker + textarea reflect changes
  // immediately (codex-review R3).
  const { policy, rawScript: script } = useNoticeSettings();

  // Literal t() keys (kept out of a lookup so the i18n extractor sees them).
  const cardTitle = (value: NoticePolicy) =>
    value === 'strict' ? t('meetings.notice.settings-strict-title') : t('meetings.notice.settings-standard-title');
  const cardDesc = (value: NoticePolicy) =>
    value === 'strict' ? t('meetings.notice.settings-strict-desc') : t('meetings.notice.settings-standard-desc');

  return (
    <div data-testid="recording-notice-settings" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)' }}>
      <div style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
        {t('meetings.notice.settings-policy-heading')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)' }}>
        {CARD_VALUES.map((value) => {
          const selected = policy === value;
          return (
            <button
              key={value}
              type="button"
              data-testid={`notice-policy-${value}`}
              aria-pressed={selected}
              onClick={() => { setSetting('meetings.noticePolicy', value); }}
              style={{
                textAlign: 'left',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                border: `1px solid ${selected ? 'var(--kp-accent)' : 'var(--kp-divider)'}`,
                background: selected ? 'var(--kp-accent-soft)' : 'transparent',
                borderRadius: 'var(--radius-md)',
                padding: '10px 12px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 18,
                  height: 18,
                  flex: 'none',
                  marginTop: 1,
                  borderRadius: 999,
                  border: `2px solid ${selected ? 'var(--kp-accent)' : 'var(--kp-divider)'}`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--kp-accent)',
                }}
              >
                {selected && <Check style={{ width: 12, height: 12 }} />}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
                  {cardTitle(value)}
                </span>
                <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
                  {cardDesc(value)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', margin: 0 }}>
        {t('meetings.notice.settings-strict-recommend')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="notice-script-input" style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
          {t('meetings.notice.settings-script-heading')}
        </label>
        <textarea
          id="notice-script-input"
          data-testid="notice-script-input"
          value={script}
          onChange={(e) => { setSetting('meetings.noticeScript', e.target.value); }}
          placeholder={t('meetings.notice.settings-script-placeholder')}
          rows={3}
          style={{
            fontSize: 'var(--kp-font-sm)',
            fontFamily: 'inherit',
            color: 'var(--kp-navy)',
            border: '1px solid var(--kp-divider)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 10px',
            resize: 'vertical',
          }}
        />
        <p style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)', margin: 0 }}>
          {t('meetings.notice.settings-script-default-label')} “{t('meetings.notice.default-script')}”
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
          {t('meetings.notice-card.save-bg-heading')}
        </span>
        <p style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)', margin: 0 }}>
          {t('meetings.notice-card.save-bg-help')}
        </p>
        <button
          type="button"
          data-testid="save-recording-background"
          onClick={() => {
            void saveRecordingBackgroundImage(t('meetings.notice-card.bg-label'));
          }}
          style={{
            alignSelf: 'flex-start',
            fontSize: 'var(--kp-font-xs)',
            fontWeight: 'var(--kp-weight-medium)',
            color: 'var(--kp-navy)',
            background: 'transparent',
            border: '1px solid var(--kp-divider)',
            borderRadius: 999,
            padding: '6px 12px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {t('meetings.notice-card.save-bg-button')}
        </button>
      </div>
    </div>
  );
}

export default RecordingNoticeSettings;

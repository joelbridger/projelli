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
import { InfoHelp } from '@/ui/InfoHelp';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { getSettingDef } from '@/platform/settings/schema';
import { useNoticeSettings, type NoticePolicy } from '@/features/meetings/noticeSettings';
import { saveRecordingBackgroundImage } from '@/features/meetings/noticeCard/recordingBackground';

const CARD_VALUES: NoticePolicy[] = ['standard', 'strict'];

export function RecordingNoticeSettings() {
  const { t } = useTranslation();
  const setSetting = useSettingsStore((s) => s.setSetting);
  // Subscribe to the actual values so the picker + textarea reflect changes
  // immediately (codex-review R3).
  const { policy, rawScript: script } = useNoticeSettings();
  // Notice Card settings (subscribed so the controls reflect changes live).
  const cardEnabled = useSettingsStore((s) => s.getSetting('meetings.noticeCardEnabled')) !== false;
  const cardNameRaw = useSettingsStore((s) => s.getSetting('meetings.noticeCardNameTemplate'));
  const cardName = typeof cardNameRaw === 'string' ? cardNameRaw : '';
  const evidenceRule = useSettingsStore((s) => s.getSetting('meetings.noticeEvidenceRule')) === 'both' ? 'both' : 'either';
  const noticeCardHelp = getSettingDef('meetings.noticeCardEnabled')?.description ?? '';
  const noticeCardNameHelp = getSettingDef('meetings.noticeCardNameTemplate')?.description ?? '';
  const evidenceHelp = getSettingDef('meetings.noticeEvidenceRule')?.description ?? '';

  // Literal t() keys (kept out of a lookup so the i18n extractor sees them).
  const cardTitle = (value: NoticePolicy) =>
    value === 'strict' ? t('meetings.notice.settings-strict-title') : t('meetings.notice.settings-standard-title');
  const cardDesc = (value: NoticePolicy) =>
    value === 'strict' ? t('meetings.notice.settings-strict-desc') : t('meetings.notice.settings-standard-desc');

  return (
    <div data-testid="recording-notice-settings" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
          {t('meetings.notice.settings-policy-heading')}
        </span>
        <InfoHelp
          content={t('meetings.notice.settings-strict-recommend')}
          label={`About ${t('meetings.notice.settings-policy-heading')}`}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)' }}>
        {CARD_VALUES.map((value) => {
          const selected = policy === value;
          return (
            <div
              key={value}
              style={{
                position: 'relative',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                border: `1px solid ${selected ? 'var(--kp-accent)' : 'var(--kp-divider)'}`,
                background: selected ? 'var(--kp-accent-soft)' : 'transparent',
                borderRadius: 'var(--radius-md)',
                padding: '10px 12px',
                fontFamily: 'inherit',
              }}
            >
              <button
                type="button"
                data-testid={`notice-policy-${value}`}
                aria-pressed={selected}
                aria-label={cardTitle(value)}
                onClick={() => { setSetting('meetings.noticePolicy', value); }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  border: 0,
                  borderRadius: 'var(--radius-md)',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              />
              <span
                aria-hidden="true"
                style={{
                  position: 'relative',
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
                  pointerEvents: 'none',
                }}
              >
                {selected && <Check style={{ width: 12, height: 12 }} />}
              </span>
              <span style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2, pointerEvents: 'none' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
                  {cardTitle(value)}
                  <InfoHelp
                    className="pointer-events-auto"
                    content={cardDesc(value)}
                    label={`About ${cardTitle(value)}`}
                  />
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label htmlFor="notice-script-input" style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
            {t('meetings.notice.settings-script-heading')}
          </label>
          <InfoHelp
            content={`${t('meetings.notice.settings-script-default-label')} “${t('meetings.notice.default-script')}”`}
            label={`About ${t('meetings.notice.settings-script-heading')}`}
          />
        </div>
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
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
            {t('meetings.notice-card.settings-heading')}
          </span>
          <InfoHelp
            content={noticeCardHelp}
            label={`About ${t('meetings.notice-card.settings-heading')}`}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--kp-font-sm)', color: 'var(--kp-navy)' }}>
          <input
            id="notice-card-enabled"
            type="checkbox"
            data-testid="notice-card-enabled"
            checked={cardEnabled}
            onChange={(e) => { setSetting('meetings.noticeCardEnabled', e.target.checked); }}
          />
          <label htmlFor="notice-card-enabled" style={{ cursor: 'pointer' }}>
            {t('meetings.notice-card.settings-enabled-label')}
          </label>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--kp-font-xs)', color: 'var(--kp-navy)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label htmlFor="notice-card-name-template">
              {t('meetings.notice-card.settings-name-label')}
            </label>
            <InfoHelp
              content={noticeCardNameHelp}
              label={`About ${t('meetings.notice-card.settings-name-label')}`}
            />
          </span>
          <input
            id="notice-card-name-template"
            type="text"
            data-testid="notice-card-name-template"
            value={cardName}
            placeholder="⏺ Recording Notice — {advisor}"
            onChange={(e) => { setSetting('meetings.noticeCardNameTemplate', e.target.value); }}
            style={{
              fontSize: 'var(--kp-font-sm)',
              fontFamily: 'inherit',
              color: 'var(--kp-navy)',
              border: '1px solid var(--kp-divider)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 10px',
            }}
          />
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--kp-font-xs)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)', marginTop: 2 }}>
          <span>{t('meetings.notice-card.settings-evidence-label')}</span>
          <InfoHelp
            content={evidenceHelp}
            label={`About ${t('meetings.notice-card.settings-evidence-label')}`}
          />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(['either', 'both'] as const).map((value) => {
            const selected = evidenceRule === value;
            return (
              <button
                key={value}
                type="button"
                data-testid={`notice-evidence-${value}`}
                aria-pressed={selected}
                onClick={() => { setSetting('meetings.noticeEvidenceRule', value); }}
                style={{
                  textAlign: 'left',
                  border: `1px solid ${selected ? 'var(--kp-accent)' : 'var(--kp-divider)'}`,
                  background: selected ? 'var(--kp-accent-soft)' : 'transparent',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 10px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 'var(--kp-font-sm)',
                  color: 'var(--kp-navy)',
                }}
              >
                {value === 'both'
                  ? t('meetings.notice-card.settings-evidence-both')
                  : t('meetings.notice-card.settings-evidence-either')}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
          <span>{t('meetings.notice-card.save-bg-heading')}</span>
          <InfoHelp
            content={t('meetings.notice-card.save-bg-help')}
            label={`About ${t('meetings.notice-card.save-bg-heading')}`}
          />
        </span>
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

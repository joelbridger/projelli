/**
 * CalendarWritePendingBanner — a slim dark-gated banner noting that calendar
 * writes are waiting for review. Flag-checked first; when dark it returns null
 * before the container hook runs, so it reads nothing and touches nothing.
 * Inert when there is nothing pending.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useFlag } from '@/platform/flags';
import { useCalendarWrite } from '../useCalendarWrite';

export interface CalendarWritePendingBannerProps {
  onReviewNow: () => void;
}

export function CalendarWritePendingBanner(props: CalendarWritePendingBannerProps): ReactElement | null {
  const enabled = useFlag('calendar-write');
  if (!enabled) return null;
  return <CalendarWritePendingBannerEnabled {...props} />;
}

function CalendarWritePendingBannerEnabled({ onReviewNow }: CalendarWritePendingBannerProps): ReactElement | null {
  const { t } = useTranslation();
  const { pendingCount } = useCalendarWrite();
  if (pendingCount === 0) return null;

  return (
    <button
      type="button"
      data-testid="calendar-write-pending-banner"
      onClick={onReviewNow}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--kp-space-xs)',
        width: '100%',
        textAlign: 'left',
        background: 'var(--kp-accent-softer)',
        border: '1px solid var(--kp-accent-soft)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--kp-card-pad)',
        color: 'var(--kp-navy)',
        fontSize: 'var(--kp-font-sm)',
        fontWeight: 'var(--kp-weight-semibold)',
        cursor: 'pointer',
      }}
    >
      <span>{t('calendar-write.pending-banner', { count: pendingCount })}</span>
      <span data-testid="calendar-write-pending-banner-review-now" style={{ marginLeft: 'auto', color: 'var(--kp-accent)' }}>
        {t('calendar-write.review-now')}
      </span>
    </button>
  );
}

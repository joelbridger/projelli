/**
 * CrmWritePendingBanner — slim hub-chrome presence banner for a pending
 * Wealthbox review.
 *
 * QA finding (P2): CrmWriteReviewCard only ever mounted inside the Overview
 * sub-tab, so an advisor sitting on Documents/Email/Activity never saw that
 * a proposal was waiting for approval. This renders above the active
 * sub-tab panel on every OTHER sub-tab (Overview already shows the full
 * card) — a count + a "Review now" jump back to it. Renders nothing when
 * there is nothing pending, or while on Overview itself.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, ChevronRight } from 'lucide-react';
import { useVisibleCrmWriteQueueItems } from '@/platform/state/crmWriteQueueStore';

export interface CrmWritePendingBannerProps {
  matterId: string;
  onReviewNow: () => void;
}

export function CrmWritePendingBanner({ matterId, onReviewNow }: CrmWritePendingBannerProps) {
  const { t } = useTranslation();
  const allItems = useVisibleCrmWriteQueueItems();
  const pendingCount = useMemo(
    () => allItems.filter((i) => i.matterId === matterId && i.status !== 'sent').length,
    [allItems, matterId],
  );

  if (pendingCount === 0) return null;

  return (
    <div style={{ padding: 'var(--kp-surface-gap) var(--kp-gutter) 0' }}>
      <button
        type="button"
        data-testid="hub-crm-pending-banner"
        onClick={onReviewNow}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: 'var(--kp-space-xs) var(--kp-card-pad)',
          border: '1px solid var(--kp-accent-soft, #e0e7ff)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--kp-accent-softer, #f5f7ff)',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'Satoshi, sans-serif',
        }}
      >
        <Sparkles size={15} strokeWidth={2} color="var(--kp-navy)" />
        <span style={{ flex: 1, fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
          {t('matter.crm-review.pending-banner', { count: pendingCount })}
        </span>
        <span
          data-testid="hub-crm-pending-banner-review-now"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 'var(--kp-font-2xs)',
            fontWeight: 'var(--kp-weight-bold)',
            color: 'var(--kp-accent, var(--kp-navy))',
            flexShrink: 0,
          }}
        >
          {t('matter.crm-review.review-now')}
          <ChevronRight size={14} strokeWidth={2} />
        </span>
      </button>
    </div>
  );
}

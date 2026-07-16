/**
 * CalendarWriteReviewCard — the dark, flag-gated review/approval surface for a
 * two-way calendar write.
 *
 * The flag is checked FIRST, in the wrapper, and when the surface is dark the
 * wrapper returns null before the container hook runs — so nothing reads the
 * store, nothing loads a grant, nothing touches egress. Every side-effecting
 * hook lives in the `...Enabled` child, which only mounts when the flag is on.
 *
 * A booking is only ever confirmed by a verified provider receipt. This card
 * shows prepared and in-flight proposals and offers an explicit Approve; it
 * never presents a prepared or pending proposal as a confirmation.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Button } from '@/ui/kp';
import { useFlag } from '@/platform/flags';
import { useCalendarWrite } from '../useCalendarWrite';
import type { CalendarWriteProposal } from '../types';

export function CalendarWriteReviewCard(): ReactElement | null {
  const enabled = useFlag('calendar-write');
  if (!enabled) return null;
  return <CalendarWriteReviewCardEnabled />;
}

function statusLabelKey(status: CalendarWriteProposal['status']): string {
  switch (status) {
    case 'prepared':
      return 'calendar-write.review.status.prepared';
    case 'verify_pending':
      return 'calendar-write.review.status.verify-pending';
    case 'verified':
      return 'calendar-write.review.status.verified';
    case 'failed':
      return 'calendar-write.review.status.failed';
    case 'refused':
      return 'calendar-write.review.status.refused';
    default:
      return 'calendar-write.review.status.prepared';
  }
}

function CalendarWriteReviewCardEnabled(): ReactElement | null {
  const { t } = useTranslation();
  const { proposals, approve } = useCalendarWrite();

  const reviewable = proposals.filter(
    (p) => p.status === 'prepared' || p.status === 'verify_pending',
  );
  if (reviewable.length === 0) return null;

  return (
    <Card>
      <div
        data-testid="calendar-write-review-card"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)', padding: 'var(--kp-card-pad)' }}
      >
        <div
          style={{
            fontSize: 'var(--kp-font-sm)',
            fontWeight: 'var(--kp-weight-semibold)',
            color: 'var(--kp-navy)',
          }}
        >
          {t('calendar-write.review.title')}
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-xs)' }}>
          {reviewable.map((proposal) => (
            <li
              key={proposal.id}
              data-testid="calendar-write-review-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--kp-space-sm)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--kp-space-sm)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--kp-navy)' }}>
                  {proposal.event.title}
                </span>
                <span style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
                  {t(statusLabelKey(proposal.status))}
                </span>
              </div>
              {proposal.status === 'prepared' ? (
                <Button
                  data-testid="calendar-write-approve"
                  onClick={() => {
                    // eslint-disable-next-line lantern-async/no-silent-failure -- The approval outcome is re-read by refresh() inside approve(); a rejected promise leaves the proposal in its prior state (fail-closed), and the row simply stays for another attempt.
                    approve(proposal.id).catch(() => {});
                  }}
                >
                  {t('calendar-write.review.approve')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

import { useEffect, useState, type ReactNode } from 'react';

import { useIntakeStore } from '@/platform/intake/intakeStore';
import type { OnboardingRow, RequestRow } from '@/platform/intake/onboardingModel';
import { emailReplyProposalList } from '@/platform/intake/emailReplyProposalStore';
import { listEmailQuarantines } from '@/platform/intake/emailQuarantineStore';
import { RequestsBoard, type RequestsBoardFilter } from './RequestsBoard';
import { renderLinkSignalBadges } from './renderLinkSignalBadges';
import { NudgeDraftCard } from './NudgeDraftCard';
import { NudgeReviewModal } from './NudgeReviewModal';
import { EmailReplyProposalBanner } from './EmailReplyProposalBanner';
import { EmailReplyQuarantineBanner } from './EmailReplyQuarantineBanner';
import { EmailReplyQuarantinePanel } from './EmailReplyQuarantinePanel';

export interface RequestsBoardContainerProps {
  onNewClient?: () => void;
  advisorId?: string;
  now?: Date;
  filter?: RequestsBoardFilter;
  testId?: string;
  title?: string;
}

/** Board composition remains metadata-only: reply counts are request ids, never facts. */
export function RequestsBoardContainer({
  onNewClient,
  advisorId = 'advisor',
  now,
  filter,
  testId,
  title,
}: RequestsBoardContainerProps) {
  const intakesById = useIntakeStore((state) => state.intakesById);
  const [reviewRow, setReviewRow] = useState<OnboardingRow | null>(null);
  const [emailReplyCounts, setEmailReplyCounts] = useState<Record<string, number>>({});
  const [quarantineCounts, setQuarantineCounts] = useState<Record<string, number>>({});
  const [unmatchedQuarantineCount, setUnmatchedQuarantineCount] = useState(0);
  const reviewIntake = reviewRow ? intakesById[reviewRow.requestId] : undefined;

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void Promise.all([emailReplyProposalList(), listEmailQuarantines()])
        .then(([proposals, quarantines]) => {
          if (cancelled) return;
          const proposalCounts: Record<string, number> = {};
          for (const proposal of proposals) {
            proposalCounts[proposal.matchedRequestId] = (proposalCounts[proposal.matchedRequestId] ?? 0) + 1;
          }
          const nextQuarantineCounts: Record<string, number> = {};
          let unmatchedCount = 0;
          for (const quarantine of quarantines) {
            if (!quarantine.matchedRequestId) {
              unmatchedCount += 1;
              continue;
            }
            nextQuarantineCounts[quarantine.matchedRequestId] = (nextQuarantineCounts[quarantine.matchedRequestId] ?? 0) + 1;
          }
          setEmailReplyCounts(proposalCounts);
          setQuarantineCounts(nextQuarantineCounts);
          setUnmatchedQuarantineCount(unmatchedCount);
        })
        .catch((error: unknown) => {
          console.warn('[RequestsBoardContainer] Could not load email reply proposals:', error);
        });
    };
    load();
    const interval = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <>
      <RequestsBoard
        {...(onNewClient ? { onNewClient } : {})}
        {...(now ? { now } : {})}
        {...(filter ? { filter } : {})}
        {...(testId ? { testId } : {})}
        {...(title ? { title } : {})}
        renderLinkSignals={renderLinkSignalBadges as (row: RequestRow) => ReactNode}
        renderEmailReplySignals={(row: RequestRow) => (
          <>
            <EmailReplyProposalBanner count={emailReplyCounts[row.requestId] ?? 0} />
            <EmailReplyQuarantineBanner count={quarantineCounts[row.requestId] ?? 0} />
          </>
        )}
        onOpenNudge={(row: RequestRow) => {
          if (row.kind === 'onboarding') setReviewRow(row as OnboardingRow);
        }}
        renderNudgeSlot={(row: RequestRow) => {
          const intake = intakesById[row.requestId];
          if (!intake) return null;
          if (row.kind !== 'onboarding') {
            return <span data-testid={`requests-board-nudge-state-${row.requestId}`}>Nudge {row.nudgeEligibility.reason.replaceAll('_', ' ')}</span>;
          }
          return (
            <NudgeDraftCard
              row={row as OnboardingRow}
              intake={intake}
              {...(now ? { now } : {})}
              onOpenReview={() => { setReviewRow(row as OnboardingRow); }}
            />
          );
        }}
      />
      {unmatchedQuarantineCount > 0 ? (
        <section data-testid="unmatched-email-reply-quarantines" style={{ display: 'grid', gap: 8, padding: 12 }}>
          <EmailReplyQuarantineBanner count={unmatchedQuarantineCount} />
          <EmailReplyQuarantinePanel advisorId={advisorId} unmatchedOnly />
        </section>
      ) : null}
      {reviewRow && reviewIntake ? (
        <NudgeReviewModal
          open
          row={reviewRow}
          intake={reviewIntake}
          {...(now ? { now } : {})}
          onOpenChange={(open) => { if (!open) setReviewRow(null); }}
        />
      ) : null}
    </>
  );
}

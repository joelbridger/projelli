/**
 * OnboardingBoardContainer — the lead's cross-lane seam that stitches the
 * three Wave-2 lanes together on one surface:
 *   - Lane 1 OnboardingBoard (the list),
 *   - Lane 2 link-signal badges (renderLinkSignalBadges), and
 *   - Lane 3 nudge card + review modal.
 *
 * The board deals in OnboardingRow (labels/ids only). The nudge card/modal need
 * the full IntakeRecord, resolved here from the store by request id. Modal open
 * state lives here so a single modal serves whichever row the advisor opens.
 */
import { useEffect, useState } from 'react';

import { useIntakeStore } from '@/platform/intake/intakeStore';
import type { OnboardingRow } from '@/platform/intake/onboardingModel';
import { emailReplyProposalList } from '@/platform/intake/emailReplyProposalStore';
import { listEmailQuarantines } from '@/platform/intake/emailQuarantineStore';
import { OnboardingBoard } from './OnboardingBoard';
import { renderLinkSignalBadges } from './renderLinkSignalBadges';
import { NudgeDraftCard } from './NudgeDraftCard';
import { NudgeReviewModal } from './NudgeReviewModal';
import { EmailReplyProposalBanner } from './EmailReplyProposalBanner';
import { EmailReplyQuarantineBanner } from './EmailReplyQuarantineBanner';
import { EmailReplyQuarantinePanel } from './EmailReplyQuarantinePanel';

export interface OnboardingBoardContainerProps {
  onNewClient?: () => void;
  advisorId?: string;
  /** Test seam: a fixed clock so eligibility/draft output is deterministic. */
  now?: Date;
}

export function OnboardingBoardContainer({
  onNewClient,
  advisorId = 'advisor',
  now,
}: OnboardingBoardContainerProps) {
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
          const counts: Record<string, number> = {};
          for (const proposal of proposals) {
            counts[proposal.matchedMatterId] =
              (counts[proposal.matchedMatterId] ?? 0) + 1;
          }
          setEmailReplyCounts(counts);
          const quarantineNext: Record<string, number> = {};
          let unmatchedCount = 0;
          for (const quarantine of quarantines) {
            if (!quarantine.matchedMatterId) {
              unmatchedCount += 1;
              continue;
            }
            quarantineNext[quarantine.matchedMatterId] = (quarantineNext[quarantine.matchedMatterId] ?? 0) + 1;
          }
          setQuarantineCounts(quarantineNext);
          setUnmatchedQuarantineCount(unmatchedCount);
        })
        .catch((error: unknown) => {
          console.warn('[OnboardingBoardContainer] Could not load email reply proposals:', error);
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
      <OnboardingBoard
        {...(onNewClient ? { onNewClient } : {})}
        {...(now ? { now } : {})}
        renderLinkSignals={renderLinkSignalBadges}
        renderEmailReplySignals={(row) => (
          <><EmailReplyProposalBanner count={emailReplyCounts[row.matterId] ?? 0} /><EmailReplyQuarantineBanner count={quarantineCounts[row.matterId] ?? 0} /></>
        )}
        onOpenNudge={(row) => {
          setReviewRow(row);
        }}
        renderNudgeSlot={(row) => {
          const intake = intakesById[row.requestId];
          if (!intake) return null;
          return (
            <NudgeDraftCard
              row={row}
              intake={intake}
              {...(now ? { now } : {})}
              onOpenReview={() => {
                setReviewRow(row);
              }}
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
          onOpenChange={(open) => {
            if (!open) setReviewRow(null);
          }}
        />
      ) : null}
    </>
  );
}

export default OnboardingBoardContainer;

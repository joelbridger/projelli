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
import { useState } from 'react';

import { useIntakeStore } from '@/platform/intake/intakeStore';
import type { OnboardingRow } from '@/platform/intake/onboardingModel';
import { OnboardingBoard } from './OnboardingBoard';
import { renderLinkSignalBadges } from './renderLinkSignalBadges';
import { NudgeDraftCard } from './NudgeDraftCard';
import { NudgeReviewModal } from './NudgeReviewModal';

export interface OnboardingBoardContainerProps {
  onNewClient?: () => void;
  /** Test seam: a fixed clock so eligibility/draft output is deterministic. */
  now?: Date;
}

export function OnboardingBoardContainer({
  onNewClient,
  now,
}: OnboardingBoardContainerProps) {
  const intakesById = useIntakeStore((state) => state.intakesById);
  const [reviewRow, setReviewRow] = useState<OnboardingRow | null>(null);

  const reviewIntake = reviewRow ? intakesById[reviewRow.requestId] : undefined;

  return (
    <>
      <OnboardingBoard
        {...(onNewClient ? { onNewClient } : {})}
        {...(now ? { now } : {})}
        renderLinkSignals={renderLinkSignalBadges}
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

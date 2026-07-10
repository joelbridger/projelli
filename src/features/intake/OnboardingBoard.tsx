import type { ReactNode } from 'react';
import type { OnboardingRow } from '@/platform/intake/onboardingModel';
import { RequestsBoard } from './RequestsBoard';

/** Legacy entry point: the original board is now one true filter of Requests. */
export interface OnboardingBoardProps {
  now?: Date;
  onNewClient?: () => void;
  onOpenNudge?: (row: OnboardingRow) => void;
  onOpenLinkSignals?: (row: OnboardingRow) => void;
  onReviewItems?: (row: OnboardingRow) => void;
  onCopyLink?: (row: OnboardingRow) => Promise<void> | void;
  renderNudgeSlot?: (row: OnboardingRow) => ReactNode;
  renderLinkSignals?: (row: OnboardingRow) => ReactNode;
  renderEmailReplySignals?: (row: OnboardingRow) => ReactNode;
}

export function OnboardingBoard(props: OnboardingBoardProps) {
  return <RequestsBoard
    {...(props.now ? { now: props.now } : {})}
    {...(props.onNewClient ? { onNewClient: props.onNewClient } : {})}
    {...(props.onOpenNudge ? { onOpenNudge: props.onOpenNudge as (row: import('@/platform/intake/onboardingModel').RequestRow) => void } : {})}
    {...(props.onOpenLinkSignals ? { onOpenLinkSignals: props.onOpenLinkSignals as (row: import('@/platform/intake/onboardingModel').RequestRow) => void } : {})}
    {...(props.onReviewItems ? { onReviewItems: props.onReviewItems as (row: import('@/platform/intake/onboardingModel').RequestRow) => void } : {})}
    {...(props.onCopyLink ? { onCopyLink: props.onCopyLink as (row: import('@/platform/intake/onboardingModel').RequestRow) => Promise<void> | void } : {})}
    {...(props.renderNudgeSlot ? { renderNudgeSlot: props.renderNudgeSlot as (row: import('@/platform/intake/onboardingModel').RequestRow) => ReactNode } : {})}
    {...(props.renderLinkSignals ? { renderLinkSignals: props.renderLinkSignals as (row: import('@/platform/intake/onboardingModel').RequestRow) => ReactNode } : {})}
    {...(props.renderEmailReplySignals ? { renderEmailReplySignals: props.renderEmailReplySignals as (row: import('@/platform/intake/onboardingModel').RequestRow) => ReactNode } : {})}
    filter="onboarding"
    testId="onboarding-board"
    title="Onboarding"
  />;
}

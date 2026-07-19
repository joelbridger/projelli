/* eslint-disable react-refresh/only-export-components -- the production CRM port is deliberately colocated with its only mounted bridge */
import { useCallback, useEffect, useState } from 'react';
import {
  crmApproveWriteProposal,
  crmIsConnected,
  crmPrepareWriteProposal,
  crmSaveWriteProposal,
} from '@/platform/utils/wealthbox-commands';
import { NotesReviewPanel } from '@/ui/NotesReviewPanel';
import type {
  ExactMeetingNotesReviewItem,
  ExactMeetingReviewKind,
  NotesReviewClientPair,
  NotesReviewPanelState,
  NotesReviewReceipt,
} from '@/ui/notesReview';
import type {
  ExactMeetingNotesReviewRepository,
  NotesReviewCrmDelivery,
} from './notesReviewDelivery';

/** Production CRM writes still pass through the Rust proposal/approval path. */
export const productionMeetingNotesReviewCrmDelivery: NotesReviewCrmDelivery = {
  isConnected: () => crmIsConnected('wealthbox'),
  saveProposal: (proposal) => crmSaveWriteProposal(proposal),
  prepareProposal: (args) => crmPrepareWriteProposal(args),
  approveProposal: (proposalId) => crmApproveWriteProposal(proposalId),
};

export interface MeetingNotesReviewProps<
  Client extends NotesReviewClientPair = NotesReviewClientPair,
> {
  readonly reviewKind: ExactMeetingReviewKind;
  readonly repository: ExactMeetingNotesReviewRepository<Client> | null;
  readonly blockedReason?: string;
}

/**
 * Loads one exact-meeting destination and preserves every visible state. A
 * retry repeats the same repository read; it never falls back to a folder scan.
 */
export function MeetingNotesReview<Client extends NotesReviewClientPair>({
  reviewKind,
  repository,
  blockedReason,
}: MeetingNotesReviewProps<Client>) {
  if (blockedReason) {
    return (
      <NotesReviewPanel
        reviewKind={reviewKind}
        state={{ kind: 'blocked', message: blockedReason }}
        onApprove={() =>
          Promise.reject(new Error('This meeting proposal review is blocked.'))
        }
      />
    );
  }
  if (!repository) {
    return (
      <NotesReviewPanel
        reviewKind={reviewKind}
        state={{
          kind: 'blocked',
          message:
            'Open this meeting from a confirmed client before reviewing proposals.',
        }}
        onApprove={() =>
          Promise.reject(new Error('This meeting proposal reader is unavailable.'))
        }
      />
    );
  }
  return (
    <LoadedMeetingNotesReview
      reviewKind={reviewKind}
      repository={repository}
    />
  );
}

function LoadedMeetingNotesReview<Client extends NotesReviewClientPair>({
  reviewKind,
  repository,
}: {
  readonly reviewKind: ExactMeetingReviewKind;
  readonly repository: ExactMeetingNotesReviewRepository<Client>;
}) {
  const [state, setState] = useState<NotesReviewPanelState<Client>>({
    kind: 'loading',
  });
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void repository
      .list(reviewKind)
      .then((items) => {
        if (!live) return;
        setState(
          items.length === 0
            ? { kind: 'empty', reason: 'not-produced' }
            : { kind: 'populated', items }
        );
      })
      .catch(() => {
        if (live)
          setState({
            kind: 'error',
            message: 'Could not load the saved meeting proposals.',
          });
      });
    return () => {
      live = false;
    };
  }, [repository, reviewKind, loadAttempt]);

  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setLoadAttempt((current) => current + 1);
  }, []);

  const approve = async (
    item: ExactMeetingNotesReviewItem<Client>
  ): Promise<NotesReviewReceipt> => {
    const receipt = await repository.approve(item);
    setState((current) =>
      current.kind !== 'populated'
        ? current
        : {
            ...current,
            items: current.items.map((candidate) =>
              candidate.id === item.id
                ? { ...candidate, approvalState: 'approved' as const }
                : candidate
            ),
            receipts: { ...(current.receipts ?? {}), [item.id]: receipt },
          }
    );
    return receipt;
  };

  return (
    <NotesReviewPanel
      reviewKind={reviewKind}
      state={state}
      onRetry={retry}
      onApprove={approve}
    />
  );
}

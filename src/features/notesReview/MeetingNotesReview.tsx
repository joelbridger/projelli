import { useEffect, useMemo, useState } from 'react';
import { buildInverseCrmMap } from '@/platform/rag/matterResolver';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  crmApproveWriteProposal,
  crmIsConnected,
  crmPrepareWriteProposal,
  crmSaveWriteProposal,
} from '@/platform/utils/wealthbox-commands';
import { NotesReviewPanel } from './NotesReviewPanel';
import {
  makeNotesReviewRepository,
  type NotesReviewCrmDelivery,
  type NotesReviewWorkspace,
} from './notesReviewDelivery';
import type {
  NotesReviewDestination,
  NotesReviewItem,
  NotesReviewReceipt,
} from './types';

export interface MeetingNotesReviewProps {
  meetingDir: string;
  matterId: string;
  summaryText: string;
  workspaceService: NotesReviewWorkspace | null;
  /** Meeting review/notice checks fail closed for the one external destination. */
  crmBlockedReason?: string;
  /** Test seam; production uses the Rust-enforced Wealthbox proposal path. */
  crmDelivery?: NotesReviewCrmDelivery;
}

const productionCrmDelivery: NotesReviewCrmDelivery = {
  isConnected: () => crmIsConnected('wealthbox'),
  saveProposal: (proposal) => crmSaveWriteProposal(proposal),
  prepareProposal: (args) => crmPrepareWriteProposal(args),
  approveProposal: (proposalId) => crmApproveWriteProposal(proposalId),
};

/**
 * The mounted bridge: real generated action items in, durable local files or
 * the Rust-enforced CRM write path out. The panel never invents a success
 * message; it only receives a receipt after the destination finishes.
 */
export function MeetingNotesReview({
  meetingDir,
  matterId,
  summaryText,
  workspaceService,
  crmBlockedReason,
  crmDelivery = productionCrmDelivery,
}: MeetingNotesReviewProps) {
  const matters = useMatterStore((state) => state.matters);
  const [items, setItems] = useState<NotesReviewItem[]>([]);
  const [receipts, setReceipts] = useState<Record<string, NotesReviewReceipt>>(
    {}
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const householdKey = useMemo(() => {
    const candidates = (buildInverseCrmMap(matters).get(matterId) ?? []).filter(
      (key) => !key.startsWith('sfdc:') && !key.startsWith('redtail:')
    );
    return candidates.length === 1 ? (candidates[0] ?? null) : null;
  }, [matters, matterId]);
  const repository = useMemo(
    () =>
      workspaceService
        ? makeNotesReviewRepository({
            workspace: workspaceService,
            meetingDir,
            matterId,
            summaryText,
            crm: crmDelivery,
            householdKey,
          })
        : null,
    [
      workspaceService,
      meetingDir,
      matterId,
      summaryText,
      crmDelivery,
      householdKey,
    ]
  );

  useEffect(() => {
    let live = true;
    if (!repository) {
      setItems([]);
      setReceipts({});
      return () => {
        live = false;
      };
    }
    void repository
      .load()
      .then((state) => {
        if (!live) return;
        setItems(state.items);
        setReceipts(
          Object.fromEntries(
            state.items.flatMap((item) =>
              item.receipt ? [[item.id, item.receipt] as const] : []
            )
          )
        );
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (live)
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Could not load the saved review items.'
          );
      });
    return () => {
      live = false;
    };
  }, [repository]);

  if (loadError) {
    return (
      <div
        data-testid="meeting-notes-review-error"
        role="alert"
        style={{ color: 'var(--destructive)', fontSize: 'var(--kp-font-sm)' }}
      >
        {loadError}
      </div>
    );
  }
  if (!repository || items.length === 0) return null;

  const onApprove = async (
    item: NotesReviewItem
  ): Promise<NotesReviewReceipt> => {
    const receipt = await repository.approve(item);
    setReceipts((current) => ({ ...current, [item.id]: receipt }));
    return receipt;
  };
  const blockedDestinations: Partial<Record<NotesReviewDestination, string>> =
    crmBlockedReason ? { crm: crmBlockedReason } : {};
  return (
    <NotesReviewPanel
      rawItems={items}
      initialReceipts={receipts}
      blockedDestinations={blockedDestinations}
      onApprove={onApprove}
    />
  );
}

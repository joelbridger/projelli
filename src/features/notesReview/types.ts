/**
 * The small, UI-owned contract for a proposed note item.
 *
 * `meetingTemplates` is produced in a parallel lane, so this surface accepts
 * unknown input and normalizes it before rendering. Keeping this contract here
 * means a malformed or newer template result cannot accidentally turn into an
 * outbound action.
 */
export type NotesReviewDestination =
  | 'task'
  | 'crm'
  | 'client-note'
  | 'internal';

export interface NotesReviewItem {
  id: string;
  title: string;
  detail: string;
  destination: NotesReviewDestination;
  sourceLabel?: string;
}

/** A truthful outcome from the layer that owns the actual save or write. */
export interface NotesReviewReceipt {
  status: 'created' | 'saved' | 'sent' | 'recorded' | 'failed';
  message: string;
}

export interface NotesReviewPanelProps {
  /**
   * Template output is intentionally unknown at this boundary. The parallel
   * `meetingTemplates` lane can pass its types directly without making this UI
   * depend on a still-changing implementation module.
   */
  rawItems?: readonly unknown[];
  /**
   * Delivery is durable. When the meeting is reopened, the panel receives the
   * exact receipts saved beside its proposals rather than pretending the item
   * is new again.
   */
  initialReceipts?: Readonly<Record<string, NotesReviewReceipt>>;
  /** A destination can be held back by a meeting-level safety check. */
  blockedDestinations?: Partial<Record<NotesReviewDestination, string>>;
  /**
   * The caller performs the real write only after this panel's Approve click.
   * A returned receipt is shown beside that exact item; a missing receipt is
   * surfaced honestly rather than presented as a completed delivery.
   */
  onApprove?: (
    item: NotesReviewItem
  ) => Promise<NotesReviewReceipt | undefined> | NotesReviewReceipt | undefined;
}

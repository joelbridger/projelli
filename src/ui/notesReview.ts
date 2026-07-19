/** The two proposal kinds that own meeting-detail review tabs. */
export type ExactMeetingReviewKind = 'task' | 'crm-update';

/**
 * Runtime client identity carried by every proposal. The app binding supplies
 * the sealed Meetings value; this leaf UI contract deliberately does not
 * import a product feature merely to render it.
 */
export interface NotesReviewClientPair {
  readonly householdRef: string;
  readonly matterId: string;
  readonly displayName?: string;
}

export type NotesReviewCrmFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'boolean';

export type NotesReviewCrmFieldValue = string | number | boolean | null;

/**
 * `before` is required. Producers that have not read the real CRM value must
 * not manufacture an empty value; the proposal is rejected at the reader.
 */
export interface NotesReviewCrmFieldChange {
  readonly field: string;
  readonly label: string;
  readonly valueType: NotesReviewCrmFieldType;
  readonly before: NotesReviewCrmFieldValue;
  readonly proposed: NotesReviewCrmFieldValue;
}

interface ExactMeetingReviewItemBase<Client extends NotesReviewClientPair> {
  readonly id: string;
  readonly artifactId: string;
  readonly meetingId: string;
  readonly client: Client;
  readonly title: string;
  readonly detail: string;
  readonly transcriptRef: string;
  readonly sourceLabel?: string;
  readonly approvalState: 'proposed' | 'approved';
}

export interface ExactMeetingTaskReviewItem<
  Client extends NotesReviewClientPair = NotesReviewClientPair,
> extends ExactMeetingReviewItemBase<Client> {
  readonly kind: 'task';
  /** Editable proposed task owner. `null` means deliberately unassigned. */
  readonly ownerRef: string | null;
  /** Editable ISO calendar date. `null` means deliberately no due date. */
  readonly dueDate: string | null;
}

export interface ExactMeetingCrmReviewItem<
  Client extends NotesReviewClientPair = NotesReviewClientPair,
> extends ExactMeetingReviewItemBase<Client> {
  readonly kind: 'crm-update';
  readonly entityRef: string;
  /** `proposed` is editable; `before` remains the source-of-truth comparison. */
  readonly fields: readonly NotesReviewCrmFieldChange[];
}

/**
 * The exact-meeting proposal contract. Identity fields are immutable and every
 * item contains the meeting id plus the full client pair used by its reader.
 */
export type ExactMeetingNotesReviewItem<
  Client extends NotesReviewClientPair = NotesReviewClientPair,
> =
  | ExactMeetingTaskReviewItem<Client>
  | ExactMeetingCrmReviewItem<Client>;

/** A truthful outcome from the layer that owns the actual save or write. */
export interface NotesReviewReceipt {
  status: 'created' | 'saved' | 'sent' | 'recorded' | 'failed';
  message: string;
}

export type NotesReviewPanelState<
  Client extends NotesReviewClientPair = NotesReviewClientPair,
> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty'; readonly reason: 'not-produced' }
  | { readonly kind: 'blocked'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'populated';
      readonly items: readonly ExactMeetingNotesReviewItem<Client>[];
      readonly receipts?: Readonly<Record<string, NotesReviewReceipt>>;
    };

export interface NotesReviewPanelProps<
  Client extends NotesReviewClientPair = NotesReviewClientPair,
> {
  readonly reviewKind: ExactMeetingReviewKind;
  readonly state: NotesReviewPanelState<Client>;
  readonly onRetry?: () => void;
  /**
   * The caller first records approval for this exact artifact, then performs
   * the destination write. Rendering or editing never invokes this callback.
   */
  readonly onApprove: (
    item: ExactMeetingNotesReviewItem<Client>
  ) => Promise<NotesReviewReceipt>;
}

// Compatibility types for the pre-foundation summary parser. New Tasks/CRM
// tabs use ExactMeetingNotesReviewItem and never normalize an unscoped item.
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

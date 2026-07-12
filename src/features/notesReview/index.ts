/**
 * Compatibility exports for the former feature path. Meeting-note review is
 * now shared UI plus a platform delivery service, so meetings can use it
 * without depending on another feature.
 */
export { NotesReviewPanel } from '@/ui/NotesReviewPanel';
export { MeetingNotesReview } from '@/platform/meetingNotesReview/MeetingNotesReview';
export { normalizeNotesReviewItems } from '@/ui/normalizeNotesReviewItems';
export {
  makeNotesReviewRepository,
  proposalsFromMeetingSummary,
} from '@/platform/meetingNotesReview/notesReviewDelivery';
export type {
  NotesReviewCrmDelivery,
  NotesReviewRepository,
  NotesReviewWorkspace,
} from '@/platform/meetingNotesReview/notesReviewDelivery';
export type {
  NotesReviewDestination,
  NotesReviewItem,
  NotesReviewPanelProps,
  NotesReviewReceipt,
} from '@/ui/notesReview';

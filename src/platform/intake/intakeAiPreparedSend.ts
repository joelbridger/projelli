/**
 * Fold seam for Intake AI requests.
 *
 * Routes through the real prompt-preparation layer from the ux-simplify-v1
 * fold. Kept as a stable import path for Intake's three AI call sites
 * (NudgeReviewModal.tsx, useEmailReplyIngestion.ts,
 * documentExtractionEngine.ts) rather than pointing each one at the
 * platform module directly.
 */
export type {
  PreparedAttachmentCandidate,
  PreparedSendContext,
  PromptOrigin,
  PromptPart,
} from '@/platform/privacy/promptPreparation';
export { sendPreparedStructuredWithEgressAudit } from '@/platform/privacy/promptPreparation';

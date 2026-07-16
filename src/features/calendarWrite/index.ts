/**
 * Part B two-way calendar WRITE — public doorway (`@/features/calendarWrite`).
 *
 * A read-only calendar connection becomes write-capable only through explicit
 * consent (`@/platform/calendar/writeConsent`), and a provider write only ever
 * happens as a prepared → reviewed → approved → verified flow that fails closed
 * on missing consent, an unauthorised target, a stale version, or a busy slot. A
 * booking is confirmed only by a verified provider receipt. The whole surface is
 * dark behind the `calendar-write` flag.
 *
 * Consume this feature only through this index. Internals — the orchestrator's
 * gates, the provider boundary, the ledger — are not part of the contract.
 *
 * Paved path for adding a write provider: `./adapters/SKILL.md`.
 */

// Dark UI surface
export { CalendarWriteReviewCard } from './ui/CalendarWriteReviewCard';
export {
  CalendarWritePendingBanner,
  type CalendarWritePendingBannerProps,
} from './ui/CalendarWritePendingBanner';

// Orchestration (for the app shell / native lane to wire)
export {
  createCalendarWriteOrchestrator,
  type CalendarWriteOrchestrator,
  type CalendarWriteDeps,
  type BusyInterval,
} from './orchestrator';
export { useCalendarWrite, type CalendarWriteQueue } from './useCalendarWrite';

// Versioned read model (B1)
export {
  classifyWriteEligibility,
  isWriteEligible,
} from './versionedRead';

// V1 limits (SC-013/014/022)
export { enforceWriteLimits, type WriteLimitContext, type WriteLimitResult } from './limits';

// Provider adapters (appendable surface)
export { getWriteAdapter, listWriteAdapters } from './adapters/registry';
export type { CalendarWriteProviderAdapter } from './adapters/types';

// Provider port + boundary (for the native executor)
export {
  interpretWriteResponse,
  interpretReconcileResponse,
  type CalendarWriteProviderPort,
  type ProviderWriteRequest,
  type ProviderVerifyQuery,
  type ProviderIdentityFields,
  type VerifiedWriteResult,
  type VerifiedReconcileResult,
} from './providerPort';

// Durable ledger
export {
  createLiveRecordProposalStore,
  verifyStoredProposal,
  PROPOSAL_RECORD_KIND,
  type CalendarProposalStorePort,
  type LiveRecordIo,
  type LiveRecordLike,
} from './proposalStore';

// Idempotency
export { newIdempotencyKey, isWellFormedIdempotencyKey } from './idempotency';

// Types
export type {
  CalendarWriteProviderId,
  CalendarSeriesKind,
  CalendarEventOwnership,
  VersionedProviderProjection,
  CalendarWriteEligibility,
  ViewOnlyReason,
  CalendarWriteIntent,
  CalendarCreateIntent,
  CalendarUpdateIntent,
  CalendarWriteIntentKind,
  CalendarWriteEventInput,
  CalendarWriteProposal,
  CalendarWriteProposalStatus,
  CalendarWriteOutcome,
  CalendarWriteRefusalReason,
  CalendarWriteFailureReason,
} from './types';

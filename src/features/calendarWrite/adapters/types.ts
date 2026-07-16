/**
 * The provider-adapter seam. Adding a write-capable provider means adding one
 * adapter and registering it — see `./SKILL.md`. An adapter owns exactly two
 * jobs and no policy: it builds the provider-specific request from a proposal,
 * and it interprets the provider-specific response THROUGH the shared boundary
 * (`interpretWriteResponse`/`interpretReconcileResponse`), which is the only
 * place a response is trusted. An adapter never decides whether a write is
 * allowed — the orchestrator and the limits do — and never touches egress policy
 * beyond naming the operation it must go through.
 */
import type { CalendarWriteProposal, CalendarWriteProviderId } from '../types';
import type {
  ProviderIdentityFields,
  ProviderVerifyQuery,
  ProviderWriteRequest,
  VerifiedReconcileResult,
  VerifiedWriteResult,
} from '../providerPort';

export interface CalendarWriteProviderAdapter {
  readonly provider: CalendarWriteProviderId;
  /** The registered egress operation every call from this adapter goes through. */
  readonly egressOperationId: string;
  /** Provider-specific id/version field names read at the boundary. */
  readonly identityFields: ProviderIdentityFields;
  buildWriteRequest(proposal: CalendarWriteProposal): ProviderWriteRequest;
  buildVerifyQuery(proposal: CalendarWriteProposal): ProviderVerifyQuery;
  interpretWrite(raw: unknown): VerifiedWriteResult;
  interpretReconcile(raw: unknown): VerifiedReconcileResult;
}

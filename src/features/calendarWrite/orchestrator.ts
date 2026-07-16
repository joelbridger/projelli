/**
 * The write orchestrator — prepare → review → approve → verify, fail-closed.
 *
 * The order of the gates is the security design, and it is fixed:
 *
 *   1. flag off            → refuse, no consent/egress/store touch at all
 *   2. no write grant      → refuse (consent is re-checked at prepare AND approve)
 *   3. v1 limits           → refuse (owned, one-time, home calendar only)
 *   4. [prepare ends: an encrypted local proposal. NO egress has happened.]
 *   5. [explicit approval]
 *   6. refresh busy, now   → refuse if the slot went busy under us
 *   7. submit with an idempotency key
 *   8. verified receipt     → confirmed; stale → refuse; ambiguous → verify_pending
 *
 * A confirmation is only ever step 8's verified provider receipt. A prepared or
 * approved proposal is not a confirmation, and neither is a slot. An ambiguous
 * outcome is never re-fired blindly: it is persisted as `verify_pending` and
 * resolved later by asking the provider, keyed on the same idempotency key.
 */
import { assertCalendarWriteAllowed } from '@/platform/calendar/writeConsent';
import type { CalendarGrant } from '@/platform/calendar/writeConsent';
import { enforceWriteLimits } from './limits';
import { getWriteAdapter } from './adapters/registry';
import type { CalendarProposalStorePort } from './proposalStore';
import type { CalendarWriteProviderPort } from './providerPort';
import type {
  CalendarWriteIntent,
  CalendarWriteOutcome,
  CalendarWriteProposal,
  CalendarWriteProviderId,
  CalendarWriteRefusalReason,
} from './types';

export interface BusyInterval {
  readonly startUtc: string;
  readonly endUtc: string;
}

export interface CalendarWriteDeps {
  /** The dark flag gate. Checked FIRST on every entry point. */
  isWriteEnabled(): boolean;
  /** Returns a boundary-validated grant (already `verifyStoredGrant`-ed), or null. */
  loadGrant(provider: CalendarWriteProviderId): Promise<CalendarGrant | null>;
  /** The single home/write calendar id (SC-013). */
  getHomeCalendarId(): Promise<string>;
  /** Busy blocks across all selected calendars, refreshed live. `exclude` drops
   *  the event being rescheduled so it does not conflict with itself. */
  refreshBusy(args: { excludeProviderEventId?: string }): Promise<readonly BusyInterval[]>;
  provider: CalendarWriteProviderPort;
  store: CalendarProposalStorePort;
  now(): string;
  newProposalId(): string;
  newIdempotencyKey(): string;
}

function refused(
  reason: CalendarWriteRefusalReason,
  proposal?: CalendarWriteProposal,
): CalendarWriteOutcome {
  return { kind: 'refused', reason, ...(proposal ? { proposal } : {}) };
}

/** Half-open interval overlap on ISO-8601 UTC strings (same format compares lexically). */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

async function hasWriteGrant(
  deps: CalendarWriteDeps,
  provider: CalendarWriteProviderId,
): Promise<CalendarGrant | null> {
  const grant = await deps.loadGrant(provider);
  try {
    // Reuse the canonical gate rather than restating the rule; map its throw to
    // a refusal so the flow stays fail-closed instead of surfacing an error.
    assertCalendarWriteAllowed(grant);
    return grant;
  } catch {
    return null;
  }
}

export function createCalendarWriteOrchestrator(deps: CalendarWriteDeps) {
  /**
   * Prepare an encrypted local proposal. No egress. Refusals are returned, not
   * persisted; only a real in-flight proposal enters the ledger.
   */
  async function prepare(intent: CalendarWriteIntent): Promise<CalendarWriteOutcome> {
    if (!deps.isWriteEnabled()) return refused('flag_disabled');

    const adapter = getWriteAdapter(intent.provider);
    if (!adapter) return refused('provider_unsupported');

    const grant = await hasWriteGrant(deps, intent.provider);
    if (!grant) return refused('consent_missing');

    const homeCalendarId = await deps.getHomeCalendarId();
    const limit = enforceWriteLimits(intent, { homeCalendarId });
    if (!limit.ok) return refused(limit.reason);

    const now = deps.now();
    const proposal: CalendarWriteProposal = {
      id: deps.newProposalId(),
      kind: intent.kind,
      provider: intent.provider,
      targetCalendarId: intent.targetCalendarId,
      status: 'prepared',
      idempotencyKey: deps.newIdempotencyKey(),
      event: intent.event,
      ...(intent.kind === 'update' ? { target: intent.target } : {}),
      grantVersion: grant.grantVersion,
      createdAtUtc: now,
      updatedAtUtc: now,
    };
    await deps.store.put(proposal);
    return { kind: 'prepared', proposal };
  }

  async function loadPrepared(proposalId: string): Promise<CalendarWriteProposal | undefined> {
    const all = await deps.store.load();
    return all.find((p) => p.id === proposalId);
  }

  /**
   * Approve and submit a prepared proposal. Re-checks the flag, the consent, and
   * the limits (all may have changed since prepare), refreshes busy time, and
   * only then submits with the idempotency key.
   */
  async function approve(proposalId: string): Promise<CalendarWriteOutcome> {
    if (!deps.isWriteEnabled()) return refused('flag_disabled');

    const proposal = await loadPrepared(proposalId);
    if (!proposal) return refused('consent_missing');
    if (proposal.status !== 'prepared') {
      // Only a prepared proposal may be approved. An approved/verified/failed one
      // is not re-approved here (that is `resolvePending`'s job), so an approval
      // can never double-submit.
      if (proposal.status === 'verified') return { kind: 'confirmed', proposal };
      if (proposal.status === 'verify_pending') return { kind: 'verify_pending', proposal };
      return refused('unsupported_operation', proposal);
    }

    return submitGuarded(proposal);
  }

  /**
   * The single guarded write path — the ONLY function that calls
   * `provider.submitWrite`. Every gate is re-applied here so that both a first
   * approval AND a post-restart re-submit go through the identical checks: flag,
   * a registered adapter, a live write grant, a well-formed update target, the v1
   * limits, and a fresh busy-slot refresh. Nothing reaches egress unless all pass.
   */
  async function submitGuarded(proposal: CalendarWriteProposal): Promise<CalendarWriteOutcome> {
    if (!deps.isWriteEnabled()) return refused('flag_disabled', proposal);

    const adapter = getWriteAdapter(proposal.provider);
    if (!adapter) return refused('provider_unsupported', proposal);

    // Consent is re-verified at the moment of the write, not trusted from
    // prepare: a revoked grant between prepare and the write must stop it.
    const grant = await hasWriteGrant(deps, proposal.provider);
    if (!grant) return refused('consent_missing', proposal);

    const homeCalendarId = await deps.getHomeCalendarId();
    let intentForLimits: CalendarWriteIntent;
    if (proposal.kind === 'update') {
      if (!proposal.target) {
        // An update proposal with no target is malformed; refuse rather than
        // send a PATCH with no If-Match and no event id (a blind overwrite).
        return refused('unsupported_operation', proposal);
      }
      intentForLimits = {
        kind: 'update',
        provider: proposal.provider,
        targetCalendarId: proposal.targetCalendarId,
        event: proposal.event,
        target: proposal.target,
      };
    } else {
      intentForLimits = {
        kind: 'create',
        provider: proposal.provider,
        targetCalendarId: proposal.targetCalendarId,
        event: proposal.event,
      };
    }
    const limit = enforceWriteLimits(intentForLimits, { homeCalendarId });
    if (!limit.ok) return refused(limit.reason, proposal);

    // Refresh busy time immediately before the write; exclude the event being
    // rescheduled so it does not block its own new slot.
    const excludeProviderEventId = proposal.target?.providerEventId;
    const busy = await deps.refreshBusy(
      excludeProviderEventId !== undefined ? { excludeProviderEventId } : {},
    );
    const clash = busy.some((b) =>
      overlaps(proposal.event.startUtc, proposal.event.endUtc, b.startUtc, b.endUtc),
    );
    if (clash) {
      return refused('slot_unavailable', proposal);
    }

    const request = adapter.buildWriteRequest(proposal);
    let raw: unknown;
    try {
      raw = await deps.provider.submitWrite(request);
    } catch {
      // A thrown transport error tells us nothing about whether the write
      // landed. Do not assume failure; verify.
      return persistVerifyPending(proposal);
    }
    const result = adapter.interpretWrite(raw);

    switch (result.outcome) {
      case 'written':
        return persistConfirmed(proposal, result.providerEventId, result.providerVersion);
      case 'stale':
        return persistRefused(proposal, 'stale_version');
      case 'ambiguous':
        return persistVerifyPending(proposal);
      case 'failed':
        return persistFailed(proposal, result.reason);
    }
  }

  /**
   * Resolve every approved-but-unverified proposal after a restart. Asks the
   * provider whether the write landed (keyed on the idempotency key) rather than
   * blindly re-firing. `present` confirms; `absent` re-submits once with the same
   * key (safe — the provider dedupes); anything unclear stays pending.
   */
  async function resolvePending(): Promise<readonly CalendarWriteOutcome[]> {
    if (!deps.isWriteEnabled()) return [];
    const all = await deps.store.load();
    const pending = all.filter((p) => p.status === 'verify_pending');
    const outcomes: CalendarWriteOutcome[] = [];
    for (const proposal of pending) {
      outcomes.push(await resolveOne(proposal));
    }
    return outcomes;
  }

  async function resolveOne(proposal: CalendarWriteProposal): Promise<CalendarWriteOutcome> {
    const adapter = getWriteAdapter(proposal.provider);
    if (!adapter) return refused('provider_unsupported', proposal);

    let raw: unknown;
    try {
      raw = await deps.provider.verifyWrite(adapter.buildVerifyQuery(proposal));
    } catch {
      return { kind: 'verify_pending', proposal };
    }
    const reconcile = adapter.interpretReconcile(raw);

    if (reconcile.outcome === 'present') {
      return persistConfirmed(proposal, reconcile.providerEventId, reconcile.providerVersion);
    }
    if (reconcile.outcome === 'failed') {
      return persistFailed(proposal, reconcile.reason);
    }
    if (reconcile.outcome === 'ambiguous') {
      return { kind: 'verify_pending', proposal };
    }

    // absent: the earlier submit did not land. Re-submit with the same
    // idempotency key through the FULL guarded path — verified-then-resubmit,
    // re-checking flag, consent, the v1 limits, and a fresh busy slot, never a
    // blind re-fire. A transient refusal (slot went busy, consent revoked) is
    // not persisted, so the proposal stays pending for a later resolve; a stale
    // target or a hard failure is persisted terminally. Either way, no
    // confirmation is claimed without a verified provider receipt.
    return submitGuarded(proposal);
  }

  // ── persistence helpers ───────────────────────────────────────────────────

  async function persistConfirmed(
    proposal: CalendarWriteProposal,
    providerEventId: string,
    providerVersion: string,
  ): Promise<CalendarWriteOutcome> {
    const next: CalendarWriteProposal = {
      ...proposal,
      status: 'verified',
      updatedAtUtc: deps.now(),
      confirmed: { providerEventId, providerVersion, verifiedAtUtc: deps.now() },
    };
    await deps.store.put(next);
    return { kind: 'confirmed', proposal: next };
  }

  async function persistVerifyPending(proposal: CalendarWriteProposal): Promise<CalendarWriteOutcome> {
    const next: CalendarWriteProposal = { ...proposal, status: 'verify_pending', updatedAtUtc: deps.now() };
    await deps.store.put(next);
    return { kind: 'verify_pending', proposal: next };
  }

  async function persistRefused(
    proposal: CalendarWriteProposal,
    reason: CalendarWriteRefusalReason,
  ): Promise<CalendarWriteOutcome> {
    const next: CalendarWriteProposal = {
      ...proposal,
      status: 'refused',
      refusalReason: reason,
      updatedAtUtc: deps.now(),
    };
    await deps.store.put(next);
    return { kind: 'refused', reason, proposal: next };
  }

  async function persistFailed(
    proposal: CalendarWriteProposal,
    reason: NonNullable<CalendarWriteProposal['failureReason']>,
  ): Promise<CalendarWriteOutcome> {
    const next: CalendarWriteProposal = {
      ...proposal,
      status: 'failed',
      failureReason: reason,
      updatedAtUtc: deps.now(),
    };
    await deps.store.put(next);
    return { kind: 'failed', reason, proposal: next };
  }

  async function listProposals(): Promise<readonly CalendarWriteProposal[]> {
    return deps.store.load();
  }

  return { prepare, approve, resolvePending, listProposals };
}

export type CalendarWriteOrchestrator = ReturnType<typeof createCalendarWriteOrchestrator>;

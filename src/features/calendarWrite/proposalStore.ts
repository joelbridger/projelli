/**
 * The proposal/receipt ledger — durable, encrypted, restart-safe.
 *
 * A prepared or approved-but-unverified write must survive an app restart so it
 * can be resolved (verified or reconciled), not lost and not blindly re-fired.
 * The ledger rides the existing encrypted CRM live-record route (SQLCipher core),
 * the same durable path the calendar event store uses — a new record `kind`, no
 * new schema. That means restart durability is a real production property, not a
 * test-only mock.
 *
 * On reload, every record is untrusted input and is validated field-by-field
 * here. The load-bearing demotion: a row that claims `verified` without a
 * well-formed provider confirmation is demoted to `verify_pending` (re-verify)
 * rather than believed — a lost or partially-written confirmation can never
 * present as a booking. An update row that lost its target is rejected outright,
 * so it can never drive a version-less PATCH.
 *
 * Trust boundary (stated honestly): the authenticity of a well-formed
 * `confirmed` block ultimately rests on the encrypted SQLCipher store's
 * integrity, exactly as a stored write grant's does — a local validator cannot
 * distinguish a genuine confirmation from one forged by an actor who can already
 * write arbitrary decrypted rows. What this module guarantees is that corruption,
 * rollback, and partial writes fail closed, and that no field a provider controls
 * is trusted beyond an opaque id and version.
 */
import { isWellFormedIdempotencyKey } from './idempotency';
import type {
  CalendarSeriesKind,
  CalendarWriteEventInput,
  CalendarWriteProposal,
  CalendarWriteProposalStatus,
  CalendarWriteProviderId,
  CalendarWriteIntentKind,
  CalendarEventOwnership,
} from './types';

/** The record kind under which proposals live in the CRM live-record store. */
export const PROPOSAL_RECORD_KIND = 'calendar_write_proposal';

/**
 * The durable ledger seam. `load` returns untrusted rows — validate each with
 * `verifyStoredProposal`.
 */
export interface CalendarProposalStorePort {
  put(proposal: CalendarWriteProposal): Promise<void>;
  load(): Promise<readonly CalendarWriteProposal[]>;
}

const PROVIDERS: ReadonlySet<string> = new Set<CalendarWriteProviderId>(['outlook', 'google']);
const INTENT_KINDS: ReadonlySet<string> = new Set<CalendarWriteIntentKind>(['create', 'update']);
const STATUSES: ReadonlySet<string> = new Set<CalendarWriteProposalStatus>([
  'prepared',
  'approved',
  'verify_pending',
  'verified',
  'refused',
  'failed',
]);
const SERIES_KINDS: ReadonlySet<string> = new Set<CalendarSeriesKind>([
  'single',
  'recurring-master',
  'recurring-instance',
  'recurring-exception',
]);
const OWNERSHIPS: ReadonlySet<string> = new Set<CalendarEventOwnership>([
  'organizer-self',
  'attendee',
  'unknown',
]);

function str(value: unknown): value is string {
  return typeof value === 'string';
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function nullableStr(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function nonNegInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function validateEvent(raw: unknown): CalendarWriteEventInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as {
    title?: unknown;
    startUtc?: unknown;
    endUtc?: unknown;
    displayTimezone?: unknown;
    allDay?: unknown;
    location?: unknown;
    notes?: unknown;
  };
  if (
    !str(e.title) ||
    !nonEmpty(e.startUtc) ||
    !nonEmpty(e.endUtc) ||
    !nonEmpty(e.displayTimezone) ||
    typeof e.allDay !== 'boolean' ||
    !nullableStr(e.location) ||
    !nullableStr(e.notes)
  ) {
    return null;
  }
  return {
    title: e.title,
    startUtc: e.startUtc,
    endUtc: e.endUtc,
    displayTimezone: e.displayTimezone,
    allDay: e.allDay,
    location: e.location ?? null,
    notes: e.notes ?? null,
  };
}

function validateTarget(raw: unknown): CalendarWriteProposal['target'] | undefined | null {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as {
    providerEventId?: unknown;
    providerCalendarId?: unknown;
    expectedVersion?: unknown;
    seriesKind?: unknown;
    ownership?: unknown;
    canWrite?: unknown;
  };
  if (
    !nonEmpty(t.providerEventId) ||
    !nonEmpty(t.providerCalendarId) ||
    !nonEmpty(t.expectedVersion) ||
    !(str(t.seriesKind) && SERIES_KINDS.has(t.seriesKind)) ||
    !(str(t.ownership) && OWNERSHIPS.has(t.ownership)) ||
    typeof t.canWrite !== 'boolean'
  ) {
    return null;
  }
  return {
    providerEventId: t.providerEventId,
    providerCalendarId: t.providerCalendarId,
    expectedVersion: t.expectedVersion,
    seriesKind: t.seriesKind as CalendarSeriesKind,
    ownership: t.ownership as CalendarEventOwnership,
    canWrite: t.canWrite,
  };
}

function validateConfirmed(raw: unknown): CalendarWriteProposal['confirmed'] | undefined | null {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as { providerEventId?: unknown; providerVersion?: unknown; verifiedAtUtc?: unknown };
  if (!nonEmpty(c.providerEventId) || !nonEmpty(c.providerVersion) || !nonEmpty(c.verifiedAtUtc)) {
    return null;
  }
  return {
    providerEventId: c.providerEventId,
    providerVersion: c.providerVersion,
    verifiedAtUtc: c.verifiedAtUtc,
  };
}

/**
 * Validate one proposal loaded from storage. Returns the trusted proposal, or
 * `null` when the row cannot be trusted to represent a proposal at all. A row
 * that claims `verified` without a well-formed `confirmed` block is NOT dropped
 * — it is demoted to `verify_pending`, because losing an in-flight write is
 * worse than re-verifying one, and a false confirmation is worst of all.
 */
export function verifyStoredProposal(raw: unknown): CalendarWriteProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as {
    id?: unknown;
    kind?: unknown;
    provider?: unknown;
    targetCalendarId?: unknown;
    status?: unknown;
    idempotencyKey?: unknown;
    grantVersion?: unknown;
    createdAtUtc?: unknown;
    updatedAtUtc?: unknown;
    event?: unknown;
    target?: unknown;
    confirmed?: unknown;
    refusalReason?: unknown;
    failureReason?: unknown;
  };

  if (!nonEmpty(r.id)) return null;
  if (!(str(r.kind) && INTENT_KINDS.has(r.kind))) return null;
  if (!(str(r.provider) && PROVIDERS.has(r.provider))) return null;
  if (!nonEmpty(r.targetCalendarId)) return null;
  if (!(str(r.status) && STATUSES.has(r.status))) return null;
  if (!isWellFormedIdempotencyKey(r.idempotencyKey)) return null;
  if (!nonNegInt(r.grantVersion)) return null;
  if (!nonEmpty(r.createdAtUtc) || !nonEmpty(r.updatedAtUtc)) return null;

  const event = validateEvent(r.event);
  if (!event) return null;

  const target = validateTarget(r.target);
  if (target === null) return null;
  // An update MUST carry a well-formed target. A row that claims `update` but
  // lost its target could otherwise drive a PATCH with no If-Match and no event
  // id — a blind overwrite. Reject it outright rather than trust it.
  if (r.kind === 'update' && !target) return null;

  const confirmed = validateConfirmed(r.confirmed);
  if (confirmed === null) return null;

  // Fail-closed demotion: a "verified" status is only believed with a genuine
  // provider confirmation. Without one, re-verify rather than claim a booking.
  let status = r.status as CalendarWriteProposalStatus;
  if (status === 'verified' && !confirmed) {
    status = 'verify_pending';
  }

  const refusalReason = str(r.refusalReason) ? (r.refusalReason as NonNullable<CalendarWriteProposal['refusalReason']>) : undefined;
  const failureReason = str(r.failureReason) ? (r.failureReason as NonNullable<CalendarWriteProposal['failureReason']>) : undefined;

  return {
    id: r.id,
    kind: r.kind as CalendarWriteIntentKind,
    provider: r.provider as CalendarWriteProviderId,
    targetCalendarId: r.targetCalendarId,
    status,
    idempotencyKey: r.idempotencyKey,
    event,
    ...(target ? { target } : {}),
    grantVersion: r.grantVersion,
    createdAtUtc: r.createdAtUtc,
    updatedAtUtc: r.updatedAtUtc,
    ...(confirmed ? { confirmed } : {}),
    ...(refusalReason ? { refusalReason } : {}),
    ...(failureReason ? { failureReason } : {}),
  };
}

// ── Production adapter: the encrypted CRM live-record route ─────────────────

/** A minimal record shape; the CRM route persists arbitrary `kind` records. */
export interface LiveRecordLike {
  id: string;
  kind: string;
  [key: string]: unknown;
}

/**
 * The lower-level durable IO the CRM live-record route provides. The React layer
 * wires `useLiveCrmRecords().save` and its visibility-filtered reload to it.
 */
export interface LiveRecordIo {
  save(record: LiveRecordLike): Promise<unknown>;
  load(): Promise<readonly LiveRecordLike[]>;
}

/**
 * A proposal store backed by the encrypted CRM live-record route. This is the
 * production durability path: an upsert lands in SQLCipher, a reload reads it
 * back, and `verifyStoredProposal` re-validates every row.
 *
 * The proposal is stored under a `payload` field, NOT merged into the record.
 * A live record's own `kind` is the CRM store's category
 * (`calendar_write_proposal`), while the proposal carries its OWN `kind` (the
 * intent — `create`/`update`); merging them would clobber the intent kind and no
 * proposal would survive a reload. Keeping the payload nested keeps both intact.
 */
export function createLiveRecordProposalStore(io: LiveRecordIo): CalendarProposalStorePort {
  return {
    async put(proposal: CalendarWriteProposal): Promise<void> {
      await io.save({ id: proposal.id, kind: PROPOSAL_RECORD_KIND, payload: proposal });
    },
    async load(): Promise<readonly CalendarWriteProposal[]> {
      const rows = await io.load();
      const out: CalendarWriteProposal[] = [];
      for (const row of rows) {
        if (row.kind !== PROPOSAL_RECORD_KIND) continue;
        const proposal = verifyStoredProposal(row['payload']);
        if (proposal) out.push(proposal);
      }
      return out;
    },
  };
}

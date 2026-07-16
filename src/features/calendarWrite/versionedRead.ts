/**
 * Versioned read model (B1) — the gate between a read row and write eligibility.
 *
 * A write must stand on a read that carries every provider-side fact it needs:
 * which event, on which calendar, at which version, owned by whom, writeable per
 * the provider, what series shape, in what timezone, verified under which grant.
 * A row that supplies all of them is `writeable`; a row that does not is
 * `view-only`, and there is no way to coerce a view-only row into a write.
 *
 * This is deliberately structural. Legacy rows persisted before Part B never had
 * these facts, so they can never become write-eligible by accident — they stay
 * view-only until a fresh verified read replaces them. Everything here fails
 * closed: an absent, malformed, or unrecognized field yields `view-only`, never
 * a partially-trusted projection.
 */
import type {
  CalendarEventOwnership,
  CalendarSeriesKind,
  CalendarWriteEligibility,
  CalendarWriteProviderId,
  VersionedProviderProjection,
} from './types';

const SERIES_KINDS: ReadonlySet<CalendarSeriesKind> = new Set<CalendarSeriesKind>([
  'single',
  'recurring-master',
  'recurring-instance',
  'recurring-exception',
]);

const OWNERSHIPS: ReadonlySet<CalendarEventOwnership> = new Set<CalendarEventOwnership>([
  'organizer-self',
  'attendee',
  'unknown',
]);

function isWriteCapableProvider(value: unknown): value is CalendarWriteProviderId {
  return value === 'outlook' || value === 'google';
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

interface RawProjection {
  provider?: unknown;
  providerEventId?: unknown;
  providerCalendarId?: unknown;
  providerVersion?: unknown;
  ownership?: unknown;
  canWrite?: unknown;
  seriesKind?: unknown;
  originalTimezone?: unknown;
  location?: unknown;
  readGrantVersion?: unknown;
}

/**
 * The provider-version fields that define a "versioned" row. If a row carries
 * NONE of them it is a legacy row; if it carries some but they are malformed it
 * is a corrupt/partial projection. Both are view-only — the distinction only
 * shapes the reason, never the outcome.
 */
function looksLegacy(raw: RawProjection): boolean {
  return (
    raw.providerEventId === undefined &&
    raw.providerVersion === undefined &&
    raw.readGrantVersion === undefined
  );
}

/**
 * Classify one read row. Never throws: any shape that is not a fully-formed
 * versioned projection comes back as `view-only`.
 */
export function classifyWriteEligibility(raw: unknown): CalendarWriteEligibility {
  if (!raw || typeof raw !== 'object') {
    return { kind: 'view-only', reason: 'malformed-projection' };
  }
  const row = raw as RawProjection;

  if (!isWriteCapableProvider(row.provider)) {
    // ICS and anything unrecognized can never be write-eligible.
    return { kind: 'view-only', reason: 'unsupported-provider' };
  }

  if (looksLegacy(row)) {
    return { kind: 'view-only', reason: 'legacy-unversioned' };
  }

  if (
    !nonEmptyString(row.providerEventId) ||
    !nonEmptyString(row.providerCalendarId) ||
    !nonEmptyString(row.providerVersion) ||
    !nonEmptyString(row.originalTimezone) ||
    typeof row.canWrite !== 'boolean' ||
    !(typeof row.ownership === 'string' && OWNERSHIPS.has(row.ownership as CalendarEventOwnership)) ||
    !(typeof row.seriesKind === 'string' && SERIES_KINDS.has(row.seriesKind as CalendarSeriesKind)) ||
    !(typeof row.readGrantVersion === 'number' && Number.isInteger(row.readGrantVersion) && row.readGrantVersion >= 0) ||
    !(row.location === null || typeof row.location === 'string')
  ) {
    return { kind: 'view-only', reason: 'malformed-projection' };
  }

  const projection: VersionedProviderProjection = {
    provider: row.provider,
    providerEventId: row.providerEventId,
    providerCalendarId: row.providerCalendarId,
    providerVersion: row.providerVersion,
    ownership: row.ownership as CalendarEventOwnership,
    canWrite: row.canWrite,
    seriesKind: row.seriesKind as CalendarSeriesKind,
    originalTimezone: row.originalTimezone,
    location: row.location ?? null,
    readGrantVersion: row.readGrantVersion,
  };
  return { kind: 'writeable', projection };
}

/** Convenience: is this row write-eligible at all? */
export function isWriteEligible(raw: unknown): boolean {
  return classifyWriteEligibility(raw).kind === 'writeable';
}

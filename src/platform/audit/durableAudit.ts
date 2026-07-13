import type { AuditEntry } from '@/platform/types/audit';

export type AuditEntryInput = Omit<AuditEntry, 'id' | 'timestamp'>;
export type AuditLogSink = (entry: AuditEntryInput) => unknown;
export type DurableAuditPhase = 'intent' | 'outcome';

/** User-facing (and test-asserted) copy shown when a request is refused
 *  because its durable audit record could not be written. */
export const DURABLE_AUDIT_UNAVAILABLE_MESSAGE =
  'This request was not sent because its audit record could not be saved. Reopen this workspace and try again.';

/**
 * Thrown when a durable-audit phase cannot be persisted — either because no
 * audit sink was supplied at all, or because the sink itself failed. A missing
 * or failed audit writer is a CLOSED door, never an optional feature: the
 * caller (Ask) uses this to fail the send closed before any client content can
 * leave the device.
 */
export class DurableAuditUnavailableError extends Error {
  readonly code = 'DURABLE_AUDIT_UNAVAILABLE';
  constructor(message: string = DURABLE_AUDIT_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = 'DurableAuditUnavailableError';
  }
}

export function isDurableAuditUnavailableError(
  error: unknown,
): error is DurableAuditUnavailableError {
  return (
    error instanceof DurableAuditUnavailableError ||
    (error instanceof Error &&
      (error as { code?: unknown }).code === 'DURABLE_AUDIT_UNAVAILABLE')
  );
}

/**
 * Fail-closed guard: a surface that MUST leave a durable audit trail before it
 * egresses (Ask, whose intent row proves what client content was sent to a
 * provider) calls this before the send. With no sink to write to, it throws —
 * turning "no durable record" into a closed door instead of a silent skip.
 *
 * This is intentionally a SEPARATE, opt-in guard rather than baking the throw
 * into `mustLogAuditPhase`: many other audit call sites legitimately treat a
 * missing sink as a no-op, and must not be forced closed.
 */
export function requireAuditSink(
  onAuditLog: AuditLogSink | undefined,
): asserts onAuditLog is AuditLogSink {
  if (!onAuditLog) {
    throw new DurableAuditUnavailableError();
  }
}

export function createAuditPairId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 11);
  return `${prefix}_${String(Date.now())}_${random}`;
}

export function withDurableAuditPhase(
  entry: AuditEntryInput,
  phase: DurableAuditPhase,
  pairId: string,
): AuditEntryInput {
  return {
    ...entry,
    metadata: {
      ...entry.metadata,
      auditPhase: phase,
      auditPairId: pairId,
      auditMustPersist: true,
    },
  };
}

export async function mustLogAuditPhase(
  onAuditLog: AuditLogSink | undefined,
  entry: AuditEntryInput,
  phase: DurableAuditPhase,
  pairId: string,
): Promise<void> {
  // A missing sink is a no-op HERE (a surface that requires the record enforces
  // it up front with `requireAuditSink`). A sink that THROWS still propagates:
  // the record did not persist, so a caller using this before egress fails
  // closed on its own.
  if (!onAuditLog) return;
  await onAuditLog(withDurableAuditPhase(entry, phase, pairId));
}

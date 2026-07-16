import type { AuditEntry } from '@/platform/types/audit';

/** The fields a feature supplies before the canonical writer mints identity. */
export type AuditWriteEntry = Omit<AuditEntry, 'id' | 'timestamp'>;

/** The one asynchronous writer installed by App composition. */
export type AuditWriteEmitter = (entry: AuditWriteEntry) => Promise<AuditEntry>;

let activeAuditWriteEmitter: AuditWriteEmitter | null = null;

/**
 * Append an entry through App's canonical durable audit writer.
 *
 * This rejects while App is unavailable so a feature can never mistake a
 * dropped audit event for a successful durable write.
 */
export async function emitAuditEntry(
  entry: AuditWriteEntry
): Promise<AuditEntry> {
  const emitter = activeAuditWriteEmitter;
  if (!emitter) {
    throw new Error(
      '[audit] Canonical audit writer is unavailable because App has not installed it.'
    );
  }
  return emitter(entry);
}

/**
 * App composition only. Installs or removes the one live canonical writer.
 * Features must call emitAuditEntry and must never register an emitter.
 */
export function setAuditWriteEmitter(emitter: AuditWriteEmitter | null): void {
  activeAuditWriteEmitter = emitter;
}

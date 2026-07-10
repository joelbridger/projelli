import type { AuditEntry } from '@/platform/types/audit';

export type AuditEntryInput = Omit<AuditEntry, 'id' | 'timestamp'>;
export type AuditLogSink = (entry: AuditEntryInput) => unknown;
export type DurableAuditPhase = 'intent' | 'outcome';

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
  if (!onAuditLog) return;
  await onAuditLog(withDurableAuditPhase(entry, phase, pairId));
}

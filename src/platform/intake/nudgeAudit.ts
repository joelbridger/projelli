import type { AuditEntry } from '@/platform/types/audit';

type IntakeNudgeAuditEmitter = (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;

let activeIntakeNudgeAuditEmitter: IntakeNudgeAuditEmitter | null = null;

export function setIntakeNudgeAuditEmitter(emitter: IntakeNudgeAuditEmitter | null): void {
  activeIntakeNudgeAuditEmitter = emitter;
}

export function logIntakeNudgeAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
  activeIntakeNudgeAuditEmitter?.(entry);
}

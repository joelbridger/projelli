import type { AuditEntry } from '@/platform/types/audit';
import { docSourceRefToString } from './documentSourceRef';
import type { DocumentExtractionProposalRecord } from './documentExtractionProposalStore';

export type DocumentExtractionAuditEmitter = (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => Promise<void>;
let activeEmitter: DocumentExtractionAuditEmitter | null = null;
export function setIntakeDocumentExtractionAuditEmitter(emitter: DocumentExtractionAuditEmitter | null): void { activeEmitter = emitter; }
export function logIntakeDocumentExtractionAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> | undefined {
  return activeEmitter?.(entry);
}
export async function mustLogIntakeDocumentExtractionAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> {
  if (!activeEmitter) throw new Error('Document extraction audit is not available.');
  await activeEmitter({ ...entry, metadata: { ...entry.metadata, auditMustPersist: true } });
}
export function documentExtractionAuditPairId(proposalId: string): string { return `intake_doc_extraction:${proposalId}:${Date.now().toString(36)}`; }
export function buildDocumentExtractionAuditEntry(input: {
  proposal: Pick<DocumentExtractionProposalRecord, 'proposalId' | 'matterId' | 'requestId' | 'items'>;
  phase: 'intent' | 'outcome'; auditPairId: string; advisorId: string;
  itemIds: string[]; factIds?: string[]; status: 'intent' | 'accepted' | 'partial' | 'failed' | 'dismissed';
  operation?: 'accept' | 'dismiss'; error?: string;
}): Omit<AuditEntry, 'id' | 'timestamp'> {
  const selected = input.proposal.items.filter((item) => input.itemIds.includes(item.id));
  return {
    action: 'intake_doc_extraction',
    description: input.phase === 'intent' ? 'Document fact review started.' : `Document fact review finished with status ${input.status}.`,
    model: undefined,
    inputs: { matterId: input.proposal.matterId, requestId: input.proposal.requestId, proposalIds: [input.proposal.proposalId], factKinds: selected.map((item) => item.kind), sourceRefs: selected.map((item) => docSourceRefToString(item.source)), channel: 'doc_extraction' },
    outputs: { status: input.status, factIds: input.factIds ?? [], ...(input.error ? { error: input.error } : {}) },
    userDecision: input.phase === 'intent' ? (input.operation === 'dismiss' ? 'rejected' : 'approved') : 'auto',
    metadata: { auditEventType: 'intake_doc_extraction', phase: input.phase, auditPairId: input.auditPairId, proposalId: input.proposal.proposalId, advisorId: input.advisorId, channel: 'doc_extraction', operation: input.operation ?? 'accept' },
  };
}

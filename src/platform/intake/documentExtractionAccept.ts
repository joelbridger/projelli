import { docSourceRefToString } from './documentSourceRef';
import { intakeFactUpsert, type IntakeFactUpsertInput, type MaskedClientFact } from './factsStore';
import { buildDocumentExtractionAuditEntry, documentExtractionAuditPairId, mustLogIntakeDocumentExtractionAudit } from './documentExtractionAudit';
import { documentExtractionProposalGetForAccept, documentExtractionProposalMarkRowCompleted, documentExtractionProposalSetStatus, isDocumentExtractionProposalItemSelectable, type DocumentExtractionProposalItem, type DocumentExtractionProposalRecord } from './documentExtractionProposalStore';

export interface DocumentExtractionAcceptResult { status: 'accepted' | 'partial' | 'failed'; factIds: string[]; errors: string[]; }
export interface AcceptDocumentExtractionProposalOptions {
  proposalId: string; selectedRowIds: string[]; advisorId: string; finalValues?: Record<string, import('./types').FactValue>; now?: Date;
  getProposal?: (id: string) => Promise<DocumentExtractionProposalRecord>; upsertFact?: (input: IntakeFactUpsertInput) => Promise<MaskedClientFact>;
  setProposalStatus?: typeof documentExtractionProposalSetStatus; markRowCompleted?: typeof documentExtractionProposalMarkRowCompleted;
}
function rowsForAccept(proposal: DocumentExtractionProposalRecord, ids: string[]): DocumentExtractionProposalItem[] {
  const selected = new Set(ids); const completed = new Set(proposal.completedRows.map((row) => row.rowId));
  return proposal.items.filter((row) => selected.has(row.id) && !completed.has(row.id) && isDocumentExtractionProposalItemSelectable(row));
}
function factInput(proposal: DocumentExtractionProposalRecord, row: DocumentExtractionProposalItem, advisorId: string, at: string, value: import('./types').FactValue): IntakeFactUpsertInput {
  return { matter_id: proposal.matterId, subject: row.subject || 'primary', kind: row.kind, value, sensitivity: row.sensitivity, provenance: { channel: 'doc_extraction', source_ref: docSourceRefToString(row.source), entered_by: advisorId, confirmed_by: advisorId, at }, verification: 'document_verified' };
}
export async function acceptDocumentExtractionProposal(options: AcceptDocumentExtractionProposalOptions): Promise<DocumentExtractionAcceptResult> {
  const proposal = await (options.getProposal ?? documentExtractionProposalGetForAccept)(options.proposalId);
  const rows = rowsForAccept(proposal, options.selectedRowIds);
  if (!rows.length) throw new Error('Choose at least one document fact to approve.');
  const at = (options.now ?? new Date()).toISOString(); const auditPairId = documentExtractionAuditPairId(proposal.proposalId);
  await mustLogIntakeDocumentExtractionAudit(buildDocumentExtractionAuditEntry({ proposal, phase: 'intent', auditPairId, advisorId: options.advisorId, itemIds: rows.map((row) => row.id), status: 'intent' }));
  const factIds: string[] = []; const errors: string[] = [];
  const upsert = options.upsertFact ?? intakeFactUpsert; const complete = options.markRowCompleted ?? documentExtractionProposalMarkRowCompleted;
  for (const row of rows) {
    try {
      const value = options.finalValues?.[row.id] ?? row.value;
      if (!value) throw new Error('This document fact has no safe value to save.');
      const fact = await upsert(factInput(proposal, row, options.advisorId, at, value));
      await complete({ proposalId: proposal.proposalId, completion: { rowId: row.id, factId: fact.fact_id, completedAt: at } });
      factIds.push(fact.fact_id);
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  const status: DocumentExtractionAcceptResult['status'] = errors.length ? (factIds.length ? 'partial' : 'failed') : 'accepted';
  await mustLogIntakeDocumentExtractionAudit(buildDocumentExtractionAuditEntry({ proposal, phase: 'outcome', auditPairId, advisorId: options.advisorId, itemIds: rows.map((row) => row.id), factIds, status, ...(errors.length ? { error: errors.join('; ') } : {}) }));
  if (status === 'accepted') await (options.setProposalStatus ?? documentExtractionProposalSetStatus)(proposal.proposalId, 'accepted');
  return { status, factIds, errors };
}
export async function dismissDocumentExtractionProposal(options: { proposalId: string; advisorId: string; getProposal?: (id: string) => Promise<DocumentExtractionProposalRecord>; setProposalStatus?: typeof documentExtractionProposalSetStatus }): Promise<void> {
  const proposal = await (options.getProposal ?? documentExtractionProposalGetForAccept)(options.proposalId); const auditPairId = documentExtractionAuditPairId(proposal.proposalId); const itemIds = proposal.items.map((item) => item.id);
  await mustLogIntakeDocumentExtractionAudit(buildDocumentExtractionAuditEntry({ proposal, phase: 'intent', operation: 'dismiss', auditPairId, advisorId: options.advisorId, itemIds, status: 'intent' }));
  await (options.setProposalStatus ?? documentExtractionProposalSetStatus)(proposal.proposalId, 'dismissed');
  await mustLogIntakeDocumentExtractionAudit(buildDocumentExtractionAuditEntry({ proposal, phase: 'outcome', operation: 'dismiss', auditPairId, advisorId: options.advisorId, itemIds, status: 'dismissed' }));
}

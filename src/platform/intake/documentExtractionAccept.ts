import { docSourceRefToString } from './documentSourceRef';
import { intakeFactUpsert, type IntakeFactUpsertInput, type MaskedClientFact } from './factsStore';
import { buildDocumentExtractionAuditEntry, documentExtractionAuditPairId, mustLogIntakeDocumentExtractionAudit } from './documentExtractionAudit';
import { documentExtractionProposalAcceptRow, documentExtractionProposalGetForAccept, documentExtractionProposalMarkRowCompleted, documentExtractionProposalSetStatus, isDocumentExtractionProposalItemSelectable, type DocumentExtractionProposalItem, type DocumentExtractionProposalRecord } from './documentExtractionProposalStore';

export interface DocumentExtractionAcceptResult { status: 'accepted' | 'partial' | 'failed'; factIds: string[]; errors: string[]; }
export interface AcceptDocumentExtractionProposalOptions {
  proposalId: string; matterId?: string; selectedRowIds: string[]; advisorId: string; finalValues?: Record<string, import('./types').FactValue>; expectedActiveFactIds?: Record<string, string | null>; now?: Date;
  getProposal?: (id: string) => Promise<DocumentExtractionProposalRecord>; upsertFact?: (input: IntakeFactUpsertInput) => Promise<MaskedClientFact>;
  acceptRow?: typeof documentExtractionProposalAcceptRow;
  setProposalStatus?: typeof documentExtractionProposalSetStatus; markRowCompleted?: typeof documentExtractionProposalMarkRowCompleted;
}
function rowsForAccept(proposal: DocumentExtractionProposalRecord, ids: string[]): DocumentExtractionProposalItem[] {
  const selected = new Set(ids); const completed = new Set(proposal.completedRows.map((row) => row.rowId));
  return proposal.items.filter((row) => selected.has(row.id) && !completed.has(row.id) && isDocumentExtractionProposalItemSelectable(row));
}
function factInput(proposal: DocumentExtractionProposalRecord, row: DocumentExtractionProposalItem, advisorId: string, at: string, value: import('./types').FactValue): IntakeFactUpsertInput {
  return { matter_id: proposal.matterId, subject: row.subject, kind: row.kind, value, sensitivity: 'confidential', provenance: { channel: 'doc_extraction', source_ref: docSourceRefToString(row.source), entered_by: advisorId, confirmed_by: advisorId, at }, verification: 'document_verified' };
}
function validatedMoneyValue(row: DocumentExtractionProposalItem, value: import('./types').FactValue): Extract<import('./types').FactValue, { t: 'money' }> {
  const proposedValue = row.value;
  if (!isDocumentExtractionProposalItemSelectable(row) || value.t !== 'money' || !Number.isFinite(value.v.amount) || value.v.amount < 0 || !/^[A-Z]{3}$/u.test(value.v.currency) || !proposedValue || proposedValue.t !== 'money' || value.v.currency !== proposedValue.v.currency) throw new Error('Document extraction approval must use a non-negative money amount for the selected row.');
  return value;
}
function valuesForAccept(proposal: DocumentExtractionProposalRecord, rows: DocumentExtractionProposalItem[], finalValues: Record<string, import('./types').FactValue> | undefined): Map<string, Extract<import('./types').FactValue, { t: 'money' }> > {
  const selected = new Set(rows.map((row) => row.id));
  for (const [rowId, value] of Object.entries(finalValues ?? {})) {
    const row = proposal.items.find((candidate) => candidate.id === rowId);
    if (!row || !selected.has(rowId)) throw new Error('Document extraction approval includes an unselected or unknown row.');
    validatedMoneyValue(row, value);
  }
  return new Map(rows.map((row) => {
    const value = finalValues?.[row.id] ?? row.value;
    if (!value) throw new Error('Document extraction approval must include a value for every selected row.');
    return [row.id, validatedMoneyValue(row, value)];
  }));
}
export async function acceptDocumentExtractionProposal(options: AcceptDocumentExtractionProposalOptions): Promise<DocumentExtractionAcceptResult> {
  const getProposal = options.getProposal ?? ((proposalId: string) => {
    if (!options.matterId) return Promise.reject(new Error('An active client is required to open document extraction review.'));
    return documentExtractionProposalGetForAccept(proposalId, options.matterId);
  });
  const proposal = await getProposal(options.proposalId);
  const rows = rowsForAccept(proposal, options.selectedRowIds);
  if (!rows.length) throw new Error('Choose at least one document fact to approve.');
  const values = valuesForAccept(proposal, rows, options.finalValues);
  const at = (options.now ?? new Date()).toISOString(); const auditPairId = documentExtractionAuditPairId(proposal.proposalId);
  await mustLogIntakeDocumentExtractionAudit(buildDocumentExtractionAuditEntry({ proposal, phase: 'intent', auditPairId, advisorId: options.advisorId, itemIds: rows.map((row) => row.id), status: 'intent' }));
  const factIds: string[] = []; const errors: string[] = [];
  const upsert = options.upsertFact ?? intakeFactUpsert; const complete = options.markRowCompleted ?? documentExtractionProposalMarkRowCompleted;
  for (const row of rows) {
    try {
      const value = values.get(row.id);
      if (!value) throw new Error('Document extraction approval lost a selected row value.');
      const expectedActiveFactId = options.expectedActiveFactIds?.[row.id];
      if (!options.upsertFact) {
        const accepted = await (options.acceptRow ?? documentExtractionProposalAcceptRow)({ proposalId: proposal.proposalId, matterId: proposal.matterId, rowId: row.id, amount: value.v.amount, expectedActiveFactId: expectedActiveFactId ?? null, expectedActiveFactChecked: Object.prototype.hasOwnProperty.call(options.expectedActiveFactIds ?? {}, row.id), advisorId: options.advisorId });
        factIds.push(accepted.fact.fact_id);
        continue;
      }
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
export async function dismissDocumentExtractionProposal(options: { proposalId: string; matterId?: string; advisorId: string; getProposal?: (id: string) => Promise<DocumentExtractionProposalRecord>; setProposalStatus?: typeof documentExtractionProposalSetStatus }): Promise<void> {
  const getProposal = options.getProposal ?? ((proposalId: string) => {
    if (!options.matterId) return Promise.reject(new Error('An active client is required to open document extraction review.'));
    return documentExtractionProposalGetForAccept(proposalId, options.matterId);
  });
  const proposal = await getProposal(options.proposalId); const auditPairId = documentExtractionAuditPairId(proposal.proposalId); const itemIds = proposal.items.map((item) => item.id);
  await mustLogIntakeDocumentExtractionAudit(buildDocumentExtractionAuditEntry({ proposal, phase: 'intent', operation: 'dismiss', auditPairId, advisorId: options.advisorId, itemIds, status: 'intent' }));
  await (options.setProposalStatus ?? documentExtractionProposalSetStatus)(proposal.proposalId, 'dismissed');
  await mustLogIntakeDocumentExtractionAudit(buildDocumentExtractionAuditEntry({ proposal, phase: 'outcome', operation: 'dismiss', auditPairId, advisorId: options.advisorId, itemIds, status: 'dismissed' }));
}

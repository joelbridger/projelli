import { useCallback, useEffect, useState } from 'react';
import { FileSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/button';
import { acceptDocumentExtractionProposal, dismissDocumentExtractionProposal, type DocumentExtractionAcceptResult } from '@/platform/intake/documentExtractionAccept';
import { intakeFactList, type MaskedClientFact } from '@/platform/intake/factsStore';
import { documentExtractionProposalGetForAccept, documentExtractionProposalList, isDocumentExtractionProposalItemSelectable, type DocumentExtractionProposalRecord } from '@/platform/intake/documentExtractionProposalStore';
import type { FactValue } from '@/platform/intake/types';
import { DocumentExtractionReviewModal, type DocumentExtractionConflictResolution } from './DocumentExtractionReviewModal';

export interface DocumentExtractionProposalCardProps { matterId: string; advisorId: string; onAccepted?: (result: DocumentExtractionAcceptResult) => void; }

function defaults(proposal: DocumentExtractionProposalRecord): Set<string> {
  return new Set(proposal.items.filter((row) => row.confidence === 'high' && row.checkedByDefault && isDocumentExtractionProposalItemSelectable(row)).map((row) => row.id));
}

export function DocumentExtractionProposalCard({ matterId, advisorId, onAccepted }: DocumentExtractionProposalCardProps) {
  const { t } = useTranslation();
  const [proposals, setProposals] = useState<DocumentExtractionProposalRecord[]>([]);
  const [review, setReview] = useState<DocumentExtractionProposalRecord | null>(null);
  const [facts, setFacts] = useState<MaskedClientFact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [expectedActiveFactIds, setExpectedActiveFactIds] = useState<Record<string, string | null>>({});
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, DocumentExtractionConflictResolution>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void documentExtractionProposalList(matterId)
      .then(setProposals)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : t('intake.document-extraction.load-error'));
      });
  }, [matterId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (summary: DocumentExtractionProposalRecord) => {
    try {
      const [full, activeFacts] = await Promise.all([documentExtractionProposalGetForAccept(summary.proposalId, matterId), intakeFactList(matterId)]);
      const expected = Object.fromEntries(full.items.map((row) => [row.id, activeFacts.find((fact) => fact.matter_id === full.matterId && fact.subject === 'primary' && fact.kind === row.kind && fact.status === 'active')?.fact_id ?? null]));
      const conflicting = new Set(Object.entries(expected).filter(([, factId]) => factId !== null).map(([rowId]) => rowId));
      setReview(full);
      setFacts(activeFacts);
      setExpectedActiveFactIds(expected);
      setConflictResolutions({});
      setSelected(new Set([...defaults(full)].filter((rowId) => !conflicting.has(rowId))));
      setAmounts(Object.fromEntries(full.items.filter((row) => !conflicting.has(row.id) && row.value?.t === 'money').map((row) => [row.id, String((row.value as Extract<FactValue, { t: 'money' }>).v.amount)])));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('intake.document-extraction.open-error'));
    }
  };

  const resolveConflict = (rowId: string, resolution: DocumentExtractionConflictResolution) => {
    setConflictResolutions((current) => ({ ...current, [rowId]: resolution }));
    setSelected((current) => {
      const next = new Set(current);
      if (resolution === 'keep') next.delete(rowId);
      else next.add(rowId);
      return next;
    });
    setAmounts((current) => {
      const row = review?.items.find((candidate) => candidate.id === rowId);
      if (resolution === 'keep') return Object.fromEntries(Object.entries(current).filter(([key]) => key !== rowId));
      const next = { ...current };
      if (resolution === 'replace' && row?.value?.t === 'money') next[rowId] = String(row.value.v.amount);
      else if (resolution === 'edit') next[rowId] = '';
      return next;
    });
  };

  const finalValues = (): Record<string, FactValue> => {
    const values: Record<string, FactValue> = {};
    for (const rowId of selected) {
      const row = review?.items.find((candidate) => candidate.id === rowId);
      const amount = amounts[rowId];
      if (!row?.value || row.value.t !== 'money' || amount === undefined || amount.trim() === '') throw new Error(t('intake.document-extraction.amount-required'));
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error(t('intake.document-extraction.amount-invalid'));
      values[rowId] = { t: 'money', v: { amount: parsed, currency: row.value.v.currency } };
    }
    return values;
  };

  const approve = async () => {
    if (!review) return;
    setBusy(true);
    setError('');
    try {
      const result = await acceptDocumentExtractionProposal({ proposalId: review.proposalId, matterId, selectedRowIds: [...selected], advisorId, finalValues: finalValues(), expectedActiveFactIds });
      if (onAccepted) onAccepted(result);
      setReview(null);
      load();
      if (result.status !== 'accepted') setError(result.errors.join('; ') || t('intake.document-extraction.partial-error'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('intake.document-extraction.accept-error'));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    if (!review) return;
    setBusy(true);
    try {
      await dismissDocumentExtractionProposal({ proposalId: review.proposalId, advisorId, getProposal: (proposalId) => documentExtractionProposalGetForAccept(proposalId, matterId) });
      setReview(null);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('intake.document-extraction.dismiss-error'));
    } finally {
      setBusy(false);
    }
  };

  if (!proposals.length && !error) return null;
  return <section data-testid="document-extraction-proposal-card" style={{ border: '1px solid var(--kp-warning-line)', borderRadius: 8, background: 'var(--kp-warning-bg)', padding: 14, display: 'grid', gap: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FileSearch aria-hidden size={17} style={{ color: 'var(--kp-warning)' }} /><div><h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--kp-navy)' }}>{t('intake.document-extraction.title')}</h3><p style={{ margin: '4px 0 0', color: 'var(--color-muted-foreground)', fontSize: 12 }}>{t('intake.document-extraction.helper')}</p></div></div>
    {error ? <div style={{ color: 'var(--kp-danger)', fontSize: 12 }}>{error}</div> : null}
    {proposals.map((proposal) => <div key={proposal.proposalId} style={{ borderTop: '1px solid var(--kp-warning-line)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}><div style={{ color: 'var(--kp-navy)', fontSize: 13 }}>{t('intake.document-extraction.proposed-count', { count: proposal.items.length })}</div><Button type="button" variant="outline" size="sm" onClick={() => { void open(proposal).catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : t('intake.document-extraction.open-error')); }); }}>{t('intake.document-extraction.review')}</Button></div>)}
    {review ? <DocumentExtractionReviewModal proposal={review} selectedIds={selected} facts={facts} finalAmounts={amounts} conflictResolutions={conflictResolutions} onToggle={(id) => { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }} onFinalAmountChange={(id, value) => { setAmounts((current) => ({ ...current, [id]: value })); }} onResolveConflict={resolveConflict} onAccept={() => { void approve().catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : t('intake.document-extraction.accept-error')); }); }} onDismiss={() => { void dismiss().catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : t('intake.document-extraction.dismiss-error')); }); }} onClose={() => { setReview(null); }} accepting={busy} dismissing={busy} /> : null}
  </section>;
}

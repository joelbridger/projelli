import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/button';
import type { DocumentExtractionProposalRecord } from '@/platform/intake/documentExtractionProposalStore';
import type { MaskedClientFact } from '@/platform/intake/factsStore';
import { DocumentExtractionProposalRow } from './DocumentExtractionProposalRow';

export type DocumentExtractionConflictResolution = 'keep' | 'replace' | 'edit';
export interface DocumentExtractionReviewModalProps { proposal: DocumentExtractionProposalRecord; selectedIds: Set<string>; facts: MaskedClientFact[]; finalAmounts: Record<string, string>; conflictResolutions: Record<string, DocumentExtractionConflictResolution>; onToggle: (id: string) => void; onFinalAmountChange: (id: string, value: string) => void; onResolveConflict: (id: string, resolution: DocumentExtractionConflictResolution) => void; onAccept: () => void; onDismiss: () => void; onClose: () => void; accepting: boolean; dismissing: boolean; }
export function DocumentExtractionReviewModal(props: DocumentExtractionReviewModalProps) {
  const { t } = useTranslation();
  return <div className="kp-overlay" role="dialog" aria-modal="true" aria-label={t('intake.document-extraction.review-title')} style={{ display: 'grid', placeItems: 'center', padding: 18 }}><div style={{ width: 'min(720px, 100%)', maxHeight: 'min(720px, 92vh)', overflow: 'auto', background: 'var(--color-background)', border: '1px solid var(--kp-divider)', borderRadius: 8, boxShadow: 'var(--kp-shadow-3)', padding: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><div><h3 style={{ margin: 0, color: 'var(--kp-navy)', fontSize: 16 }}>{t('intake.document-extraction.review-title')}</h3><p style={{ margin: '4px 0 0', color: 'var(--color-muted-foreground)', fontSize: 12 }}>{t('intake.document-extraction.review-helper')}</p></div><Button type="button" variant="ghost" size="icon" onClick={props.onClose}><X className="h-4 w-4" aria-hidden /></Button></div>
    <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>{props.proposal.items.map((row) => { const existing = props.facts.find((fact) => fact.kind === row.kind && fact.subject === 'primary' && fact.matter_id === props.proposal.matterId && fact.status === 'active'); return <DocumentExtractionProposalRow key={row.id} row={row} checked={props.selectedIds.has(row.id)} {...(existing ? { existingValue: existing.display_value } : {})} {...(props.finalAmounts[row.id] === undefined ? {} : { finalAmount: props.finalAmounts[row.id] })} {...(props.conflictResolutions[row.id] === undefined ? {} : { conflictResolution: props.conflictResolutions[row.id] })} onToggle={props.onToggle} onFinalAmountChange={props.onFinalAmountChange} onResolveConflict={props.onResolveConflict} />; })}</div>
    <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 8 }}><Button type="button" variant="outline" onClick={props.onClose}>{t('intake.document-extraction.cancel')}</Button><Button type="button" variant="outline" onClick={props.onDismiss} disabled={props.accepting || props.dismissing}>{t('intake.document-extraction.dismiss')}</Button><Button type="button" onClick={props.onAccept} disabled={props.accepting || props.dismissing || props.selectedIds.size === 0}>{t('intake.document-extraction.approve-checked')}</Button></div>
  </div></div>;
}

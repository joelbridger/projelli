import { useTranslation } from 'react-i18next';

import type { DocumentExtractionProposalItem } from '@/platform/intake/documentExtractionProposalStore';
import type { DocumentExtractionConflictResolution } from './DocumentExtractionReviewModal';

export interface DocumentExtractionProposalRowProps {
  row: DocumentExtractionProposalItem;
  checked: boolean;
  existingValue?: string;
  finalAmount?: string;
  conflictResolution?: DocumentExtractionConflictResolution;
  onToggle: (id: string) => void;
  onFinalAmountChange: (id: string, value: string) => void;
  onResolveConflict: (id: string, resolution: DocumentExtractionConflictResolution) => void;
}

export function DocumentExtractionProposalRow({ row, checked, existingValue, finalAmount, conflictResolution, onToggle, onFinalAmountChange, onResolveConflict }: DocumentExtractionProposalRowProps) {
  const { t } = useTranslation();
  const confidenceColor = row.confidence === 'high' ? 'var(--kp-success-text)' : row.confidence === 'medium' ? 'var(--kp-warning)' : 'var(--color-muted-foreground)';
  const hasConflict = existingValue !== undefined;
  return <div data-testid="document-extraction-proposal-row" style={{ border: '1px solid var(--kp-divider)', borderRadius: 8, background: 'var(--kp-surface-card)', padding: 12, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 10 }}>
    <input aria-label={t('intake.document-extraction.select-row')} type="checkbox" checked={checked} disabled={!row.value || hasConflict} onChange={() => { onToggle(row.id); }} style={{ marginTop: 3 }} />
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ fontSize: 13, color: 'var(--kp-navy)' }}>{row.kind === 'income_annual' ? t('intake.document-extraction.income-annual') : t('intake.document-extraction.spending-monthly')}</strong><span style={{ fontSize: 11, color: confidenceColor, fontWeight: 800, textTransform: 'uppercase' }}>{t(`intake.document-extraction.confidence.${row.confidence}`)}</span></div>
      <div data-testid="document-extraction-proposed-value" style={{ marginTop: 5, fontSize: 13, color: 'var(--kp-navy)' }}>{t('intake.document-extraction.proposed-value', { value: row.displayValue })}</div>
      <div data-testid="document-extraction-citation" style={{ marginTop: 5, color: 'var(--color-muted-foreground)', fontSize: 12 }}>{t('intake.document-extraction.citation', { page: row.source.page ?? 1, quote: row.source.snippet })}</div>
      <div style={{ marginTop: 5, color: 'var(--color-muted-foreground)', fontSize: 12 }}>{row.reason}</div>
      {hasConflict ? <div data-testid="document-extraction-conflict" style={{ marginTop: 9, padding: 8, borderRadius: 6, background: 'var(--kp-warning-bg)', color: 'var(--kp-navy)', fontSize: 12 }}>
        {t('intake.document-extraction.conflict-helper', { value: existingValue })}
        <div role="radiogroup" aria-label={t('intake.document-extraction.conflict-choice-label')} style={{ display: 'grid', gap: 5, marginTop: 7 }}>
          {(['keep', 'replace', 'edit'] as const).map((resolution) => <label key={resolution}><input type="radio" name={`document-extraction-conflict-${row.id}`} checked={conflictResolution === resolution} onChange={() => { onResolveConflict(row.id, resolution); }} /> {t(`intake.document-extraction.conflict-${resolution}`)}</label>)}
        </div>
        {conflictResolution === 'edit' ? <label style={{ display: 'block', marginTop: 6 }}>{t('intake.document-extraction.final-amount')} <input aria-label={t('intake.document-extraction.final-amount')} value={finalAmount ?? ''} inputMode="decimal" onChange={(event) => { onFinalAmountChange(row.id, event.currentTarget.value); }} style={{ marginLeft: 6, border: '1px solid var(--kp-divider)', borderRadius: 4, padding: '3px 6px', background: 'var(--kp-surface-card)' }} /></label> : null}
      </div> : null}
    </div>
  </div>;
}

import type { DocumentExtractionProposalItem } from '@/platform/intake/documentExtractionProposalStore';

export interface DocumentExtractionProposalRowProps {
  row: DocumentExtractionProposalItem;
  checked: boolean;
  existingValue?: string;
  finalAmount?: string;
  onToggle: (id: string) => void;
  onFinalAmountChange: (id: string, value: string) => void;
}
export function DocumentExtractionProposalRow({ row, checked, existingValue, finalAmount, onToggle, onFinalAmountChange }: DocumentExtractionProposalRowProps) {
  const confidenceColor = row.confidence === 'high' ? 'var(--kp-success-text)' : row.confidence === 'medium' ? 'var(--kp-warning)' : 'var(--color-muted-foreground)';
  return <div data-testid="document-extraction-proposal-row" style={{ border: '1px solid var(--kp-divider)', borderRadius: 8, background: 'var(--kp-surface-card)', padding: 12, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 10 }}>
    <input aria-label="Select document fact" type="checkbox" checked={checked} disabled={!row.value} onChange={() => onToggle(row.id)} style={{ marginTop: 3 }} />
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13, color: 'var(--kp-navy)' }}>{row.kind === 'income_annual' ? 'Annual income' : 'Monthly spending'}</strong>
        <span style={{ fontSize: 11, color: confidenceColor, fontWeight: 800, textTransform: 'uppercase' }}>{row.confidence}</span>
      </div>
      <div data-testid="document-extraction-proposed-value" style={{ marginTop: 5, fontSize: 13, color: 'var(--kp-navy)' }}>Proposed: {row.displayValue}</div>
      <div data-testid="document-extraction-citation" style={{ marginTop: 5, color: 'var(--color-muted-foreground)', fontSize: 12 }}>Page {row.source.page ?? 1}: “{row.source.snippet}”</div>
      <div style={{ marginTop: 5, color: 'var(--color-muted-foreground)', fontSize: 12 }}>{row.reason}</div>
      {existingValue ? <div data-testid="document-extraction-conflict" style={{ marginTop: 9, padding: 8, borderRadius: 6, background: 'var(--kp-warning-bg)', color: 'var(--kp-navy)', fontSize: 12 }}>
        Existing active fact: {existingValue}. Choose the final amount before approving.
        <label style={{ display: 'block', marginTop: 6 }}>Final amount <input aria-label="Final amount" value={finalAmount ?? ''} inputMode="decimal" onChange={(event) => onFinalAmountChange(row.id, event.currentTarget.value)} style={{ marginLeft: 6, border: '1px solid var(--kp-divider)', borderRadius: 4, padding: '3px 6px', background: 'var(--kp-surface-card)' }} /></label>
      </div> : null}
    </div>
  </div>;
}

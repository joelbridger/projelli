import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DocumentExtractionProposalCard } from '../DocumentExtractionProposalCard';
import { clearInMemoryDocumentExtractionQueuesForTests, documentExtractionProposalSave, documentExtractionStableKey, stableDocumentExtractionProposalId } from '@/platform/intake/documentExtractionProposalStore';
import { clearInMemoryFactsForTests, intakeFactList } from '@/platform/intake/factsStore';

const ids = { matterId: 'matter-1', requestId: 'request-1', intakeId: 'intake-1', sourcePath: 'Clients/A/budget.pdf' };
describe('DocumentExtractionProposalCard', () => {
  beforeEach(async () => {
    clearInMemoryDocumentExtractionQueuesForTests(); clearInMemoryFactsForTests();
    await documentExtractionProposalSave({ proposalId: stableDocumentExtractionProposalId(ids), stableKey: documentExtractionStableKey(ids), ...ids, items: [
      { id: 'high', subject: 'primary', kind: 'income_annual', value: { t: 'money', v: { amount: 120000, currency: 'USD' } }, displayValue: 'USD 120000', sensitivity: 'confidential', source: { kind: 'document', path: ids.sourcePath, page: 1, snippet: 'Annual income: $120,000', extraction: 'text' }, confidence: 'high', reason: 'Printed total.', checkedByDefault: true },
      { id: 'medium', subject: 'primary', kind: 'spending_monthly', value: { t: 'money', v: { amount: 3000, currency: 'USD' } }, displayValue: 'USD 3000', sensitivity: 'confidential', source: { kind: 'document', path: ids.sourcePath, page: 2, snippet: 'Monthly spending: $3,000', extraction: 'text' }, confidence: 'medium', reason: 'Printed total.', checkedByDefault: false },
    ] });
  });
  it('does not write on render and shows page citation before approval', async () => {
    render(<DocumentExtractionProposalCard matterId="matter-1" advisorId="advisor-1" />);
    await screen.findByText('Facts found in documents');
    expect(await intakeFactList('matter-1')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Review document facts' })).toBeTruthy());
    expect(screen.getAllByTestId('document-extraction-citation')[0]?.textContent).toContain('Page 1');
    const checks = screen.getAllByRole('checkbox', { name: 'Select document fact' }) as HTMLInputElement[];
    expect(checks[0]?.checked).toBe(true);
    expect(checks[1]?.checked).toBe(false);
  });
});

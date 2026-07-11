import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useIntakeStore, type IntakeRecord } from '@/platform/intake/intakeStore';
import { ClientRequestsTab } from '../ClientRequestsTab';

vi.mock('@/platform/intake/factsStore', () => ({
  intakeFactList: vi.fn(() => Promise.resolve([])), intakeFactReveal: vi.fn(), intakeFactPurge: vi.fn(), intakeFactUpsert: vi.fn(), intakeFactMatchList: vi.fn(() => Promise.resolve([])),
}));
vi.mock('@/platform/intake/emailReplyProposalStore', () => ({ emailReplyProposalList: vi.fn(() => Promise.resolve([])), isEmailReplyProposalItemSelectable: vi.fn(() => true) }));
vi.mock('@/platform/intake/emailQuarantineStore', () => ({ listEmailQuarantines: vi.fn(() => Promise.resolve([])) }));
vi.mock('@/platform/intake/documentExtractionProposalStore', () => ({ documentExtractionProposalList: vi.fn(() => Promise.resolve([])) }));

function pdfRequest(state: IntakeRecord['items'][number]['state']): IntakeRecord {
  return {
    intakeId: 'form-request', matterId: 'matter-1', kind: 'standing', requestTitle: 'Beneficiary update', requestSlug: 'beneficiary-update-a1',
    clientFirstName: 'Sarah', firmName: 'North Star', status: 'active', expiresAt: '2026-08-09T00:00:00.000Z', checklistVersion: 1,
    items: [{ itemId: 'pdf-form', label: 'Private field name', state, filePath: '/workspace/Sarah/Requests/beneficiary-update-a1/forms/raw-client-file.pdf' }],
    requestItems: [{
      t: 'pdf_fill', item_id: 'pdf-form', label: 'Sensitive template title', help_text: '', required: true, subject: 'primary', prefill: [],
      template: { templateId: 'template_approved_01', version: 1, kind: 'acroform', sourceSha256: 'a'.repeat(64), sourceArtifactRef: 'sealed-artifact:abcdefghijklmnop', outputFileStem: 'completed-form', maxOutputBytes: 1024, fields: { client_name: { kind: 'acroform', field_id: 'client_name', pdf_field_type: 'text', acroform_field: 'client_name' } } },
    }],
    receivedItems: [], flags: [], knownSessionIds: [], knownSubmissionIds: [], nudges: [],
  };
}

describe('PDF form request status', () => {
  beforeEach(() => { useIntakeStore.getState().resetForTests(); });

  it('shows only the safe PDF form statuses in the correct request row', () => {
    const store = useIntakeStore.getState();
    store.upsertIntake(pdfRequest('not_started'));
    store.upsertIntake({ ...pdfRequest('received'), intakeId: 'other-request', matterId: 'matter-2', requestTitle: 'Other request' });
    render(<ClientRequestsTab matterId="matter-1" clientName="Sarah Smith" issueRequest={vi.fn()} />);

    const row = screen.getByTestId('client-request-form-request');
    expect(within(row).getByText('Form ready')).toBeTruthy();
    expect(within(row).getByText('Form')).toBeTruthy();
    expect(within(row).queryByText('Signed')).toBeNull();
    expect(within(row).queryByText('Private field name')).toBeNull();
    expect(within(row).queryByText('Sensitive template title')).toBeNull();
    expect(within(row).queryByText(/raw-client-file/iu)).toBeNull();

    act(() => { store.updateItem('form-request', { ...pdfRequest('received').items[0], state: 'received' }); });
    expect(within(row).getByText('Form returned')).toBeTruthy();
    act(() => { store.updateItem('form-request', { ...pdfRequest('needs_followup').items[0], state: 'needs_followup' }); });
    expect(within(row).getByText('Needs follow-up')).toBeTruthy();
  });
});

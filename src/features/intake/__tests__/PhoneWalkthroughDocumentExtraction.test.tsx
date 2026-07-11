import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PhoneWalkthrough } from '../PhoneWalkthrough';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { useIntakeStore, type IntakeRecord } from '@/platform/intake/intakeStore';
import {
  useDocumentExtractionIngestion,
  type DocumentExtractionIngestionDeps,
} from '@/platform/intake/useDocumentExtractionIngestion';
import type { Provider } from '@/platform/providers/Provider';
import {
  clearInMemoryDocumentExtractionQueuesForTests,
  documentExtractionProposalList,
  documentExtractionProposalSave,
} from '@/platform/intake/documentExtractionProposalStore';

function defaultStructuredOutput(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    facts: [{
      fact_kind: 'income_annual',
      amount: 120000,
      currency: 'USD',
      page: 1,
      quote: 'Annual income: $120,000',
      confidence: 'high',
    }],
  });
}

function provider(structuredOutput: ReturnType<typeof vi.fn>): Provider {
  return {
    getMetadata: () => ({ model: 'test-model' }),
    sendMessage: vi.fn(),
    structuredOutput: structuredOutput as unknown as Provider['structuredOutput'],
    formatAttachmentForRequest: vi.fn(),
    supportsAttachment: vi.fn(),
  };
}

function IngestionHarness({ deps }: { deps: DocumentExtractionIngestionDeps }) {
  useDocumentExtractionIngestion(deps);
  return null;
}

function intake(): IntakeRecord {
  const document = {
    t: 'doc_upload' as const,
    item_id: 'pay_stub',
    label: 'Pay stub',
    help_text: '',
    required: true,
    subject: 'primary',
  };
  return {
    intakeId: 'intake-phone-1',
    matterId: 'matter-1',
    clientFirstName: 'Sarah',
    firmName: 'North Star',
    status: 'active',
    expiresAt: '2026-08-01T00:00:00.000Z',
    checklistVersion: 1,
    requestItems: [document],
    items: [{ itemId: document.item_id, label: document.label, state: 'not_started' }],
    receivedItems: [],
    flags: [],
    knownSessionIds: [],
    knownSubmissionIds: [],
    nudges: [],
  };
}

describe('PhoneWalkthrough document extraction wiring', () => {
  beforeEach(() => {
    useIntakeStore.getState().resetForTests();
    clearInMemoryDocumentExtractionQueuesForTests();
  });

  it('persists an extraction proposal after an advisor files a document on a phone walkthrough', async () => {
    const structuredOutput = defaultStructuredOutput();
    const model = provider(structuredOutput);
    const saveProposal = vi.fn(documentExtractionProposalSave);
    const readDocument = vi.fn().mockResolvedValue({
      status: 'read' as const,
      pages: [{ page: 1, text: 'Annual income: $120,000', extraction: 'text' as const }],
    });
    const writeFileBinary = vi.fn().mockResolvedValue(undefined);
    const workspaceService = { writeFileBinary } as unknown as WorkspaceService;
    const record = intake();
    useIntakeStore.getState().upsertIntake(record);
    render(<>
      <IngestionHarness deps={{
        readDocument,
        classifyDocument: () => ({ kind: 'pay_stub', confidence: 'high', sourceRefs: [], evidence: [] }),
        saveProposal,
        resolveDocumentExtractionProvider: () => Promise.resolve({
          provider: model,
          providerId: 'test-provider',
          assuredAvailable: false,
        }),
      }} />
      <PhoneWalkthrough
        matterId="matter-1"
        intake={record}
        advisorId="advisor-1"
        workspaceService={workspaceService}
        matterFolderPath="/workspace/Sarah"
        onClose={vi.fn()}
      />
    </>);

    fireEvent.change(screen.getByLabelText('Choose document'), {
      target: { files: [new File(['pay stub'], 'pay-stub.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => { expect(saveProposal).toHaveBeenCalledTimes(1); });
    expect(writeFileBinary).toHaveBeenCalledTimes(1);
    expect(readDocument).toHaveBeenCalledWith(expect.objectContaining({
      path: '/workspace/Sarah/Requests/onboarding/pay-stub.pdf',
      mimeType: 'application/pdf',
    }));
    expect(structuredOutput).toHaveBeenCalledTimes(1);
    expect(saveProposal).toHaveBeenCalledWith(expect.objectContaining({
      matterId: 'matter-1',
      requestId: 'intake-phone-1',
      intakeId: 'intake-phone-1',
      sourcePath: '/workspace/Sarah/Requests/onboarding/pay-stub.pdf',
    }));
    await expect(documentExtractionProposalList('matter-1')).resolves.toEqual([
      expect.objectContaining({
        sourcePath: '/workspace/Sarah/Requests/onboarding/pay-stub.pdf',
        items: [expect.objectContaining({ kind: 'income_annual' })],
      }),
    ]);
  });
});

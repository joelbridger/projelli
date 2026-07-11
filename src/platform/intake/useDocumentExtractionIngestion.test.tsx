import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Provider } from '@/platform/providers/Provider';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { useIntakeStore, type IntakeRecord } from './intakeStore';
import type { RoutedIntakeSubmission } from './IntakeSyncClient';
import { routeIntakeSubmission } from './useIntakeInboxSync';
import {
  clearInMemoryDocumentExtractionQueuesForTests,
  documentExtractionProposalList,
  documentExtractionProposalSave,
} from './documentExtractionProposalStore';
import {
  useDocumentExtractionIngestion,
  clearDocumentExtractionRetriesForTests,
  retryFailedDocumentExtraction,
  type DocumentExtractionIngestionDeps,
} from './useDocumentExtractionIngestion';

const enc = new TextEncoder();

function intake(): IntakeRecord {
  const document = {
    t: 'doc_upload' as const,
    item_id: 'income-support',
    label: 'Income statement',
    help_text: '',
    required: true,
    subject: 'primary',
  };
  return {
    intakeId: 'intake-1',
    matterId: 'matter-1',
    clientFirstName: 'Sarah',
    firmName: 'North Star',
    status: 'active',
    expiresAt: '2026-08-01T00:00:00.000Z',
    checklistVersion: 1,
    requestSlug: 'income-request',
    requestItems: [document],
    items: [{ itemId: document.item_id, label: document.label, state: 'not_started' }],
    receivedItems: [],
    flags: [],
    knownSessionIds: [],
    knownSubmissionIds: [],
    nudges: [],
  };
}

function submission(): RoutedIntakeSubmission {
  return {
    intakeId: 'intake-1',
    itemId: 'income-support',
    submissionId: 'submission-1',
    submittedAt: '2026-07-11T10:00:00.000Z',
    manifest: {
      submission_id: 'submission-1',
      item_id: 'income-support',
      content_type: 'application/pdf',
      file_names: ['income.pdf'],
      chunk_hashes: ['hash'],
      chunk_count: 1,
    },
    plaintextBytes: [enc.encode('a PDF file')],
  };
}

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

describe('useDocumentExtractionIngestion', () => {
  beforeEach(() => {
    useIntakeStore.getState().resetForTests();
    clearInMemoryDocumentExtractionQueuesForTests();
    clearDocumentExtractionRetriesForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('files a client-link document through routeIntakeSubmission, then persists its extraction proposal', async () => {
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
    render(<IngestionHarness deps={{
      readDocument,
      classifyDocument: () => ({ kind: 'pay_stub', confidence: 'high', sourceRefs: [], evidence: [] }),
      saveProposal,
      resolveDocumentExtractionProvider: () => Promise.resolve({
        provider: model,
        providerId: 'test-provider',
        assuredAvailable: false,
      }),
    }} />);

    await expect(routeIntakeSubmission(submission(), {
      intake: record,
      matterFolderPath: '/workspace/Sarah',
      workspaceService,
    })).resolves.toEqual({ filePath: '/workspace/Sarah/Requests/income-request/income.pdf' });

    await waitFor(() => { expect(saveProposal).toHaveBeenCalledTimes(1); });
    expect(writeFileBinary).toHaveBeenCalledTimes(1);
    expect(readDocument).toHaveBeenCalledWith(expect.objectContaining({
      path: '/workspace/Sarah/Requests/income-request/income.pdf',
      mimeType: 'application/pdf',
    }));
    expect(structuredOutput).toHaveBeenCalledTimes(1);
    expect(saveProposal).toHaveBeenCalledWith(expect.objectContaining({
      matterId: 'matter-1',
      requestId: 'intake-1',
      intakeId: 'intake-1',
      sourcePath: '/workspace/Sarah/Requests/income-request/income.pdf',
      items: [expect.objectContaining({
        kind: 'income_annual',
        value: { t: 'money', v: { amount: 120000, currency: 'USD' } },
      })],
    }));
    await expect(documentExtractionProposalList('matter-1')).resolves.toEqual([
      expect.objectContaining({
        sourcePath: '/workspace/Sarah/Requests/income-request/income.pdf',
        items: [expect.objectContaining({ kind: 'income_annual' })],
      }),
    ]);
  });

  it('keeps the filed document when no provider is available', async () => {
    const writeFileBinary = vi.fn().mockResolvedValue(undefined);
    const workspaceService = { writeFileBinary } as unknown as WorkspaceService;
    const record = intake();
    render(<IngestionHarness deps={{
      readDocument: vi.fn().mockResolvedValue({
        status: 'read' as const,
        pages: [{ page: 1, text: 'Annual income: $120,000', extraction: 'text' as const }],
      }),
      resolveDocumentExtractionProvider: () => Promise.reject(new Error('No provider configured')),
    }} />);

    await expect(routeIntakeSubmission(submission(), {
      intake: record,
      matterFolderPath: '/workspace/Sarah',
      workspaceService,
    })).resolves.toEqual({ filePath: '/workspace/Sarah/Requests/income-request/income.pdf' });
    expect(writeFileBinary).toHaveBeenCalledTimes(1);
  });

  it('warns, adds a retryable extraction flag, and retries the same filed document after extraction fails', async () => {
    const writeFileBinary = vi.fn().mockResolvedValue(undefined);
    const workspaceService = { writeFileBinary } as unknown as WorkspaceService;
    const record = intake();
    useIntakeStore.getState().upsertIntake(record);
    const readDocument = vi.fn()
      .mockRejectedValueOnce(new Error('reader unavailable'))
      .mockResolvedValueOnce({
        status: 'read' as const,
        pages: [{ page: 1, text: 'Annual income: $120,000', extraction: 'text' as const }],
      });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<IngestionHarness deps={{
      readDocument,
      classifyDocument: () => ({ kind: 'pay_stub', confidence: 'high', sourceRefs: [], evidence: [] }),
      extractFacts: vi.fn().mockResolvedValue([]),
      resolveDocumentExtractionProvider: () => Promise.resolve({
        provider: provider(defaultStructuredOutput()),
        providerId: 'test-provider',
        assuredAvailable: false,
      }),
    }} />);

    await expect(routeIntakeSubmission(submission(), {
      intake: record,
      matterFolderPath: '/workspace/Sarah',
      workspaceService,
    })).resolves.toEqual({ filePath: '/workspace/Sarah/Requests/income-request/income.pdf' });

    await waitFor(() => {
      const flags = useIntakeStore.getState().intakesById['intake-1']?.flags ?? [];
      expect(flags).toHaveLength(1);
      expect(flags[0]?.kind).toBe('extraction_failed');
      expect(flags[0]?.itemId).toBe('income-support');
      expect(flags[0]?.documentExtraction?.filePath).toBe('/workspace/Sarah/Requests/income-request/income.pdf');
    });
    expect(warn).toHaveBeenCalledWith(
      '[useDocumentExtractionIngestion] Document extraction failed:',
      expect.any(Error),
    );

    const flag = useIntakeStore.getState().intakesById['intake-1']?.flags[0];
    expect(flag?.id).toBeTruthy();
    await retryFailedDocumentExtraction(flag?.id ?? 'missing');
    expect(readDocument).toHaveBeenCalledTimes(2);
    expect(useIntakeStore.getState().intakesById['intake-1']?.flags).toEqual([]);
  });
});

import { useCallback, useEffect } from 'react';

import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { Provider } from '@/platform/providers/Provider';

import {
  documentExtractionProposalSave,
  documentExtractionStableKey,
  stableDocumentExtractionProposalId,
} from './documentExtractionProposalStore';
import { extractDocumentFacts } from './documentExtractionEngine';
import { classifyIntakeDocument } from './documentClassifier';
import { readIntakeDocument } from './documentReader';
import {
  subscribeToFiledIntakeDocuments,
  type FiledIntakeDocument,
} from './documentFilingEvents';
import { useIntakeStore, type IntakeFlag } from './intakeStore';
import { FACT_KIND_SENSITIVITY } from './types';

export interface DocumentExtractionProvider {
  provider: Provider;
  providerId: string;
  assuredAvailable: boolean;
}

export interface DocumentExtractionIngestionDeps {
  readDocument?: typeof readIntakeDocument;
  classifyDocument?: typeof classifyIntakeDocument;
  extractFacts?: typeof extractDocumentFacts;
  saveProposal?: typeof documentExtractionProposalSave;
  resolveDocumentExtractionProvider?: () => Promise<DocumentExtractionProvider>;
  workspaceService?: WorkspaceService | null;
}

const retries = new Map<string, () => Promise<void>>();
/** Coalesces concurrent retry calls for the same flag into one in-flight run. */
const inFlightRetries = new Map<string, Promise<void>>();

function failureFlagId(document: FiledIntakeDocument): string {
  return `document-extraction:${stableDocumentExtractionProposalId({
    matterId: document.matterId,
    requestId: document.requestId,
    intakeId: document.intakeId,
    sourcePath: document.filePath,
  })}`;
}

function failureFlag(document: FiledIntakeDocument): IntakeFlag {
  return {
    id: failureFlagId(document),
    kind: 'extraction_failed',
    itemId: document.itemId,
    message: 'This document saved fine, but we could not read it automatically.',
    at: new Date().toISOString(),
    documentExtraction: {
      matterId: document.matterId,
      requestId: document.requestId,
      intakeId: document.intakeId,
      itemId: document.itemId,
      subject: document.subject,
      filePath: document.filePath,
      fileName: document.fileName,
      matterFolderPath: document.matterFolderPath,
      ...(document.mimeType ? { mimeType: document.mimeType } : {}),
    },
  };
}

function reportFailure(document: FiledIntakeDocument, error: unknown): void {
  console.warn('[useDocumentExtractionIngestion] Document extraction failed:', error);
  useIntakeStore.getState().addFlag(document.intakeId, failureFlag(document));
}

function documentFromFailureFlag(
  flag: IntakeFlag,
  workspaceService: WorkspaceService,
): FiledIntakeDocument | null {
  const context = flag.documentExtraction;
  if (!context) return null;
  return {
    ...context,
    workspaceService,
  };
}

/**
 * Runs the saved document again when an advisor selects Retry extraction.
 * Concurrent calls for the same flag (e.g. a fast double click) share one
 * in-flight run instead of starting a duplicate extraction.
 */
export async function retryFailedDocumentExtraction(flagId: string): Promise<void> {
  const existing = inFlightRetries.get(flagId);
  if (existing) return existing;
  const retry = retries.get(flagId);
  if (!retry) throw new Error('This document is no longer available to retry.');
  const run = retry().finally(() => {
    inFlightRetries.delete(flagId);
  });
  inFlightRetries.set(flagId, run);
  return run;
}

export function isDocumentExtractionRetryInFlight(flagId: string): boolean {
  return inFlightRetries.has(flagId);
}

export function clearDocumentExtractionRetriesForTests(): void {
  retries.clear();
  inFlightRetries.clear();
}

function displayValue(value: { t: 'money'; v: { amount: number; currency: string } }): string {
  return `${value.v.currency} ${String(value.v.amount)}`;
}

/** Runs the existing reader → classifier → extractor pipeline for one filed document. */
export async function processFiledIntakeDocument(
  document: FiledIntakeDocument,
  deps: DocumentExtractionIngestionDeps = {},
): Promise<void> {
  const readDocument = deps.readDocument ?? readIntakeDocument;
  const classifyDocument = deps.classifyDocument ?? classifyIntakeDocument;
  const extractFacts = deps.extractFacts ?? extractDocumentFacts;
  const saveProposal = deps.saveProposal ?? documentExtractionProposalSave;
  const resolved = deps.resolveDocumentExtractionProvider;
  if (!resolved) return;

  const readResult = await readDocument({
    path: document.filePath,
    matterFolderPath: document.matterFolderPath,
    workspaceService: document.workspaceService,
    ...(document.mimeType ? { mimeType: document.mimeType } : {}),
  });
  const classification = classifyDocument({
    path: document.filePath,
    filename: document.fileName,
    readResult,
  });
  if (readResult.status !== 'read') return;

  const provider = await resolved();
  const facts = await extractFacts({
    readResult,
    classification,
    matterId: document.matterId,
    requestId: document.requestId,
    intakeId: document.intakeId,
    itemId: document.itemId,
    sourcePath: document.filePath,
    provider: provider.provider,
    providerId: provider.providerId,
    assuredAvailable: provider.assuredAvailable,
  });
  if (facts.length === 0) return;

  const ids = {
    matterId: document.matterId,
    requestId: document.requestId,
    intakeId: document.intakeId,
    sourcePath: document.filePath,
  };
  await saveProposal({
    proposalId: stableDocumentExtractionProposalId(ids),
    stableKey: documentExtractionStableKey(ids),
    ...ids,
    itemId: document.itemId,
    items: facts.flatMap((fact) => {
      if (fact.kind !== 'fact' || !fact.fact_kind || !fact.proposed_value || fact.proposed_value.t !== 'money') return [];
      return [{
        id: fact.proposal_id,
        itemId: document.itemId,
        subject: document.subject,
        kind: fact.fact_kind,
        value: fact.proposed_value,
        displayValue: displayValue(fact.proposed_value),
        sensitivity: FACT_KIND_SENSITIVITY[fact.fact_kind],
        source: fact.source,
        confidence: fact.confidence,
        reason: fact.reason,
        checkedByDefault: fact.confidence === 'high',
      }];
    }),
  });
}

/**
 * App-level listener for the shared post-filing notice. Its failure handling is
 * intentionally best-effort: document filing has already succeeded, while a
 * failed extraction is logged and shown as a retryable intake attention flag.
 */
export function useDocumentExtractionIngestion(deps: DocumentExtractionIngestionDeps): void {
  const {
    readDocument,
    classifyDocument,
    extractFacts,
    saveProposal,
    resolveDocumentExtractionProvider,
    workspaceService,
  } = deps;
  const process = useCallback((document: FiledIntakeDocument) => processFiledIntakeDocument(document, {
    ...(readDocument ? { readDocument } : {}),
    ...(classifyDocument ? { classifyDocument } : {}),
    ...(extractFacts ? { extractFacts } : {}),
    ...(saveProposal ? { saveProposal } : {}),
    ...(resolveDocumentExtractionProvider ? { resolveDocumentExtractionProvider } : {}),
  }), [readDocument, classifyDocument, extractFacts, saveProposal, resolveDocumentExtractionProvider]);
  const retry = useCallback((document: FiledIntakeDocument, flagId: string) => async () => {
    try {
      await process(document);
      useIntakeStore.getState().removeFlag(document.intakeId, flagId);
      retries.delete(flagId);
    } catch (error) {
      reportFailure(document, error);
      throw error;
    }
  }, [process]);

  useEffect(() => subscribeToFiledIntakeDocuments((document) => {
    const flagId = failureFlagId(document);
    retries.set(flagId, retry(document, flagId));
    void process(document).catch((error: unknown) => {
      reportFailure(document, error);
    });
  }), [process, retry]);

  useEffect(() => {
    if (!workspaceService) return;
    const registerSavedRetries = () => {
      for (const intake of Object.values(useIntakeStore.getState().intakesById)) {
        for (const flag of intake.flags) {
          if (flag.kind !== 'extraction_failed') continue;
          const document = documentFromFailureFlag(flag, workspaceService);
          if (document) retries.set(flag.id, retry(document, flag.id));
        }
      }
    };
    registerSavedRetries();
    return useIntakeStore.subscribe(registerSavedRetries);
  }, [retry, workspaceService]);
}

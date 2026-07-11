import { useEffect } from 'react';

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
 * intentionally the same best-effort shape as email reply ingestion: document
 * filing has already succeeded and extraction errors are only logged.
 */
export function useDocumentExtractionIngestion(deps: DocumentExtractionIngestionDeps): void {
  const {
    readDocument,
    classifyDocument,
    extractFacts,
    saveProposal,
    resolveDocumentExtractionProvider,
  } = deps;
  useEffect(() => subscribeToFiledIntakeDocuments((document) => {
    void processFiledIntakeDocument(document, {
      ...(readDocument ? { readDocument } : {}),
      ...(classifyDocument ? { classifyDocument } : {}),
      ...(extractFacts ? { extractFacts } : {}),
      ...(saveProposal ? { saveProposal } : {}),
      ...(resolveDocumentExtractionProvider ? { resolveDocumentExtractionProvider } : {}),
    }).catch((error: unknown) => {
      console.warn('[useDocumentExtractionIngestion] Document extraction failed:', error);
    });
  }), [readDocument, classifyDocument, extractFacts, saveProposal, resolveDocumentExtractionProvider]);
}

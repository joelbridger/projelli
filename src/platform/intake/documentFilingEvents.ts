import type { WorkspaceService } from '@/platform/fs/WorkspaceService';

/** Code-owned context attached only when a real document-request file is filed. */
export interface FiledIntakeDocumentContext {
  matterId: string;
  requestId: string;
  intakeId: string;
  itemId: string;
  subject: string;
  mimeType?: string;
}

export interface FiledIntakeDocument extends FiledIntakeDocumentContext {
  filePath: string;
  fileName: string;
  matterFolderPath: string;
  workspaceService: WorkspaceService;
}

type FiledIntakeDocumentListener = (document: FiledIntakeDocument) => void;

const listeners = new Set<FiledIntakeDocumentListener>();

/**
 * Filing is the durable operation. Extraction is deliberately notified after it
 * succeeds and never awaited, so a bad document or unavailable model cannot
 * delay or undo the advisor's filing.
 */
export function emitFiledIntakeDocument(document: FiledIntakeDocument): void {
  for (const listener of listeners) {
    try {
      listener(document);
    } catch (error) {
      console.warn('[documentFilingEvents] Could not notify document extraction:', error);
    }
  }
}

export function subscribeToFiledIntakeDocuments(listener: FiledIntakeDocumentListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

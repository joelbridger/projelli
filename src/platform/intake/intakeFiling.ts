import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { assertRequestSlug } from './requestIdentity';
import { emitFiledIntakeDocument, type FiledIntakeDocumentContext } from './documentFilingEvents';

const ONBOARDING_DIR = 'Requests/onboarding';

function cleanSegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]+/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();
  return cleaned || fallback;
}

function trimSlashes(value: string): string {
  return value.replace(/[\\/]+$/u, '');
}

export interface FileIntakeDocumentOptions {
  workspaceService: WorkspaceService;
  matterFolderPath: string;
  requestSlug?: string;
  /** A receiver-owned destination for a verified completed PDF form. */
  folder?: 'request' | 'pdf_form';
  fileName: string;
  bytes: Uint8Array;
  /** Present only for a document request that is eligible for extraction. */
  documentExtraction?: FiledIntakeDocumentContext;
}

export function intakeOnboardingFolder(matterFolderPath: string): string {
  return `${trimSlashes(matterFolderPath)}/${ONBOARDING_DIR}`;
}

export function intakeRequestFolder(matterFolderPath: string, requestSlug: string): string {
  return `${trimSlashes(matterFolderPath)}/Requests/${assertRequestSlug(requestSlug)}`;
}

export function intakePdfFormFolder(matterFolderPath: string, requestSlug: string): string {
  return `${intakeRequestFolder(matterFolderPath, requestSlug)}/forms`;
}

export async function fileIntakeDocument(options: FileIntakeDocumentOptions): Promise<string> {
  let folder: string;
  if (options.folder === 'pdf_form') {
    if (options.requestSlug === undefined) throw new Error('A completed PDF form needs a request folder.');
    folder = intakePdfFormFolder(options.matterFolderPath, options.requestSlug);
  } else {
    folder = options.requestSlug === undefined
      ? intakeOnboardingFolder(options.matterFolderPath)
      : intakeRequestFolder(options.matterFolderPath, options.requestSlug);
  }
  const fileName = cleanSegment(options.fileName, 'intake-upload.bin');
  const path = `${folder}/${fileName}`;
  await options.workspaceService.writeFileBinary(path, options.bytes.buffer.slice(
    options.bytes.byteOffset,
    options.bytes.byteOffset + options.bytes.byteLength,
  ));
  if (options.documentExtraction) {
    emitFiledIntakeDocument({
      ...options.documentExtraction,
      filePath: path,
      fileName,
      matterFolderPath: options.matterFolderPath,
      workspaceService: options.workspaceService,
    });
  }
  return path;
}

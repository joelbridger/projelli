import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { assertRequestSlug } from './requestIdentity';

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
  fileName: string;
  bytes: Uint8Array;
}

export function intakeOnboardingFolder(matterFolderPath: string): string {
  return `${trimSlashes(matterFolderPath)}/${ONBOARDING_DIR}`;
}

export function intakeRequestFolder(matterFolderPath: string, requestSlug: string): string {
  return `${trimSlashes(matterFolderPath)}/Requests/${assertRequestSlug(requestSlug)}`;
}

export async function fileIntakeDocument(options: FileIntakeDocumentOptions): Promise<string> {
  const folder = options.requestSlug === undefined
    ? intakeOnboardingFolder(options.matterFolderPath)
    : intakeRequestFolder(options.matterFolderPath, options.requestSlug);
  const fileName = cleanSegment(options.fileName, 'intake-upload.bin');
  const path = `${folder}/${fileName}`;
  await options.workspaceService.writeFileBinary(path, options.bytes.buffer.slice(
    options.bytes.byteOffset,
    options.bytes.byteOffset + options.bytes.byteLength,
  ));
  return path;
}

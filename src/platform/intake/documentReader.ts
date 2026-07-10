import {
  extractPdfText,
  renderPdfPageToPng,
  type PdfExtractionResult,
} from '@/lib/pdf-extract';
import {
  destroyOcrClient,
  isOcrEngineAvailable,
  ocrPageImage,
  type OcrPageResult,
} from '@/platform/rag/ocr/ocrEngine';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { DocumentReadResult } from './documentExtractionTypes';

const PDF_MIME_TYPE = 'application/pdf';
/** Keep a malicious scan from tying up the local OCR engine indefinitely. */
export const MAX_OCR_PAGES = 40;
export const MAX_OCR_INPUT_BYTES = 50 * 1024 * 1024;

export interface DocumentReaderDependencies {
  extractPdfText: (bytes: Uint8Array) => Promise<PdfExtractionResult>;
  renderPdfPageToPng: (bytes: Uint8Array, pageIndex: number) => Promise<Uint8Array>;
  isOcrEngineAvailable: () => boolean;
  ocrPageImage: (bytes: Uint8Array) => Promise<OcrPageResult>;
  destroyOcrClient: () => Promise<void>;
}

const defaultDependencies: DocumentReaderDependencies = {
  extractPdfText,
  renderPdfPageToPng,
  isOcrEngineAvailable,
  ocrPageImage,
  destroyOcrClient,
};

export interface ReadIntakeDocumentOptions {
  path: string;
  matterFolderPath: string;
  workspaceService: Pick<WorkspaceService, 'readFileBinary' | 'isSymlink' | 'resolveSymlink'>;
  /** Prefer the sealed upload's content type when it is still available. */
  mimeType?: string;
  /** Test seam. Production always uses local PDF.js and the local OCR engine. */
  dependencies?: Partial<DocumentReaderDependencies>;
}

function normalizedPath(path: string): string {
  return path.replace(/\\/gu, '/').replace(/\/+$/u, '');
}

function hasTraversalSegment(path: string): boolean {
  return path.split(/[\\/]/u).some((segment) => segment === '..');
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-z]:\//iu.test(path) || path.startsWith('//');
}

/**
 * Enforces the lexical client-folder boundary before any filesystem work.
 * A separate resolved-path check below protects this boundary from links that
 * remain inside the workspace but point at another client's files.
 */
export function assertPathWithinMatterFolder(path: string, matterFolderPath: string): void {
  if (!path || !matterFolderPath || hasTraversalSegment(path) || hasTraversalSegment(matterFolderPath)) {
    throw new Error('Document path must stay inside the client folder.');
  }
  const normalizedPathValue = normalizedPath(path);
  const normalizedFolder = normalizedPath(matterFolderPath);
  if (!normalizedPathValue || !normalizedFolder || isAbsolutePath(normalizedPathValue) !== isAbsolutePath(normalizedFolder)) {
    throw new Error('Document path must stay inside the client folder.');
  }
  const pathForComparison = /^[a-z]:\//iu.test(normalizedFolder)
    ? normalizedPathValue.toLowerCase()
    : normalizedPathValue;
  const folderForComparison = /^[a-z]:\//iu.test(normalizedFolder)
    ? normalizedFolder.toLowerCase()
    : normalizedFolder;
  if (pathForComparison !== folderForComparison && !pathForComparison.startsWith(`${folderForComparison}/`)) {
    throw new Error('Document path must stay inside the client folder.');
  }
}

function splitPathForLinkWalk(path: string): { root: string; segments: string[] } {
  const normalized = normalizedPath(path);
  const windowsRoot = /^[a-z]:\//iu.exec(normalized)?.[0];
  if (windowsRoot) {
    return { root: windowsRoot, segments: normalized.slice(windowsRoot.length).split('/').filter(Boolean) };
  }
  if (normalized.startsWith('//')) {
    return { root: '//', segments: normalized.slice(2).split('/').filter(Boolean) };
  }
  if (normalized.startsWith('/')) {
    return { root: '/', segments: normalized.slice(1).split('/').filter(Boolean) };
  }
  return { root: '', segments: normalized.split('/').filter(Boolean) };
}

function appendPath(base: string, segment: string): string {
  if (!base) return segment;
  if (base.endsWith('/')) return `${base}${segment}`;
  return `${base}/${segment}`;
}

function parentPath(path: string): string {
  const normalized = normalizedPath(path);
  const index = normalized.lastIndexOf('/');
  if (index < 0) return '';
  if (index === 0) return '/';
  return normalized.slice(0, index);
}

function resolveRelativeLinkTarget(linkPath: string, target: string): string {
  if (isAbsolutePath(target)) return normalizedPath(target);
  return appendPath(parentPath(linkPath), target);
}

/**
 * Walk every existing path component without following it implicitly. When a
 * component is a link, resolve its real target and continue from that target.
 * This makes the client folder, rather than just the workspace root, the final
 * containment boundary. A backend that cannot resolve a link safely fails
 * closed, so no bytes are read on an uncertain boundary.
 */
async function resolvePathForMatterBoundary(
  path: string,
  workspaceService: Pick<WorkspaceService, 'isSymlink' | 'resolveSymlink'>,
): Promise<string> {
  const { root, segments } = splitPathForLinkWalk(path);
  let current = root;
  for (const segment of segments) {
    current = appendPath(current, segment);
    if (await workspaceService.isSymlink(current)) {
      const target = await workspaceService.resolveSymlink(current);
      const resolved = resolveRelativeLinkTarget(current, target);
      if (!resolved || normalizedPath(resolved) === normalizedPath(current)) {
        throw new Error('Document path must stay inside the client folder.');
      }
      current = resolved;
    }
  }
  return current;
}

async function assertResolvedPathWithinMatterFolder(
  path: string,
  matterFolderPath: string,
  workspaceService: Pick<WorkspaceService, 'isSymlink' | 'resolveSymlink'>,
): Promise<void> {
  const resolvedMatterFolder = await resolvePathForMatterBoundary(matterFolderPath, workspaceService);
  // A client-folder alias is not a stable isolation boundary. Refuse it even
  // if it happens to resolve inside the workspace.
  assertPathWithinMatterFolder(resolvedMatterFolder, matterFolderPath);
  const resolvedPath = await resolvePathForMatterBoundary(path, workspaceService);
  assertPathWithinMatterFolder(resolvedPath, resolvedMatterFolder);
}

function inferredMimeType(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.pdf')) return PDF_MIME_TYPE;
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return null;
}

function unreadable(reason: string): DocumentReadResult {
  return { status: 'unreadable', reason };
}

async function readScannedPdf(
  bytes: Uint8Array,
  pageCount: number,
  dependencies: DocumentReaderDependencies,
): Promise<DocumentReadResult> {
  if (
    !Number.isSafeInteger(pageCount) ||
    pageCount < 1 ||
    pageCount > MAX_OCR_PAGES ||
    bytes.byteLength > MAX_OCR_INPUT_BYTES
  ) {
    return unreadable('needs_advisor_view');
  }
  const pages: Extract<DocumentReadResult, { status: 'read' }>['pages'] = [];
  try {
    // Rasterize and OCR one page at a time. renderPdfPageToPng releases its
    // canvas before resolving, so no whole document bitmap is retained.
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const image = await dependencies.renderPdfPageToPng(bytes, pageIndex);
      const result = await dependencies.ocrPageImage(image);
      pages.push({
        page: pageIndex + 1,
        text: result.text,
        extraction: 'ocr',
        confidence: result.confidence,
      });
    }
    return { status: 'read', pages };
  } catch {
    return unreadable('ocr_failed');
  } finally {
    await dependencies.destroyOcrClient().catch(() => undefined);
  }
}

export async function readIntakeDocument(options: ReadIntakeDocumentOptions): Promise<DocumentReadResult> {
  assertPathWithinMatterFolder(options.path, options.matterFolderPath);
  await assertResolvedPathWithinMatterFolder(options.path, options.matterFolderPath, options.workspaceService);
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const mimeType = options.mimeType?.toLowerCase() ?? inferredMimeType(options.path);

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await options.workspaceService.readFileBinary(options.path));
  } catch {
    return unreadable('read_error');
  }

  if (mimeType === PDF_MIME_TYPE) {
    let result: PdfExtractionResult;
    try {
      // PDF.js transfers its input into a worker. Keep our bytes for the
      // sequential page rendering needed by local OCR below.
      result = await dependencies.extractPdfText(bytes.slice());
    } catch {
      return unreadable('read_error');
    }
    if (result.encrypted) return unreadable('encrypted');
    if (result.scanned && dependencies.isOcrEngineAvailable()) {
      return readScannedPdf(bytes, result.pageCount, dependencies);
    }
    return {
      status: 'read',
      pages: result.pages.map((text, index) => ({ page: index + 1, text, extraction: 'text' })),
    };
  }

  if (mimeType?.startsWith('image/')) {
    if (!dependencies.isOcrEngineAvailable()) return unreadable('no_ocr');
    try {
      const result = await dependencies.ocrPageImage(bytes);
      return {
        status: 'read',
        pages: [{ page: 1, text: result.text, extraction: 'ocr', confidence: result.confidence }],
      };
    } catch {
      return unreadable('ocr_failed');
    } finally {
      await dependencies.destroyOcrClient().catch(() => undefined);
    }
  }

  return unreadable('unsupported_type');
}

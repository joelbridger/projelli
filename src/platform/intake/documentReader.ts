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
  workspaceService: Pick<WorkspaceService, 'readFileBinary'>;
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
 * Enforces the tighter client-folder boundary before the workspace service is
 * called. WorkspaceService then performs its own root and symlink checks,
 * including rejecting a symlink inside this folder that points somewhere else.
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

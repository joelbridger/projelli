// Export format utilities
//
// Pure, dependency-free logic that maps an open file's extension to the set of
// export formats that make sense for it. Kept separate from the UI so it can
// be unit-tested without a DOM or React context.

/** Every format the Export menu can offer. */
export type ExportFormat = 'markdown' | 'docx' | 'pdf' | 'pptx';

/** A single entry in the export menu. */
export interface ExportOption {
  format: ExportFormat;
  label: string;
  /** File extension written to disk, without the leading dot. */
  extension: string;
  /** MIME type for the File System Access API filter. */
  mimeType: string;
}

/** All possible export options, in menu display order. */
export const ALL_EXPORT_OPTIONS: Record<ExportFormat, ExportOption> = {
  markdown: {
    format: 'markdown',
    label: 'Markdown (.md)',
    extension: 'md',
    mimeType: 'text/markdown',
  },
  docx: {
    format: 'docx',
    label: 'Word (.docx)',
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  pdf: {
    format: 'pdf',
    label: 'PDF (.pdf)',
    extension: 'pdf',
    mimeType: 'application/pdf',
  },
  pptx: {
    format: 'pptx',
    label: 'PowerPoint (.pptx)',
    extension: 'pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
};

/** Extensions that are editable markdown in Lantern. */
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'txt']);

/**
 * Return the ordered list of export formats available for a given file.
 *
 * Rules:
 * - Markdown / plain-text files: all four formats (md, docx, pdf, pptx).
 * - Any other file type: only the raw "as-is" save, represented here as an
 *   empty array so the caller can fall back to the existing download behavior.
 *
 * @param fileName  The name of the currently open file (e.g. "report.md").
 */
export function availableExportFormats(fileName: string): ExportOption[] {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return [
      ALL_EXPORT_OPTIONS.markdown,
      ALL_EXPORT_OPTIONS.docx,
      ALL_EXPORT_OPTIONS.pdf,
      ALL_EXPORT_OPTIONS.pptx,
    ];
  }

  // Non-markdown files: no conversion options. The toolbar falls back to
  // the original single-button download behavior when this returns empty.
  return [];
}

/**
 * Replace the extension on a file name with a new one.
 *
 * replaceExtension('report.md', 'docx') → 'report.docx'
 * replaceExtension('notes',     'pdf')  → 'notes.pdf'
 */
export function replaceExtension(fileName: string, newExtension: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  const base = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
  return `${base}.${newExtension}`;
}

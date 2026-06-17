// Pure leaf helpers extracted from MainPanel.tsx (behavior-preserving 3.0
// reorg). File-type predicates + the cross-platform download-with-dialog
// utility. No React / component dependencies.

import { saveFile } from '@/platform/utils/saveFile';

/**
 * Check if a file is an audio file
 */
export function isAudioFile(extension: string | undefined): boolean {
  if (!extension) return false;
  const ext = extension.toLowerCase();
  return ext === 'webm' || ext === 'wav' || ext === 'mp3' || ext === 'ogg' || ext === 'm4a';
}

/**
 * Get file extension from a path
 */
export function getFileExtension(path: string): string | undefined {
  const parts = path.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : undefined;
}

/**
 * Check if a file type should have version history
 */
export function shouldVersionFile(extension: string | undefined): boolean {
  if (!extension) return false;
  const ext = extension.toLowerCase();
  // Version text-based editable files + the canonical `.docx` document format
  // (WS-A / A5 — binary-safe, on-disk snapshots for `.docx`).
  return ext === 'md' || ext === 'txt' || ext === 'json' || ext === 'source' || ext === 'aichat' || ext === 'docx';
}

/** True when version history for this file lives on disk (binary-safe). */
export function isDiskVersioned(path: string): boolean {
  return path.toLowerCase().endsWith('.docx');
}

/**
 * Download a file with save dialog (cross-platform: browser & Tauri)
 */
export async function downloadFileWithDialog(content: string | Blob, filename: string, mimeType: string) {
  try {
    // Determine file types based on extension
    const ext = filename.split('.').pop()?.toLowerCase();
    const types: any[] = [];

    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      types.push({
        description: 'Spreadsheet Files',
        accept: {
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
          'application/vnd.ms-excel': ['.xls'],
          'text/csv': ['.csv'],
        },
      });
    } else if (ext === 'pptx' || ext === 'ppt') {
      types.push({
        description: 'Presentation Files',
        accept: {
          'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
          'application/vnd.ms-powerpoint': ['.ppt'],
        },
      });
    } else if (ext === 'docx' || ext === 'doc') {
      types.push({
        description: 'Word Documents',
        accept: {
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
          'application/msword': ['.doc'],
        },
      });
    } else {
      types.push({
        description: 'All Files',
        accept: { [mimeType]: [`.${ext}`] },
      });
    }

    // Convert Blob to ArrayBuffer if needed
    let saveContent: string | ArrayBuffer;
    if (content instanceof Blob) {
      saveContent = await content.arrayBuffer();
    } else {
      saveContent = content;
    }

    // Use cross-platform saveFile utility
    await saveFile(saveContent, {
      suggestedName: filename,
      types,
    });
  } catch (error) {
    // User cancelled or error occurred
    if (error instanceof Error && error.name !== 'AbortError') {
      console.error('Failed to download file:', error);
    }
  }
}

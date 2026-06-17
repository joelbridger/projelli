// DOCX version diff (WS-A / A5)
//
// A byte diff of two `.docx` packages is meaningless to a human (it's a zip of
// XML). For the version-history UI we instead extract PLAIN TEXT from each
// version via the in-house OOXML engine and feed that to the existing line-based
// `DiffViewer`. This reuses the engine's faithful parse (`docx_open` returns the
// JSON DOM) and the `documentPlainText` flattener already used by the editor.
//
// Structural / track-change-level diffing (showing which paragraphs gained
// tracked insertions, etc.) is a deliberate FOLLOW-UP — text diff is the honest,
// shippable first step that already answers "what words changed".

import { documentPlainText } from '@/platform/utils/docx-dom';
import { docxOpen, isDocxEngineAvailable } from '@/platform/utils/docx-commands';
import type { DocumentJson } from '@/platform/types/docx';

/**
 * Extract plain text from a `.docx` at `path` using the engine. The snapshot
 * files written by `BinaryVersionService` are real `.docx` packages on disk, so
 * the engine can open them directly.
 *
 * Throws in browser/test mode (no engine) — callers should guard with
 * `isDocxEngineAvailable()` and fall back to a notice.
 */
export async function extractDocxTextFromPath(path: string): Promise<string> {
  const doc: DocumentJson = await docxOpen(path);
  return documentPlainText(doc);
}

/** True when a docx text diff can be produced (desktop engine present). */
export function canDiffDocx(): boolean {
  return isDocxEngineAvailable();
}

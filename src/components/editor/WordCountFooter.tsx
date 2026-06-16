/**
 * Plain-text word count footer (UX-30).
 *
 * Shared between MarkdownEditor and PlainTextEditor so the two CodeMirror-based
 * editors get the same footer as the DocxEditor.
 *
 * Styling mirrors the DocxEditor WordCountFooter exactly:
 *   right-aligned · 11px · muted-foreground · tabular-nums · top border
 *
 * Test hook: `data-testid="editor-word-count"` — same id all editors use.
 */

import { useMemo } from 'react';

export interface WordCountFooterProps {
  /** Current document text. The editor feeds this in on every change. */
  text: string;
}

/**
 * Count "words" in the way writers expect: split on whitespace, drop empties.
 * We deliberately keep this naive — sophisticated word-boundary detection
 * would bloat the dependency graph and agree with the TipTap counts only by
 * accident anyway. Users care about the trend, not the third decimal place.
 */
export function countWords(text: string): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function countCharacters(text: string): number {
  return text.length;
}

export function WordCountFooter({ text }: WordCountFooterProps) {
  const { words, characters } = useMemo(
    () => ({
      words: countWords(text),
      characters: countCharacters(text),
    }),
    [text]
  );

  return (
    <div
      data-testid="editor-word-count"
      className="flex items-center justify-end border-t bg-background px-3 py-1 text-[11px] text-muted-foreground"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {words} words · {characters.toLocaleString()} characters
    </div>
  );
}

export default WordCountFooter;

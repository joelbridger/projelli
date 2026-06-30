/**
 * answerBlockMarkers — the literal block-marker vocabulary the Ask-smart agent
 * uses, kept in a DEPENDENCY-FREE module so both the (heavy) block binder
 * (`answerBlocks.ts`) and the (deliberately pure) prompt builder
 * (`askPrompt.ts`, imported by the eval harness) can share ONE source of truth
 * without dragging provider/keychain imports into the prompt path.
 *
 * Pure: no React, no app imports, no side effects.
 */

import type { AnswerBlockKind } from './askHelpers';

/**
 * The marker tokens the smart prompt instructs the model to emit before each
 * block. Double-bracketed so a single-bracket citation (`[file.docx
 * paragraph 3]`) can never collide with a block marker.
 */
export const BLOCK_MARKERS = {
  files: '[[BLOCK:FILES]]',
  general: '[[BLOCK:GENERAL]]',
  draft: '[[BLOCK:DRAFT]]',
  nothingFound: '[[BLOCK:NOTHING_FOUND]]',
} as const;

/** Matches any block marker, anywhere, case-insensitively. */
export const BLOCK_MARKER_RE = /\[\[BLOCK:(FILES|GENERAL|DRAFT|NOTHING_FOUND)\]\]/gi;

export function kindFromMarker(token: string): AnswerBlockKind {
  switch (token.toUpperCase()) {
    case 'FILES':
      return 'files';
    case 'DRAFT':
      return 'draft';
    case 'NOTHING_FOUND':
      return 'nothing-found';
    case 'GENERAL':
    default:
      return 'general';
  }
}

/**
 * A PARTIAL block marker at the very END of a streamed string — the prefix of a
 * `[[BLOCK:…]]` token that has arrived chunk-by-chunk but isn't closed yet
 * (`[[`, `[[BLOCK:`, `[[BLOCK:GENERAL`, `[[BLOCK:GENERAL]`). Stripping it stops
 * the raw protocol token from flashing mid-stream before the closing `]]`
 * lands. Anchored to end-of-string and to the double-bracket + uppercase marker
 * vocabulary so it can never eat a real single-bracket citation `[file p 3]`.
 */
const PARTIAL_BLOCK_MARKER_TAIL_RE = /\[\[[A-Z:_\]]*$/;

/**
 * Remove every block marker from a string (used for the streaming display, where
 * a partial answer may already contain markers we don't want shown raw, and as a
 * belt-and-braces scrub elsewhere). Strips complete markers AND a trailing
 * partial marker (so a half-arrived `[[BLOCK:` never flashes), then collapses
 * the blank line a stripped standalone marker leaves behind.
 */
export function stripBlockMarkers(text: string): string {
  return text
    .replace(BLOCK_MARKER_RE, '')
    .replace(PARTIAL_BLOCK_MARKER_TAIL_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

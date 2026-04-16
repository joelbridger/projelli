/**
 * Q14 (Wave 1.6) — Wiki-link autocomplete for the Markdown editor.
 *
 * Builds a CodeMirror 6 completion source that fires when the user is
 * inside an open `[[...]]` expression. It offers every file in the current
 * workspace, filtered by a simple substring / prefix / initials match on
 * the query typed after `[[`.
 *
 * On selection the completion inserts the file's normalized wiki-link
 * target (filename without extension) and closes with `]]`. This matches
 * what `resolveWikiLinkTarget` expects (it re-adds `.md`).
 *
 * The extension is intentionally decoupled from the store: callers pass a
 * `getFiles()` accessor so the same logic works in the live editor, in
 * tests, and in any future embed that has a different source of truth for
 * the file list.
 */

import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import { autocompletion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import type { FileNode } from '@/types/workspace';

export interface WikiLinkFileInfo {
  /** Absolute path inside the workspace (used only for the detail label). */
  path: string;
  /** Base filename including extension. */
  name: string;
}

/** Regex matching an unterminated `[[...` at the cursor. */
const OPEN_WIKI_LINK_REGEX = /\[\[([^\]\r\n]*)$/;

/**
 * Strip a trailing extension from a filename, mirroring
 * `resolveWikiLinkTarget` which re-appends `.md` when the target is
 * extension-less.
 */
export function normalizeWikiLinkTarget(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return name;
  return name.slice(0, dot);
}

/**
 * Flatten a `FileNode` tree into a list of file entries for autocomplete.
 * Folders are skipped; hidden files (starting with `.`) are kept so the
 * user can still link them, but they'll rank lower in practice due to
 * the prefix bonus.
 */
export function flattenFilesForWikiLinks(tree: FileNode[]): WikiLinkFileInfo[] {
  const out: WikiLinkFileInfo[] = [];
  const walk = (nodes: FileNode[]) => {
    for (const n of nodes) {
      if (n.type === 'file') {
        out.push({ path: n.path, name: n.name });
      } else if (n.children) {
        walk(n.children);
      }
    }
  };
  walk(tree);
  return out;
}

/**
 * Case-insensitive match + score. Returns `null` when the query doesn't
 * match, otherwise a non-negative number where higher is better.
 *
 * Scoring bumps: exact prefix match > substring match > initials match.
 */
export function scoreWikiLinkCandidate(
  query: string,
  candidateName: string
): number | null {
  if (query.length === 0) return 1;
  const q = query.toLowerCase();
  const base = normalizeWikiLinkTarget(candidateName).toLowerCase();

  if (base.startsWith(q)) return 100 + (q.length * 2);
  if (base.includes(q)) return 50 + q.length;
  const initials = base
    .split(/[\s\-_.]+/)
    .filter((w) => w.length > 0)
    .map((w) => w[0])
    .join('');
  if (initials.includes(q)) return 25;
  return null;
}

/**
 * Build a CodeMirror completion source that offers files in the workspace
 * when the user types inside `[[`.
 */
export function createWikiLinkCompletionSource(
  getFiles: () => WikiLinkFileInfo[]
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const linePrefix = line.text.slice(0, context.pos - line.from);
    const m = linePrefix.match(OPEN_WIKI_LINK_REGEX);
    if (!m) return null;

    const query = m[1] ?? '';
    const from = context.pos - query.length;

    const files = getFiles();
    const scored: { score: number; info: WikiLinkFileInfo }[] = [];
    for (const info of files) {
      const score = scoreWikiLinkCandidate(query, info.name);
      if (score !== null) {
        scored.push({ score, info });
      }
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.info.name.localeCompare(b.info.name);
    });

    const capped = scored.slice(0, 25);

    const options: Completion[] = capped.map(({ info }) => {
      const label = normalizeWikiLinkTarget(info.name);
      return {
        label,
        detail: info.path,
        type: 'file',
        apply: (view: EditorView, _completion: Completion, pickedFrom: number, pickedTo: number) => {
          const after = view.state.doc
            .sliceString(pickedTo, Math.min(pickedTo + 2, view.state.doc.length));
          const closer = after === ']]' ? '' : ']]';
          view.dispatch({
            changes: { from: pickedFrom, to: pickedTo, insert: `${label}${closer}` },
            selection: { anchor: pickedFrom + label.length + closer.length },
          });
        },
      };
    });

    return {
      from,
      to: context.pos,
      options,
      validFor: /^[^\]\r\n]*$/,
    };
  };
}

/**
 * Convenience: returns a ready-to-use `autocompletion(...)` extension
 * wired to the wiki-link completion source. Additional override sources
 * can be passed in when composing multiple autocomplete contributors.
 */
export function wikiLinkAutocompleteExtension(
  getFiles: () => WikiLinkFileInfo[],
  extraSources: CompletionSource[] = []
) {
  return autocompletion({
    override: [createWikiLinkCompletionSource(getFiles), ...extraSources],
  });
}

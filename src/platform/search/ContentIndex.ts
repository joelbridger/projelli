/**
 * Full-text content index (UX-26).
 *
 * Wraps `minisearch` behind a small workspace-aware API. The index is built
 * once on workspace open by walking the file tree and running each text-
 * extractable file through `extractForAI` (the same path the AI ambient
 * context uses — this keeps results consistent with what the AI can "see").
 *
 * Rebuilds:
 *   - `buildIndex(tree)` replaces the whole index. Called on workspace
 *     switch.
 *   - `upsertDocument(path, text)` re-indexes a single file. Called on
 *     save, so typing in the Markdown editor keeps results current without
 *     a full rescan.
 *   - `removeDocument(path)` drops a file from the index on delete.
 *
 * Search returns a scored list of results with a ~160-char snippet around
 * the strongest match. Query is trimmed, fuzzy, and prefix-enabled; terms
 * shorter than 2 chars are treated as prefix-only to avoid zero-result
 * single-character queries.
 */

import MiniSearch, { type SearchResult as MiniSearchResult } from 'minisearch';
import type { FileNode } from '@/platform/types/workspace';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { extractForAI } from '@/platform/utils/ai-file-context';
import { isBinaryFile } from '@/platform/utils/file-utils';

/** Max content length to index per file. Keeps the worst-case search cost
 *  sane when a user opens a 50 MB transcript. ~200k chars ≈ 50k tokens. */
const MAX_INDEX_CHARS = 200_000;

/** Max number of results we surface to the UI. Anything beyond this is
 *  rarely useful and costs render time in the results list. */
const DEFAULT_RESULT_LIMIT = 30;

/** Snippet radius around a hit in characters, in each direction. */
const SNIPPET_RADIUS = 80;

export interface ContentIndexDocument {
  /** Stable id — we use the path; MiniSearch requires unique ids. */
  id: string;
  path: string;
  name: string;
  /** Plain-text content used for matching. */
  content: string;
}

export interface ContentSearchResult {
  path: string;
  name: string;
  snippet: string;
  score: number;
  /** The term that produced the snippet (for highlight). */
  matchedTerm: string;
}

/** Extensions we're willing to index. Mirrors `extractForAI`'s branches,
 *  minus the formats that need a data-URL (xlsx, docx, pptx) — those still
 *  work via `indexOpenFile` once the user has the binary content loaded. */
const INDEXABLE_PLAIN_EXTS = new Set([
  'md', 'markdown', 'txt', 'rt', 'json', 'csv', 'source',
]);

function isPlainTextIndexable(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext) return false;
  return INDEXABLE_PLAIN_EXTS.has(ext);
}

/** Binary formats `extractForAI` can actually pull text from (the ONLY binary
 *  files worth reading + base64-encoding for the index). Every other binary
 *  type — images, audio, video, archives, .iso/.dmg, fonts, .sqlite/.parquet,
 *  executables — has no extractable text, so we skip it BEFORE the expensive
 *  full-file read + base64 (which would otherwise spike memory on a big file
 *  only to have extractForAI return null). Mirrors extractForAI's binary
 *  branches: docx, xlsx, xls, pptx. */
const BINARY_INDEX_EXTRACTABLE_EXTS = new Set(['docx', 'xlsx', 'xls', 'pptx']);

function walkTree(tree: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const node of tree) {
    if (node.type === 'file') {
      out.push(node);
    } else if (node.children) {
      walkTree(node.children, out);
    }
  }
  return out;
}

/**
 * Build a new MiniSearch index pre-configured for our schema.
 *
 * Factored out so callers that already have their own content source (e.g.
 * tests, or a future server-side worker) can skip the workspace scan and
 * just call `addAll` themselves.
 */
export function createIndex(): MiniSearch<ContentIndexDocument> {
  return new MiniSearch<ContentIndexDocument>({
    fields: ['name', 'content'],
    storeFields: ['path', 'name', 'content'],
    searchOptions: {
      boost: { name: 2 },
      prefix: true,
      fuzzy: 0.2,
      combineWith: 'AND',
    },
  });
}

/**
 * Load + extract text for a set of files in parallel, returning one
 * ContentIndexDocument per file that actually produced readable text.
 * Failures (binary formats that can't be extracted in-browser, read errors,
 * empty content) are skipped silently.
 */
export async function collectDocuments(
  service: WorkspaceService,
  nodes: FileNode[]
): Promise<ContentIndexDocument[]> {
  const results = await Promise.all(
    nodes.map(async (node) => {
      if (node.type !== 'file') return null;
      try {
        const ext = node.extension?.toLowerCase()
          ?? node.name.split('.').pop()?.toLowerCase()
          ?? '';
        let content = '';

        if (isPlainTextIndexable(node.name)) {
          const raw = await service.readFile(node.path);
          content = raw.slice(0, MAX_INDEX_CHARS);
        } else if (!isBinaryFile(node.name)) {
          // Unknown non-binary extension — try readFile as text.
          try {
            const raw = await service.readFile(node.path);
            content = raw.slice(0, MAX_INDEX_CHARS);
          } catch {
            return null;
          }
        } else if (!BINARY_INDEX_EXTRACTABLE_EXTS.has(ext)) {
          // Binary with no extractable text (image/audio/video/archive/iso/dmg/
          // font/sqlite/parquet/exe/…). Skip BEFORE the full-file read + base64
          // so a large binary can't spike memory only for extractForAI to return
          // null. (Pre-broadening this path was already a no-op for these; now
          // we just don't do the wasted work first.)
          return null;
        } else {
          // Binary we CAN extract text from (docx/xlsx/xls/pptx): use
          // extractForAI via a data URL. We need the binary bytes first.
          const buf = await service.readFileBinary(node.path);
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.length; i += 1) {
            binary += String.fromCharCode(bytes[i]!);
          }
          const b64 = typeof btoa === 'function'
            ? btoa(binary)
            : Buffer.from(binary, 'binary').toString('base64');
          const mime = {
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            rtf: 'application/rtf',
          }[ext] ?? 'application/octet-stream';
          const dataUrl = `data:${mime};base64,${b64}`;
          const extracted = await extractForAI({
            path: node.path,
            name: node.name,
            extension: ext,
            content: dataUrl,
          });
          if (!extracted) return null;
          content = extracted.extractedText.slice(0, MAX_INDEX_CHARS);
        }

        if (!content.trim()) return null;

        return {
          id: node.path,
          path: node.path,
          name: node.name,
          content,
        };
      } catch {
        return null;
      }
    })
  );
  return results.filter((r): r is ContentIndexDocument => r !== null);
}

/**
 * Build the whole index from a workspace tree. Returns the populated index.
 * Callers hold onto it and feed it to `searchIndex` / `upsertDocument`.
 */
export async function buildWorkspaceIndex(
  service: WorkspaceService,
  tree: FileNode[]
): Promise<MiniSearch<ContentIndexDocument>> {
  const index = createIndex();
  const files = walkTree(tree);
  const docs = await collectDocuments(service, files);
  if (docs.length > 0) {
    index.addAll(docs);
  }
  return index;
}

/**
 * Build a snippet around the first-matching term in the document. Falls
 * back to the leading 160 chars if no term is found (shouldn't happen in
 * practice because MiniSearch wouldn't have returned the result).
 */
function buildSnippet(content: string, terms: string[]): { snippet: string; matchedTerm: string } {
  const lower = content.toLowerCase();
  let bestIndex = -1;
  let bestTerm = '';
  for (const term of terms) {
    const termLower = term.toLowerCase();
    const idx = lower.indexOf(termLower);
    if (idx >= 0 && (bestIndex === -1 || idx < bestIndex)) {
      bestIndex = idx;
      bestTerm = term;
    }
  }
  if (bestIndex === -1) {
    return { snippet: content.slice(0, SNIPPET_RADIUS * 2).trim(), matchedTerm: '' };
  }
  const start = Math.max(0, bestIndex - SNIPPET_RADIUS);
  const end = Math.min(content.length, bestIndex + SNIPPET_RADIUS);
  let snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < content.length) snippet = snippet + '…';
  return { snippet, matchedTerm: bestTerm };
}

export interface SearchIndexOptions {
  limit?: number;
}

export function searchIndex(
  index: MiniSearch<ContentIndexDocument>,
  query: string,
  opts: SearchIndexOptions = {}
): ContentSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const limit = opts.limit ?? DEFAULT_RESULT_LIMIT;
  const raw = index.search(trimmed) as (MiniSearchResult & ContentIndexDocument)[];
  return raw.slice(0, limit).map((r) => {
    const terms = (r.terms ?? []) as string[];
    const content = r.content ?? '';
    const { snippet, matchedTerm } = buildSnippet(content, terms);
    return {
      path: r.path,
      name: r.name,
      snippet,
      score: r.score,
      matchedTerm: matchedTerm || terms[0] || trimmed,
    };
  });
}

/**
 * Replace (or add) a single document in the index. Used on save so the
 * freshly-written content shows up in results without a full rescan.
 */
export function upsertDocument(
  index: MiniSearch<ContentIndexDocument>,
  doc: ContentIndexDocument
): void {
  if (index.has(doc.id)) {
    index.replace(doc);
  } else {
    index.add(doc);
  }
}

export function removeDocument(
  index: MiniSearch<ContentIndexDocument>,
  id: string
): void {
  if (index.has(id)) {
    index.discard(id);
  }
}

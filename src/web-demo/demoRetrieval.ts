/**
 * Browser-demo retrieval backend.
 *
 * The desktop app retrieves with the native Tauri RAG command (LanceDB + local
 * embeddings). The browser web-demo (keepance.com/try, the tailnet preview) has
 * no Tauri backend, so `ragRetrieve` throws "RAG is only available in the
 * desktop app." and Ask used to fail before it ever reached the AI ("I couldn't
 * search your files yet").
 *
 * This module is the browser stand-in: a keyword index (MiniSearch — already the
 * app's full-text search dependency) over the seeded demo files. It returns the
 * SAME `RagHit[]` shape the Tauri command does, so every downstream step
 * (context-block assembly, the answer prompt, and citation binding) works
 * unchanged and the answer is cited against the real seeded documents.
 *
 * It is installed once, from the web-demo bootstrap (`main.tsx`), via
 * `MemoryService.setRetrievalBackend`. The desktop app never imports this file
 * (only `vite.config.web-demo.ts` builds the demo entry point).
 *
 * Matter isolation (paramount, and the thing an independent reviewer should
 * scrutinise): when Ask scopes a query to one client, retrieval is passed
 * `{ kind: 'matter', matterId }`. We resolve each chunk's matter with the SAME
 * resolver the rest of the app uses (`resolveMatterForPath`) and DROP any chunk
 * whose matter id differs — so a client-scoped question can never surface
 * another client's document, exactly like the native backend's matter prefilter.
 */

import MiniSearch from 'minisearch';
import type { RagHit, RetrievalScope } from '@/platform/utils/tauri-commands';
import { resolveMatterForPath, setRetrievalBackend } from '@/platform/rag/MemoryService';

/** A seeded file as it appears in the sample-workspace JSON. */
export interface DemoFile {
  path: string;
  content: string;
}

/** One indexed paragraph chunk of a file. */
interface DemoChunk {
  /** Numeric id MiniSearch needs as its document key. */
  id: number;
  path: string;
  /** 0-based index over the file's non-empty paragraphs; used as the citation
   *  locator (the model cites `[filename paragraph N]`). */
  paragraphIndex: number;
  text: string;
}

/** Resolve a file path to its matter id. Defaults to the app-wide resolver so
 *  the demo tags chunks exactly as the native indexer would; injectable for
 *  tests. */
export type MatterResolver = (path: string) => string;

/**
 * Split a file's content into paragraph chunks. Paragraphs are separated by one
 * or more blank lines (the markdown convention the seeded files follow). Empty
 * segments are skipped; `paragraphIndex` is a 0-based counter over the kept
 * (non-empty) paragraphs, stable for citation binding.
 */
function chunkContent(content: string): { paragraphIndex: number; text: string }[] {
  const segments = content.split(/\n\s*\n/);
  const out: { paragraphIndex: number; text: string }[] = [];
  let idx = 0;
  for (const segment of segments) {
    const text = segment.trim();
    if (text.length === 0) continue;
    out.push({ paragraphIndex: idx, text });
    idx += 1;
  }
  return out;
}

/** Best-effort sourceType from the file extension (cosmetic; drives citation
 *  labels). Everything the demo seeds is text/markdown except `.aichat`. */
function sourceTypeForPath(path: string): NonNullable<RagHit['sourceType']> {
  const lower = path.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.pdf')) return 'pdf';
  return 'text';
}

export interface DemoRetriever {
  /** Mirrors `MemoryService.retrieve`'s signature so it slots in as the backend. */
  retrieve: (
    query: string,
    topK: number,
    scope: RetrievalScope,
    includePrivileged?: boolean,
    perSourceCap?: number,
    enableReranker?: boolean,
    enableHybridSearch?: boolean,
  ) => Promise<RagHit[]>;
}

/**
 * Build a keyword retriever over the given seeded files. Pure and synchronous
 * (MiniSearch indexes in memory); returns an object whose `retrieve` matches the
 * RetrievalBackend contract.
 */
export function createDemoRetriever(
  files: DemoFile[],
  resolveMatter: MatterResolver = resolveMatterForPath,
): DemoRetriever {
  const chunks: DemoChunk[] = [];
  let nextId = 0;
  for (const file of files) {
    for (const c of chunkContent(file.content)) {
      chunks.push({ id: nextId, path: file.path, paragraphIndex: c.paragraphIndex, text: c.text });
      nextId += 1;
    }
  }

  const mini = new MiniSearch<DemoChunk>({
    fields: ['text', 'path'],
    storeFields: ['path', 'paragraphIndex', 'text'],
    // Weight the body text far above the path so a filename token doesn't drown
    // out real content matches, but a query naming the file still helps.
    searchOptions: { boost: { text: 4, path: 1 }, fuzzy: 0.2, prefix: true, combineWith: 'OR' },
  });
  mini.addAll(chunks);
  const byId = new Map<number, DemoChunk>(chunks.map((c) => [c.id, c]));

  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async retrieve(query, topK, scope) {
      if (!query.trim() || topK <= 0) return [];
      const results = mini.search(query);
      const hits: RagHit[] = [];
      for (const result of results) {
        const chunk = byId.get(result.id as number);
        if (!chunk) continue;
        const matterId = resolveMatter(chunk.path);
        // Matter isolation: a client-scoped query must never return another
        // client's chunk. Drop anything whose matter id doesn't match the scope.
        if (scope.kind === 'matter' && matterId !== scope.matterId) continue;
        hits.push({
          path: chunk.path,
          chunkText: chunk.text,
          score: result.score,
          paragraphIndex: chunk.paragraphIndex,
          matterId,
          sourceId: chunk.path,
          sourceType: sourceTypeForPath(chunk.path),
        });
        if (hits.length >= topK) break;
      }
      return hits;
    },
  };
}

/**
 * Build a retriever over the seeded demo files and install it as the
 * MemoryService retrieval backend. Called once from the web-demo bootstrap after
 * the workspace is seeded, so the first Ask query already has a working index.
 */
export function installDemoRetrieval(files: DemoFile[]): void {
  const retriever = createDemoRetriever(files);
  setRetrievalBackend((query, topK, scope, includePrivileged, perSourceCap, enableReranker, enableHybridSearch) =>
    retriever.retrieve(query, topK, scope, includePrivileged, perSourceCap, enableReranker, enableHybridSearch),
  );
}

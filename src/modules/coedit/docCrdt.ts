/**
 * docCrdt — Y.Doc ↔ DocumentJson bidirectional converters.
 *
 * This module is the heart of the Wave 4 live co-editing feature. It is
 * intentionally PURE: no transport, no Tauri, no UI concerns.
 *
 * ## Y.Doc schema
 *
 * ```
 * Y.Doc
 *   meta : Y.Map   { matterId, docId, fileName, formatVersion }
 *   body : Y.Array<Y.Map>  ordered blocks
 *
 *   block (paragraph) Y.Map:
 *     id       : string           uuid, stable identity
 *     type     : 'paragraph'
 *     propsXml : string | null    verbatim w:pPr, null when absent
 *     runs     : Y.Array<Y.Map>
 *
 *   block (raw) Y.Map:
 *     id       : string
 *     type     : 'raw'
 *     rawXml   : string           opaque, not character-merged
 *
 *   run (plain) Y.Map:
 *     id           : string
 *     kind         : 'text'
 *     text         : Y.Text       character-level CRDT body
 *     propsXml     : string | null  verbatim w:rPr
 *     preserveSpace: boolean
 *
 *   run (tracked change) Y.Map:
 *     id      : string
 *     kind    : 'ins' | 'del'    CRDT-internal shorthand
 *     metaId  : string           original w:id (stored; re-emitted empty — see CONTRACT)
 *     author  : string           immutable once set; survives concurrent merge
 *     date    : string           ISO-8601
 *     subruns : Y.Array<Y.Map>   preserves multi-run tracked changes loss-free
 *
 *   subrun Y.Map (inside subruns):
 *     id           : string
 *     text         : Y.Text
 *     propsXml     : string | null
 *     preserveSpace: boolean
 *
 *   run (opaque) Y.Map:
 *     id         : string
 *     kind       : 'opaque'
 *     opaqueJson : string         JSON.stringify of original DocxInline
 *                                 covers commentRangeStart/End, commentReference,
 *                                 and inline raw — preserved verbatim, not merged
 * ```
 *
 * ## Tracked-change multi-run representation
 *
 * DocxInlineInsertion / DocxInlineDeletion each carry `runs: DocxRun[]` (not
 * just one run). Flattening to a single Y.Text would lose per-run formatting
 * when a tracked change wraps runs with distinct propertiesXml. Instead we
 * model them as a nested Y.Array<Y.Map> ('subruns'), making the round-trip
 * loss-free for all cases the fixture covers and for multi-run tracked changes
 * with distinct per-run propertiesXml.
 *
 * ## CONTRACT — w:id allocation
 *
 * `yDocToDocumentJson` emits `meta.id = ''` for every tracked run.
 * keepance-docx serialize is the single allocator for w:id (Task 12 verifies
 * and, if needed, adds a pre-save allocation pass using max_revision_id()+1).
 * Downstream code that hands this JSON to `docx_save` must NOT rely on
 * meta.id being non-empty from the CRDT layer.
 *
 * ## yjs nesting rule
 *
 * All construction happens inside one `ydoc.transact(...)`. Nested
 * Y.Array / Y.Text values are set on their parent Y.Map BEFORE being
 * populated (so the parent owns the reference before children are mutated).
 */

import * as Y from 'yjs';
import type {
  DocumentJson,
  DocxBlock,
  DocxParagraph,
  DocxInline,
  DocxInlineRun,
  DocxInlineInsertion,
  DocxInlineDeletion,
  DocxRun,
} from '@/types/docx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uuid(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// documentJsonToYDoc
// ---------------------------------------------------------------------------

/**
 * Build a fresh Y.Doc CRDT tree from engine JSON.
 *
 * Used to seed a brand-new document CRDT stream from an opened .docx file
 * (i.e. when no relay state exists for this document yet). If relay state
 * already exists, join it instead (coeditSession.ts handles that decision).
 */
export function documentJsonToYDoc(
  doc: DocumentJson,
  meta?: { matterId?: string; docId?: string; fileName?: string },
): Y.Doc {
  const ydoc = new Y.Doc();
  const body = ydoc.getArray<Y.Map<unknown>>('body');
  const metaMap = ydoc.getMap<unknown>('meta');

  // Build the entire tree inside ONE transaction. Nested types are integrated
  // into their parent before being populated (yjs nesting rule).
  ydoc.transact(() => {
    metaMap.set('matterId', meta?.matterId ?? null);
    metaMap.set('docId', meta?.docId ?? null);
    metaMap.set('fileName', meta?.fileName ?? null);
    // formatVersion is a required field (number), no nullish fallback needed.
    metaMap.set('formatVersion', doc.formatVersion);

    for (const block of doc.body) {
      body.push([buildBlock(block)]);
    }
  });

  return ydoc;
}

function buildBlock(block: DocxBlock): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('id', uuid());

  if (block.kind === 'raw') {
    m.set('type', 'raw');
    m.set('rawXml', block.xml);
    return m;
  }

  // TypeScript narrows block to DocxParagraph after the 'raw' branch above.
  m.set('type', 'paragraph');
  m.set('propsXml', block.propertiesXml ?? null);

  // Integrate runs Y.Array into m BEFORE populating (yjs nesting rule).
  const runs = new Y.Array<Y.Map<unknown>>();
  m.set('runs', runs);

  for (const inline of block.inlines) {
    runs.push([buildRun(inline)]);
  }

  return m;
}

function buildRun(inline: DocxInline): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('id', uuid());

  if (inline.kind === 'insertion' || inline.kind === 'deletion') {
    // Internal CRDT kind uses 'ins'/'del' shorthand to distinguish from
    // the DocumentJson discriminant strings 'insertion'/'deletion'.
    m.set('kind', inline.kind === 'insertion' ? 'ins' : 'del');
    // TypeScript narrows inline to DocxInlineInsertion | DocxInlineDeletion here.
    // Store the original w:id in metaId but emit empty on read (CONTRACT above).
    m.set('metaId', inline.meta.id);
    m.set('author', inline.meta.author);
    m.set('date', inline.meta.date);

    // Use a nested Y.Array for sub-runs so that multi-run tracked changes
    // with distinct per-run propertiesXml round-trip loss-free.
    const subruns = new Y.Array<Y.Map<unknown>>();
    m.set('subruns', subruns); // integrate before populating

    for (const run of inline.runs) {
      subruns.push([buildSubRun(run)]);
    }

    return m;
  }

  if (inline.kind === 'run') {
    m.set('kind', 'text');
    // Integrate Y.Text into m BEFORE inserting content.
    const text = new Y.Text();
    m.set('text', text);
    text.insert(0, inline.text);
    // TypeScript narrows inline to DocxInlineRun in this branch.
    m.set('propsXml', inline.propertiesXml ?? null);
    m.set('preserveSpace', inline.preserveSpace ?? false);
    return m;
  }

  // All other inline types (commentRangeStart, commentRangeEnd,
  // commentReference, inline raw) are modeled as opaque Y.Maps. They are
  // preserved verbatim and NOT character-merged.
  m.set('kind', 'opaque');
  m.set('opaqueJson', JSON.stringify(inline));
  return m;
}

function buildSubRun(run: DocxRun): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('id', uuid());
  // Integrate Y.Text into m BEFORE inserting content.
  const text = new Y.Text();
  m.set('text', text);
  text.insert(0, run.text);
  m.set('propsXml', run.propertiesXml ?? null);
  m.set('preserveSpace', run.preserveSpace ?? false);
  return m;
}

// ---------------------------------------------------------------------------
// yDocToDocumentJson
// ---------------------------------------------------------------------------

/**
 * Read the converged Y.Doc back to engine JSON (for save and editor render).
 *
 * CONTRACT: every tracked revision is emitted with `meta.id = ''`.
 * keepance-docx serialize is the single allocator for w:id (Task 12).
 *
 * Comments are NOT in the CRDT (design §5). They are preserved by keepance-docx
 * from the original package at save. The returned `comments` is always `{}`.
 */
export function yDocToDocumentJson(ydoc: Y.Doc): DocumentJson {
  const body = ydoc.getArray<Y.Map<unknown>>('body');
  const metaMap = ydoc.getMap<unknown>('meta');

  const blocks: DocxBlock[] = body.toArray().map(readBlock);
  const fv = metaMap.get('formatVersion');
  return {
    formatVersion: typeof fv === 'number' ? fv : 1,
    body: blocks,
    // Comments live in the original package, not in the CRDT (design §5, §7).
    comments: {},
  };
}

function readBlock(m: Y.Map<unknown>): DocxBlock {
  if (m.get('type') === 'raw') {
    return { kind: 'raw', xml: m.get('rawXml') as string };
  }

  const propsXml = m.get('propsXml');
  const runsArray = m.get('runs') as Y.Array<Y.Map<unknown>>;
  const inlines: DocxInline[] = runsArray.toArray().map(readRun);

  const para: DocxParagraph = { kind: 'paragraph', inlines };
  // Only set propertiesXml when it is a string (undefined when absent, not null).
  if (typeof propsXml === 'string') para.propertiesXml = propsXml;
  return para;
}

function readRun(m: Y.Map<unknown>): DocxInline {
  const kind = m.get('kind') as string;

  if (kind === 'text') {
    // Use toJSON() — Y.Text.toJSON() is typed to return the plain-text string.
    const text = (m.get('text') as Y.Text).toJSON();
    const propsXml = m.get('propsXml');
    // Use === true to handle the case where the key was never set (returns undefined).
    const preserveSpace = m.get('preserveSpace') === true;
    const run: DocxInlineRun = { kind: 'run', text };
    if (preserveSpace) run.preserveSpace = true;
    if (typeof propsXml === 'string') run.propertiesXml = propsXml;
    return run;
  }

  if (kind === 'ins' || kind === 'del') {
    const author = m.get('author') as string;
    const date = m.get('date') as string;
    const subruns = (m.get('subruns') as Y.Array<Y.Map<unknown>>).toArray();
    const runs: DocxRun[] = subruns.map(readSubRun);

    // meta.id is intentionally empty — see CONTRACT at yDocToDocumentJson.
    if (kind === 'ins') {
      const ins: DocxInlineInsertion = {
        kind: 'insertion',
        meta: { id: '', author, date },
        runs,
      };
      return ins;
    } else {
      const del: DocxInlineDeletion = {
        kind: 'deletion',
        meta: { id: '', author, date },
        runs,
      };
      return del;
    }
  }

  if (kind === 'opaque') {
    // Deserialize opaque inlines (commentRange*, inline raw) back verbatim.
    return JSON.parse(m.get('opaqueJson') as string) as DocxInline;
  }

  // Defensive fallback — should never be reached with well-formed CRDT data.
  throw new Error(`docCrdt: unknown run kind '${kind}'`);
}

function readSubRun(m: Y.Map<unknown>): DocxRun {
  const text = (m.get('text') as Y.Text).toJSON();
  const propsXml = m.get('propsXml');
  const preserveSpace = m.get('preserveSpace') === true;
  const run: DocxRun = { text };
  if (preserveSpace) run.preserveSpace = true;
  if (typeof propsXml === 'string') run.propertiesXml = propsXml;
  return run;
}

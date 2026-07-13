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
 * lantern-docx serialize is the single allocator for w:id (Task 12 verifies
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
} from '@/platform/types/docx';
import { applyTextDiff } from './textDiff';

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
  const body = ydoc.getArray<unknown>('body');
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
 * lantern-docx serialize is the single allocator for w:id (Task 12).
 *
 * Comments are NOT in the CRDT (design §5). They are preserved by lantern-docx
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

function isYMap(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map;
}

function isYArray(value: unknown): value is Y.Array<unknown> {
  return value instanceof Y.Array;
}

function isYText(value: unknown): value is Y.Text {
  return value instanceof Y.Text;
}

/** Unknown CRDT shapes must render as inert empty/raw content, never throw. */
function readBlock(value: unknown): DocxBlock {
  if (!isYMap(value)) return { kind: 'raw', xml: '' };
  if (value.get('type') === 'raw') {
    const rawXml = value.get('rawXml');
    return { kind: 'raw', xml: typeof rawXml === 'string' ? rawXml : '' };
  }

  const propsXml = value.get('propsXml');
  const runsArray = value.get('runs');
  const inlines: DocxInline[] = isYArray(runsArray) ? runsArray.toArray().map(readRun) : [];

  const para: DocxParagraph = { kind: 'paragraph', inlines };
  // Only set propertiesXml when it is a string (undefined when absent, not null).
  if (typeof propsXml === 'string') para.propertiesXml = propsXml;
  return para;
}

function readRun(value: unknown): DocxInline {
  if (!isYMap(value)) return { kind: 'raw', xml: '' };
  const m = value;
  const kind = m.get('kind') as string;

  if (kind === 'text') {
    // Use toJSON() — Y.Text.toJSON() is typed to return the plain-text string.
    const ytext = m.get('text');
    const text = isYText(ytext) ? ytext.toJSON() : '';
    const propsXml = m.get('propsXml');
    // Use === true to handle the case where the key was never set (returns undefined).
    const preserveSpace = m.get('preserveSpace') === true;
    const run: DocxInlineRun = { kind: 'run', text };
    if (preserveSpace) run.preserveSpace = true;
    if (typeof propsXml === 'string') run.propertiesXml = propsXml;
    return run;
  }

  if (kind === 'ins' || kind === 'del') {
    const author = typeof m.get('author') === 'string' ? m.get('author') as string : '';
    const date = typeof m.get('date') === 'string' ? m.get('date') as string : '';
    const subruns = m.get('subruns');
    const runs: DocxRun[] = isYArray(subruns) ? subruns.toArray().map(readSubRun) : [];

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
    const opaqueJson = m.get('opaqueJson');
    if (typeof opaqueJson === 'string') {
      try {
        const parsed = JSON.parse(opaqueJson) as unknown;
        if (isDocxInline(parsed)) return parsed;
      } catch {
        // Malformed peer data becomes an inert raw inline below. Never log the raw
        // parse error — its message can embed a fragment of the unparseable input.
        console.error('[docCrdt] discarding malformed opaque inline');
      }
    }
    return { kind: 'raw', xml: '' };
  }

  return { kind: 'raw', xml: '' };
}

function readSubRun(value: unknown): DocxRun {
  if (!isYMap(value)) return { text: '' };
  const m = value;
  const ytext = m.get('text');
  const text = isYText(ytext) ? ytext.toJSON() : '';
  const propsXml = m.get('propsXml');
  const preserveSpace = m.get('preserveSpace') === true;
  const run: DocxRun = { text };
  if (preserveSpace) run.preserveSpace = true;
  if (typeof propsXml === 'string') run.propertiesXml = propsXml;
  return run;
}

function isDocxInline(value: unknown): value is DocxInline {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const inline = value as Record<string, unknown>;
  if (inline['kind'] === 'run') return typeof inline['text'] === 'string';
  if (inline['kind'] === 'raw') return typeof inline['xml'] === 'string';
  if (inline['kind'] === 'commentRangeStart' || inline['kind'] === 'commentRangeEnd' || inline['kind'] === 'commentReference') {
    return typeof inline['id'] === 'string';
  }
  if (inline['kind'] !== 'insertion' && inline['kind'] !== 'deletion') return false;
  const meta = inline['meta'];
  return !!meta && typeof meta === 'object' && !Array.isArray(meta)
    && typeof (meta as Record<string, unknown>)['id'] === 'string'
    && typeof (meta as Record<string, unknown>)['author'] === 'string'
    && typeof (meta as Record<string, unknown>)['date'] === 'string'
    && Array.isArray(inline['runs'])
    && inline['runs'].every((run) => !!run && typeof run === 'object' && !Array.isArray(run)
      && typeof (run as Record<string, unknown>)['text'] === 'string');
}

// ---------------------------------------------------------------------------
// Mutator helpers
// ---------------------------------------------------------------------------

/**
 * Find a block Y.Map by its id, scanning the body array.
 * Returns null if not found.
 */
export function findBlockById(ydoc: Y.Doc, blockId: string): Y.Map<unknown> | null {
  const body = ydoc.getArray<Y.Map<unknown>>('body');
  for (const block of body.toArray()) {
    if (block.get('id') === blockId) {
      return block;
    }
  }
  return null;
}

/**
 * Find a run Y.Map by its id, scanning a block's runs array.
 * Returns null if not found. Only works on paragraph blocks (not raw).
 */
export function findRunById(block: Y.Map<unknown>, runId: string): Y.Map<unknown> | null {
  const runs = block.get('runs') as Y.Array<Y.Map<unknown>> | undefined;
  if (!runs) return null;
  for (const run of runs.toArray()) {
    if (run.get('id') === runId) {
      return run;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Structural mutators
// ---------------------------------------------------------------------------

/**
 * Append an empty paragraph block to the document body.
 * Returns the new block's uuid.
 */
export function appendParagraph(ydoc: Y.Doc, author: string): string {
  const id = uuid();
  ydoc.transact(() => {
    const body = ydoc.getArray<Y.Map<unknown>>('body');
    const m = new Y.Map<unknown>();
    m.set('id', id);
    m.set('type', 'paragraph');
    m.set('propsXml', null);
    const runs = new Y.Array<Y.Map<unknown>>();
    m.set('runs', runs);
    body.push([m]);
  }, author);
  return id;
}

/**
 * Insert a plain text run at `index` in the named block's runs.
 * Returns the new run's uuid.
 */
export function insertRun(
  ydoc: Y.Doc,
  blockId: string,
  index: number,
  text: string,
  author: string,
): string {
  const id = uuid();
  ydoc.transact(() => {
    const block = findBlockById(ydoc, blockId);
    if (!block) throw new Error(`docCrdt.insertRun: block '${blockId}' not found`);
    const runs = block.get('runs') as Y.Array<Y.Map<unknown>>;
    const m = new Y.Map<unknown>();
    m.set('id', id);
    m.set('kind', 'text');
    const ytext = new Y.Text();
    m.set('text', ytext);
    ytext.insert(0, text);
    m.set('propsXml', null);
    m.set('preserveSpace', false);
    runs.insert(index, [m]);
  }, author);
  return id;
}

/**
 * Edit the text of an existing plain run via applyTextDiff (character-level ops).
 */
export function editRunText(
  ydoc: Y.Doc,
  blockId: string,
  runId: string,
  oldText: string,
  newText: string,
  author: string,
): void {
  const block = findBlockById(ydoc, blockId);
  if (!block) throw new Error(`docCrdt.editRunText: block '${blockId}' not found`);
  const run = findRunById(block, runId);
  if (!run) throw new Error(`docCrdt.editRunText: run '${runId}' not found`);
  const ytext = run.get('text') as Y.Text;
  // applyTextDiff wraps in its own transact with origin = author
  applyTextDiff(ydoc, ytext, oldText, newText, author);
}

/**
 * Remove a block from the document body by id.
 */
export function deleteBlock(ydoc: Y.Doc, blockId: string, author: string): void {
  ydoc.transact(() => {
    const body = ydoc.getArray<Y.Map<unknown>>('body');
    const arr = body.toArray();
    const idx = arr.findIndex(b => b.get('id') === blockId);
    if (idx === -1) throw new Error(`docCrdt.deleteBlock: block '${blockId}' not found`);
    body.delete(idx, 1);
  }, author);
}

/**
 * Split a paragraph at (runId, character offset) into two paragraphs.
 *
 * - The run at runId is split at offset: text before offset stays in the
 *   original block; text from offset onwards moves to the new block.
 * - Runs AFTER runId in the original block are moved entirely to the new block
 *   (as NEW Y.Map copies, since yjs does not allow re-parenting integrated nodes).
 * - An empty half-run (length 0) is excluded rather than left as an empty run.
 *
 * Returns the uuid of the new paragraph.
 */
export function splitParagraph(
  ydoc: Y.Doc,
  blockId: string,
  runId: string,
  offset: number,
  author: string,
): string {
  const newId = uuid();
  ydoc.transact(() => {
    const body = ydoc.getArray<Y.Map<unknown>>('body');
    const block = findBlockById(ydoc, blockId);
    if (!block) throw new Error(`docCrdt.splitParagraph: block '${blockId}' not found`);
    const runs = block.get('runs') as Y.Array<Y.Map<unknown>>;
    const runsArr = runs.toArray();
    const splitRunIdx = runsArr.findIndex(r => r.get('id') === runId);
    if (splitRunIdx === -1) throw new Error(`docCrdt.splitParagraph: run '${runId}' not found`);

    // findIndex + guard above guarantees the element exists
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const splitRun = runsArr[splitRunIdx]!;
    const splitKind = splitRun.get('kind') as string;

    // Build the new paragraph map
    const newBlock = new Y.Map<unknown>();
    newBlock.set('id', newId);
    newBlock.set('type', 'paragraph');
    newBlock.set('propsXml', block.get('propsXml') ?? null);
    const newRuns = new Y.Array<Y.Map<unknown>>();
    newBlock.set('runs', newRuns);

    // Non-text run at split point: kept whole on original side; only afterRuns move.
    if (splitKind !== 'text') {
      const afterRuns = runsArr.slice(splitRunIdx + 1);
      for (const r of afterRuns) {
        const copy = copyRun(r);
        newRuns.push([copy]);
      }
      // Remove only the afterRuns from the original block (split run stays)
      if (afterRuns.length > 0) {
        runs.delete(splitRunIdx + 1, afterRuns.length);
      }
      // Insert the new block after the current one
      const bodyArr = body.toArray();
      const blockIdx = bodyArr.findIndex(b => b.get('id') === blockId);
      body.insert(blockIdx + 1, [newBlock]);
      return;
    }

    const splitYText: Y.Text = splitRun.get('text') as Y.Text;
    const fullText = splitYText.toJSON();

    const headText = fullText.slice(0, offset);
    const tailText = fullText.slice(offset);

    // Build the tail half of the split run (text from offset onwards)
    if (tailText.length > 0) {
      const tailRun = new Y.Map<unknown>();
      tailRun.set('id', uuid());
      tailRun.set('kind', splitRun.get('kind') ?? 'text');
      const tailYText = new Y.Text();
      tailRun.set('text', tailYText);
      tailYText.insert(0, tailText);
      tailRun.set('propsXml', splitRun.get('propsXml') ?? null);
      tailRun.set('preserveSpace', splitRun.get('preserveSpace') ?? false);
      newRuns.push([tailRun]);
    }

    // Copy runs AFTER the split run into the new block (must be NEW Y.Map nodes)
    const afterRuns = runsArr.slice(splitRunIdx + 1);
    for (const r of afterRuns) {
      const copy = copyRun(r);
      newRuns.push([copy]);
    }

    // Truncate the original split run's Y.Text to just the head
    if (splitYText.length > headText.length) {
      splitYText.delete(headText.length, splitYText.length - headText.length);
    }

    // Remove runs from the original block:
    // - always remove afterRuns from the end
    // - also remove the split run itself if its head is empty
    if (headText.length === 0) {
      // splitRun becomes empty — remove it and all afterRuns
      runs.delete(splitRunIdx, 1 + afterRuns.length);
    } else if (afterRuns.length > 0) {
      // keep split run (now trimmed), remove afterRuns
      runs.delete(splitRunIdx + 1, afterRuns.length);
    }

    // Insert the new block after the current one
    const bodyArr = body.toArray();
    const blockIdx = bodyArr.findIndex(b => b.get('id') === blockId);
    body.insert(blockIdx + 1, [newBlock]);
  }, author);
  return newId;
}

/** Create a fresh Y.Map copy of any run kind (for re-parenting). */
function copyRun(r: Y.Map<unknown>): Y.Map<unknown> {
  const copy = new Y.Map<unknown>();
  copy.set('id', uuid());
  const kind = r.get('kind') as string;
  copy.set('kind', kind);

  if (kind === 'ins' || kind === 'del') {
    // Tracked-change run: copy metadata and clone each subrun.
    copy.set('metaId', r.get('metaId') ?? '');
    copy.set('author', r.get('author') ?? '');
    copy.set('date', r.get('date') ?? '');
    const subruns = new Y.Array<Y.Map<unknown>>();
    copy.set('subruns', subruns);
    const srcSubruns = r.get('subruns') as Y.Array<Y.Map<unknown>>;
    for (const sub of srcSubruns.toArray()) {
      const subCopy = new Y.Map<unknown>();
      subCopy.set('id', uuid());
      const subText = new Y.Text();
      subCopy.set('text', subText);
      subText.insert(0, (sub.get('text') as Y.Text).toJSON());
      subCopy.set('propsXml', sub.get('propsXml') ?? null);
      subCopy.set('preserveSpace', sub.get('preserveSpace') ?? false);
      subruns.push([subCopy]);
    }
    return copy;
  }

  if (kind === 'opaque') {
    // Opaque run: copy opaqueJson verbatim.
    copy.set('opaqueJson', r.get('opaqueJson') ?? '{}');
    return copy;
  }

  // Plain text run (kind === 'text' or any unknown kind treated as text)
  const ytext = new Y.Text();
  copy.set('text', ytext);
  ytext.insert(0, (r.get('text') as Y.Text).toJSON());
  copy.set('propsXml', r.get('propsXml') ?? null);
  copy.set('preserveSpace', r.get('preserveSpace') ?? false);
  return copy;
}

// ---------------------------------------------------------------------------
// Tracked-change mutators
// ---------------------------------------------------------------------------

/**
 * Append a tracked insertion run ('ins') to the named block.
 * The run holds one subrun with the given text.
 * Returns the new run's uuid.
 */
export function addTrackedInsertion(
  ydoc: Y.Doc,
  blockId: string,
  text: string,
  author: string,
): string {
  const id = uuid();
  ydoc.transact(() => {
    const block = findBlockById(ydoc, blockId);
    if (!block) throw new Error(`docCrdt.addTrackedInsertion: block '${blockId}' not found`);
    const runs = block.get('runs') as Y.Array<Y.Map<unknown>>;

    const m = new Y.Map<unknown>();
    m.set('id', id);
    m.set('kind', 'ins');
    m.set('metaId', '');
    m.set('author', author);
    m.set('date', new Date().toISOString());

    const subruns = new Y.Array<Y.Map<unknown>>();
    m.set('subruns', subruns);

    const sub = new Y.Map<unknown>();
    sub.set('id', uuid());
    const ytext = new Y.Text();
    sub.set('text', ytext);
    ytext.insert(0, text);
    sub.set('propsXml', null);
    sub.set('preserveSpace', false);
    subruns.push([sub]);

    runs.push([m]);
  }, author);
  return id;
}

/**
 * Convert an existing plain run into a tracked deletion ('del') run.
 * The run's current text becomes the first (and only) subrun.
 * Returns the resulting run id (same as the original run id).
 */
export function addTrackedDeletion(
  ydoc: Y.Doc,
  blockId: string,
  runId: string,
  author: string,
): string {
  ydoc.transact(() => {
    const block = findBlockById(ydoc, blockId);
    if (!block) throw new Error(`docCrdt.addTrackedDeletion: block '${blockId}' not found`);
    const run = findRunById(block, runId);
    if (!run) throw new Error(`docCrdt.addTrackedDeletion: run '${runId}' not found`);

    const currentText = (run.get('text') as Y.Text).toJSON();
    const currentPropsXml = run.get('propsXml') ?? null;
    const currentPreserveSpace = run.get('preserveSpace') === true;

    // Build subruns from the existing run's text
    const subruns = new Y.Array<Y.Map<unknown>>();

    const sub = new Y.Map<unknown>();
    sub.set('id', uuid());
    const ytext = new Y.Text();
    sub.set('text', ytext);
    ytext.insert(0, currentText);
    sub.set('propsXml', currentPropsXml);
    sub.set('preserveSpace', currentPreserveSpace);
    subruns.push([sub]);

    // Mutate the run in place: change kind, set tracked-change fields, add subruns
    run.set('kind', 'del');
    run.set('metaId', '');
    run.set('author', author);
    run.set('date', new Date().toISOString());
    run.set('subruns', subruns);
    // Remove the 'text' key (del runs use subruns, not a top-level Y.Text)
    run.delete('text');
  }, author);
  return runId;
}

/**
 * Resolve a tracked change run.
 *
 * accept on 'ins': set kind='text', collapse subruns into a single Y.Text,
 *                  drop author/date/metaId/subruns.
 * reject on 'ins': remove the run entirely from the block.
 * accept on 'del': remove the run entirely from the block.
 * reject on 'del': set kind='text', restore text from subruns,
 *                  drop author/date/metaId/subruns.
 */
export function resolveRevision(
  ydoc: Y.Doc,
  blockId: string,
  runId: string,
  action: 'accept' | 'reject',
  author: string,
): void {
  ydoc.transact(() => {
    const block = findBlockById(ydoc, blockId);
    if (!block) throw new Error(`docCrdt.resolveRevision: block '${blockId}' not found`);
    const runs = block.get('runs') as Y.Array<Y.Map<unknown>>;
    const runsArr = runs.toArray();
    const runIdx = runsArr.findIndex(r => r.get('id') === runId);
    if (runIdx === -1) throw new Error(`docCrdt.resolveRevision: run '${runId}' not found`);
    // findIndex + guard above guarantees the element exists
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const run = runsArr[runIdx]!;
    const kind = run.get('kind') as 'ins' | 'del';

    if (kind === 'ins') {
      if (action === 'accept') {
        // Collapse subruns into a single Y.Text run
        const subruns = (run.get('subruns') as Y.Array<Y.Map<unknown>>).toArray();
        const collapsedText = subruns.map(s => (s.get('text') as Y.Text).toJSON()).join('');
        const propsXml = subruns[0]?.get('propsXml') ?? null;
        const preserveSpace = subruns[0]?.get('preserveSpace') === true;

        const ytext = new Y.Text();
        run.set('text', ytext);
        ytext.insert(0, collapsedText);
        run.set('kind', 'text');
        run.set('propsXml', propsXml);
        run.set('preserveSpace', preserveSpace);
        run.delete('author');
        run.delete('date');
        run.delete('metaId');
        run.delete('subruns');
      } else {
        // reject: remove the run entirely
        runs.delete(runIdx, 1);
      }
    } else {
      // kind === 'del'
      if (action === 'accept') {
        // accept deletion: remove the run
        runs.delete(runIdx, 1);
      } else {
        // reject deletion: restore text as plain run
        const subruns = (run.get('subruns') as Y.Array<Y.Map<unknown>>).toArray();
        const restoredText = subruns.map(s => (s.get('text') as Y.Text).toJSON()).join('');
        const propsXml = subruns[0]?.get('propsXml') ?? null;
        const preserveSpace = subruns[0]?.get('preserveSpace') === true;

        const ytext = new Y.Text();
        run.set('text', ytext);
        ytext.insert(0, restoredText);
        run.set('kind', 'text');
        run.set('propsXml', propsXml);
        run.set('preserveSpace', preserveSpace);
        run.delete('author');
        run.delete('date');
        run.delete('metaId');
        run.delete('subruns');
      }
    }
  }, author);
}

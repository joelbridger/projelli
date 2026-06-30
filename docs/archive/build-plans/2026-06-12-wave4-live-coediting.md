# Wave 4 — Live Multi-User .docx Co-Editing (VG-8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is the **xhigh, data-integrity-sensitive** build (the largest in the plan): Opus reviews EVERY diff; the convergence + fidelity tests are the gate, not an afterthought. Build the converters + convergence (Tasks 1–5) FIRST — they are the heart and where correctness lives.

**Goal:** Two or more firm members edit the same open `.docx` live, with no data loss, offline-then-merge, and tracked-change attribution that survives concurrent edits; the relay only ever stores E2EE opaque blobs.

**Architecture:** The OOXML paragraphs→runs tree is a **yjs `Y.Doc`** (the proven document-tree-as-CRDT model from `spikes/firm-sync/DECISION.md`, ported from yrs to yjs). While open, the converged `Y.Doc` is the source of truth; on save it serializes to `.docx` via the in-house `keepance-docx` Rust engine (preserving all unmodeled parts). Updates sync as E2EE blobs over the existing matter relay, partitioned by a new `doc_id` stream, reusing the same per-matter key + epoch as notes.

**Tech Stack:** yjs (`yjs@^13.6`, already a dep), TypeScript; the existing `MatterSyncClient`/`matterCrypto`/`matterKeyService` transport; `keepance-docx` (Rust) for open/save; Bun relay backend; Vitest. **Design of record:** `docs/superpowers/specs/2026-06-12-live-coediting-design.md` — read it first; this plan implements it section by section.

---

## Conventions every task follows
- **TDD, strict.** For the converters + convergence, the tests ARE the spec. Never weaken an assertion.
- TS tests: `npm run test -- <path>`; typecheck `npx tsc --noEmit`; lint `npx eslint <files>`. Backend: `cd backend && bun test <file>`. Rust: `cd src-tauri && cargo test -p keepance-docx`.
- Reuse, don't reinvent: transport = `MatterSyncClient` internals + `matterCrypto` (`encryptUpdate`/`decryptUpdate`) + `matterKeyService`; serialization = `keepance-docx` via the existing `docx_open`/`docx_save` Tauri commands; the editor choke point is `DocxEditor.applyResolvedDocument(doc, save)`.
- yjs nesting rule: a nested `Y.Map`/`Y.Array`/`Y.Text` must be inserted into an **integrated** parent (already in the doc) before populating it; build top-down inside ONE `doc.transact(...)`.
- Author stamping: every mutating transaction uses `doc.transact(fn, authorOrigin)` where `authorOrigin` is the author string — the hook for the audit log + attribution.
- Conventional commits, one per task minimum. Opus reviews each diff; the orchestrator applies small review fixes directly.

## File structure (locked here)
**New (TS):** `src/modules/coedit/docCrdt.ts` (Y.Doc ↔ DocumentJson + mutators), `src/modules/coedit/textDiff.ts` (old→new text → Y.Text ops), `src/modules/coedit/MatterDocSyncClient.ts` (doc-scoped transport), `src/modules/coedit/coeditSession.ts` (lifecycle singleton), `src/modules/coedit/presence.ts` (awareness, best-effort). Tests under `tests/unit/coedit/`.
**Modified (backend):** `backend/src/lib/db.ts` (doc_id column + indexes + backfill), `backend/src/routes/matters.ts` (doc_id on push/pull/ticket/ws), `backend/src/lib/matters.ts` (FanoutHub keyed by matter+doc), `backend/src/contract.ts`.
**Modified (client):** `src/modules/firm/contract.ts`, `src/modules/firm/FirmApiClient.ts` (doc_id), `src/modules/firm/MatterSyncClient.ts` (optional docId), `src/components/media/DocxEditor.tsx` (co-edit activation).
**Verify against `keepance-docx`:** the model carries `RevisionMeta.id` + `Document::max_revision_id()`; the single-writer w:id allocation may already hold — confirm in Task 12, change Rust only if needed.

---

### Task 1: docCrdt — DocumentJson → Y.Doc → DocumentJson round-trip (the heart)

**Files:**
- Create: `src/modules/coedit/docCrdt.ts`
- Test: `tests/unit/coedit/docCrdt.roundtrip.test.ts`
- Read first: `src/types/docx.ts` (the REAL `DocumentJson`/`DocxBlock`/`DocxParagraph`/`DocxInline`/`DocxRun` shapes — match them exactly), and `docs/.../2026-06-12-live-coediting-design.md` §5–§6.

- [ ] **Step 1: Write the failing round-trip test.** Use a `DocumentJson` fixture covering: a plain paragraph with two runs, a paragraph with a tracked insertion (`kind: 'ins'`, author/date) and a tracked deletion (`kind: 'del'`), a paragraph with `propsXml`, and a `raw` block. Assert `yDocToDocumentJson(documentJsonToYDoc(fixture))` deep-equals the modeled fixture (ids may be assigned but structure/text/kind/author/date/propsXml/rawXml preserved).

```ts
// tests/unit/coedit/docCrdt.roundtrip.test.ts
import { describe, it, expect } from 'vitest';
import { documentJsonToYDoc, yDocToDocumentJson } from '@/modules/coedit/docCrdt';
import type { DocumentJson } from '@/types/docx';

const FIXTURE: DocumentJson = {
  format_version: 1,
  body: [
    { kind: 'paragraph', properties_xml: null, inlines: [
      { kind: 'run', text: 'Hello ', preserve_space: false, properties_xml: null },
      { kind: 'run', text: 'world', preserve_space: false, properties_xml: '<w:rPr><w:b/></w:rPr>' },
    ]},
    { kind: 'paragraph', properties_xml: '<w:pPr><w:jc w:val="center"/></w:pPr>', inlines: [
      { kind: 'ins', meta: { id: '1', author: 'attorney-a', date: '2026-06-12T00:00:00Z' }, runs: [ { text: 'added', preserve_space: false, properties_xml: null } ] },
      { kind: 'del', meta: { id: '2', author: 'attorney-b', date: '2026-06-12T00:01:00Z' }, runs: [ { text: 'removed', preserve_space: false, properties_xml: null } ] },
    ]},
    { kind: 'raw', xml: '<w:tbl>...</w:tbl>' },
  ],
  comments: {},
};

describe('docCrdt round-trip', () => {
  it('DocumentJson → Y.Doc → DocumentJson preserves the modeled tree', () => {
    const ydoc = documentJsonToYDoc(FIXTURE);
    const back = yDocToDocumentJson(ydoc);
    expect(back.body.length).toBe(3);
    // plain paragraph
    expect(back.body[0]).toMatchObject({ kind: 'paragraph', properties_xml: null });
    expect(back.body[0].inlines[0]).toMatchObject({ kind: 'run', text: 'Hello ' });
    expect(back.body[0].inlines[1]).toMatchObject({ kind: 'run', text: 'world', properties_xml: '<w:rPr><w:b/></w:rPr>' });
    // tracked changes keep attribution
    expect(back.body[1].properties_xml).toBe('<w:pPr><w:jc w:val="center"/></w:pPr>');
    expect(back.body[1].inlines[0]).toMatchObject({ kind: 'ins' });
    expect(back.body[1].inlines[0].meta).toMatchObject({ author: 'attorney-a' });
    expect(back.body[1].inlines[0].runs[0].text).toBe('added');
    expect(back.body[1].inlines[1]).toMatchObject({ kind: 'del' });
    expect(back.body[1].inlines[1].meta).toMatchObject({ author: 'attorney-b' });
    // raw block survives
    expect(back.body[2]).toMatchObject({ kind: 'raw', xml: '<w:tbl>...</w:tbl>' });
  });
});
```

> **First read `src/types/docx.ts`** and adapt the fixture + assertions to the REAL field names (the inline discriminant may be `kind` or `type`; runs inside ins/del may be shaped differently). Match reality; keep the coverage (plain run, ins+del with attribution, propsXml, raw).

- [ ] **Step 2: Run red.** `npm run test -- tests/unit/coedit/docCrdt.roundtrip.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `docCrdt.ts`** converters. Model per design §5. Build top-down inside one transaction; integrate parents before populating. Sketch (adapt to real DocumentJson shape):

```ts
import * as Y from 'yjs';
import type { DocumentJson, DocxBlock, DocxInline, DocxRun } from '@/types/docx';

function uuid(): string { return crypto.randomUUID(); }

/** Build a fresh Y.Doc CRDT tree from engine JSON (seeding a new document stream). */
export function documentJsonToYDoc(doc: DocumentJson, meta?: { matterId?: string; docId?: string; fileName?: string }): Y.Doc {
  const ydoc = new Y.Doc();
  const body = ydoc.getArray<Y.Map<unknown>>('body');
  const metaMap = ydoc.getMap<unknown>('meta');
  ydoc.transact(() => {
    metaMap.set('matterId', meta?.matterId ?? null);
    metaMap.set('docId', meta?.docId ?? null);
    metaMap.set('fileName', meta?.fileName ?? null);
    metaMap.set('formatVersion', doc.format_version ?? 1);
    for (const block of doc.body) body.push([buildBlock(block)]);
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
  m.set('type', 'paragraph');
  m.set('propsXml', block.properties_xml ?? null);
  const runs = new Y.Array<Y.Map<unknown>>();
  m.set('runs', runs);            // integrate the Array into m before populating
  for (const inline of block.inlines) runs.push([buildRun(inline)]);
  return m;
}

function buildRun(inline: DocxInline): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('id', uuid());
  if (inline.kind === 'ins' || inline.kind === 'del') {
    m.set('kind', inline.kind);
    m.set('author', inline.meta.author);
    m.set('date', inline.meta.date);
    // tracked ins/del wrap one-or-more runs; v1 flattens their text into one Y.Text,
    // preserving the FIRST run's propsXml (round-trip keeps a single run per ins/del).
    const text = new Y.Text();
    m.set('text', text);
    text.insert(0, inline.runs.map(r => r.text).join(''));
    m.set('propsXml', inline.runs[0]?.properties_xml ?? null);
  } else {
    m.set('kind', 'text');
    const text = new Y.Text();
    m.set('text', text);
    text.insert(0, inline.text);
    m.set('propsXml', inline.properties_xml ?? null);
    m.set('preserveSpace', inline.preserve_space ?? false);
  }
  return m;
}

/** Read the converged Y.Doc back to engine JSON (for save + editor render). */
export function yDocToDocumentJson(ydoc: Y.Doc): DocumentJson {
  const body = ydoc.getArray<Y.Map<unknown>>('body');
  const metaMap = ydoc.getMap<unknown>('meta');
  const blocks: DocxBlock[] = body.toArray().map(readBlock);
  return { format_version: (metaMap.get('formatVersion') as number) ?? 1, body: blocks, comments: {} };
}

function readBlock(m: Y.Map<unknown>): DocxBlock {
  if (m.get('type') === 'raw') return { kind: 'raw', xml: m.get('rawXml') as string };
  const runs = (m.get('runs') as Y.Array<Y.Map<unknown>>).toArray().map(readRun);
  return { kind: 'paragraph', properties_xml: (m.get('propsXml') as string | null) ?? null, inlines: runs };
}

function readRun(m: Y.Map<unknown>): DocxInline {
  const kind = m.get('kind') as 'text' | 'ins' | 'del';
  const text = (m.get('text') as Y.Text).toString();
  const propsXml = (m.get('propsXml') as string | null) ?? null;
  if (kind === 'ins' || kind === 'del') {
    return { kind, meta: { id: '', author: m.get('author') as string, date: m.get('date') as string },
      runs: [{ text, preserve_space: false, properties_xml: propsXml }] };
  }
  return { kind: 'run', text, preserve_space: (m.get('preserveSpace') as boolean) ?? false, properties_xml: propsXml };
}
```

> `meta.id` is intentionally emitted empty here — keepance-docx re-allocates `w:id` at serialize (single-writer, Task 12). If the real `DocxInline` requires a non-empty id pre-serialize, emit a stable placeholder and confirm serialize overwrites it.

- [ ] **Step 4: Run green.** `npm run test -- tests/unit/coedit/docCrdt.roundtrip.test.ts` → PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(coedit): docCrdt Y.Doc <-> DocumentJson converters with round-trip test"`

---

### Task 2: textDiff — minimal old→new text into Y.Text ops (Fork 2, R2)

**Files:**
- Create: `src/modules/coedit/textDiff.ts`
- Test: `tests/unit/coedit/textDiff.test.ts`

A run edit replaces a run's whole text string; we must turn that into minimal `Y.Text` insert/delete ops so concurrent same-run edits converge character-level (not last-write-wins on the whole run).

- [ ] **Step 1: Write the failing tests** (common-prefix/suffix diff → one delete + one insert at the divergence point; covers insert, delete, replace, append, prepend, no-op, full-replace):

```ts
// tests/unit/coedit/textDiff.test.ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyTextDiff } from '@/modules/coedit/textDiff';

function run(oldText: string, newText: string): string {
  const doc = new Y.Doc();
  const t = doc.getText('t');
  t.insert(0, oldText);
  applyTextDiff(doc, t, oldText, newText);
  return t.toString();
}

describe('applyTextDiff', () => {
  it('converges to newText for insert/delete/replace/append/prepend/noop', () => {
    for (const [a, b] of [
      ['hello', 'hello world'],  // append
      ['hello', 'hi'],           // replace tail
      ['world', 'hello world'],  // prepend
      ['abcdef', 'abXYef'],      // middle replace
      ['abc', 'abc'],            // no-op
      ['abc', ''],               // full delete
      ['', 'abc'],               // full insert
      ['the quick fox', 'the slow fox'], // middle word
    ]) {
      expect(run(a, b)).toBe(b);
    }
  });

  it('a no-op edit produces no Y.Text change (no new update)', () => {
    const doc = new Y.Doc();
    const t = doc.getText('t'); t.insert(0, 'abc');
    let updates = 0; doc.on('update', () => { updates++; });
    applyTextDiff(doc, t, 'abc', 'abc');
    expect(updates).toBe(0);
  });

  it('two replicas editing different ends of the same text converge with both edits', () => {
    const base = new Y.Doc(); base.getText('t').insert(0, 'middle');
    const a = new Y.Doc(); Y.applyUpdate(a, Y.encodeStateAsUpdate(base));
    const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(base));
    applyTextDiff(a, a.getText('t'), 'middle', 'PREmiddle');   // a prepends
    applyTextDiff(b, b.getText('t'), 'middle', 'middlePOST');  // b appends
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getText('t').toString()).toBe(b.getText('t').toString());
    expect(a.getText('t').toString()).toContain('PRE');
    expect(a.getText('t').toString()).toContain('POST');
  });
});
```

- [ ] **Step 2: Run red.** `npm run test -- tests/unit/coedit/textDiff.test.ts` → FAIL.

- [ ] **Step 3: Implement `textDiff.ts`** (common prefix + suffix, one delete + one insert at the divergence; no-op when equal; do the ops inside a transaction so it's a single update):

```ts
import * as Y from 'yjs';

/** Apply the minimal edit turning `oldText` into `newText` onto `ytext`, as
 *  one delete + one insert at the first divergence point. No-op if equal. */
export function applyTextDiff(doc: Y.Doc, ytext: Y.Text, oldText: string, newText: string, origin?: unknown): void {
  if (oldText === newText) return;
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText[start] === newText[start]) start++;
  let endOld = oldText.length, endNew = newText.length;
  while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) { endOld--; endNew--; }
  const deleteLen = endOld - start;
  const insertStr = newText.slice(start, endNew);
  const fn = () => {
    if (deleteLen > 0) ytext.delete(start, deleteLen);
    if (insertStr.length > 0) ytext.insert(start, insertStr);
  };
  if (origin !== undefined) doc.transact(fn, origin); else doc.transact(fn);
}
```

- [ ] **Step 4: Run green.** `npm run test -- tests/unit/coedit/textDiff.test.ts` → PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(coedit): minimal text-diff to Y.Text ops for character-level run convergence"`

---

### Task 3: docCrdt mutators (structural + tracked changes, author-stamped)

**Files:**
- Modify: `src/modules/coedit/docCrdt.ts`
- Test: `tests/unit/coedit/docCrdt.mutators.test.ts`

Adds the transactional editing API the editor calls, each stamped with the author origin.

- [ ] **Step 1: Write the failing tests** for: `appendParagraph(ydoc, author) -> blockId`, `insertRun(ydoc, blockId, index, text, author)`, `editRunText(ydoc, blockId, runId, oldText, newText, author)` (uses applyTextDiff), `deleteBlock(ydoc, blockId, author)`, `splitParagraph(ydoc, blockId, runId, offset, author)`, `addTrackedInsertion(ydoc, blockId, text, author)`, `addTrackedDeletion(ydoc, blockId, runId, author)`, `resolveRevision(ydoc, blockId, runId, action, author)` (`action: 'accept'|'reject'`). Assert each mutates the tree correctly AND that `txn.origin` equals the author (observe one update, check origin). Assert accept-insertion turns an `ins` run into a `text` run; reject-insertion removes it; accept-deletion removes the `del` run; reject-deletion turns it back to `text`.

```ts
// tests/unit/coedit/docCrdt.mutators.test.ts (representative assertions)
import { describe, it, expect } from 'vitest';
import { documentJsonToYDoc, yDocToDocumentJson, appendParagraph, editRunText, addTrackedInsertion, resolveRevision } from '@/modules/coedit/docCrdt';

const EMPTY = { format_version: 1, body: [{ kind: 'paragraph', properties_xml: null, inlines: [{ kind: 'run', text: 'start', preserve_space: false, properties_xml: null }] }], comments: {} };

it('appendParagraph stamps the author origin and adds a block', () => {
  const ydoc = documentJsonToYDoc(EMPTY as any);
  let origin: unknown;
  ydoc.on('update', (_u, o) => { origin = o; });
  const id = appendParagraph(ydoc, 'attorney-a');
  expect(typeof id).toBe('string');
  expect(origin).toBe('attorney-a');
  expect(yDocToDocumentJson(ydoc).body.length).toBe(2);
});

it('accept on a tracked insertion converts it to a plain run', () => {
  const ydoc = documentJsonToYDoc(EMPTY as any);
  const blockId = (ydoc.getArray('body').get(0) as any).get('id');
  const runId = addTrackedInsertion(ydoc, blockId, 'newtext', 'attorney-a');
  resolveRevision(ydoc, blockId, runId, 'accept', 'attorney-b');
  const para = yDocToDocumentJson(ydoc).body[0] as any;
  const accepted = para.inlines.find((r: any) => r.kind === 'run' && r.text === 'newtext');
  expect(accepted).toBeTruthy();
});
```

- [ ] **Step 2: Run red.** `npm run test -- tests/unit/coedit/docCrdt.mutators.test.ts` → FAIL.

- [ ] **Step 3: Implement the mutators** in `docCrdt.ts`. Each opens `ydoc.transact(fn, author)`. Helpers to find a block/run `Y.Map` by id (scan `body`/`runs`). `editRunText` calls `applyTextDiff(ydoc, runMap.get('text'), oldText, newText, author)`. `addTrackedInsertion` pushes a run map `{ kind:'ins', author, date: new Date().toISOString(), text }` — **NOTE:** `new Date()` is fine in app code (only forbidden in workflow scripts). `resolveRevision('accept')` on an `ins` sets `kind='text'` and removes author/date; on a `del` removes the run; `'reject'` on `ins` removes the run; on `del` sets `kind='text'`. Export them all.

- [ ] **Step 4: Run green + tsc.** `npm run test -- tests/unit/coedit/docCrdt.mutators.test.ts` → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(coedit): author-stamped structural + tracked-change mutators"`

---

### Task 4: Convergence suite — port the spike's p1–p5 to yjs docCrdt

**Files:**
- Test: `tests/unit/coedit/convergence.test.ts`

Re-prove the spike's 5 cases on the production yjs document CRDT. Sync via `Y.encodeStateAsUpdate`/`Y.encodeStateVector`/`Y.applyUpdate` (the same primitives the relay carries).

- [ ] **Step 1: Write the 5 tests** (a `syncPair(a,b)` helper exchanges diffs both ways). Each mirrors the spike assertion:
  - `p1_join_replays_identical_state`: build doc A, edit; B joins from `Y.encodeStateAsUpdate(A)`; `yDocToDocumentJson(A)` deep-equals `yDocToDocumentJson(B)`.
  - `p2_concurrent_same_run_edit_no_data_loss`: A and B both start from a shared base, edit the SAME run's text at different positions offline (via `editRunText`), sync, converge with both edits present.
  - `p3_concurrent_structural_inserts_converge`: A and B each `appendParagraph` offline, sync, both paragraphs present in a consistent order on both.
  - `p4_tracked_changes_attribution_survives`: A `addTrackedInsertion` (author a), B `addTrackedDeletion` (author b) offline, sync, both present with their authors intact.
  - `p5_commutative_idempotent`: collect A's + B's update bytes, apply to a fresh C in a shuffled order, twice; C converges to the same `yDocToDocumentJson` as A after sync; no duplicated edits.

```ts
// helper
function syncPair(a: Y.Doc, b: Y.Doc) {
  const ua = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const ub = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, ua); Y.applyUpdate(a, ub);
}
```

- [ ] **Step 2: Run red, then green.** These exercise Tasks 1–3 (no new src). If a case fails, the bug is in the converters/mutators — fix THERE (don't weaken the test). `npm run test -- tests/unit/coedit/convergence.test.ts` → all 5 PASS.
- [ ] **Step 3: Commit.** `git add -A && git commit -m "test(coedit): convergence suite p1-p5 (spike cases) on the production yjs CRDT"`

---

### Task 5: Chaos + offline-matrix + w:id-intent tests

**Files:**
- Test: `tests/unit/coedit/chaos.test.ts`, `tests/unit/coedit/offline.test.ts`

- [ ] **Step 1: Chaos test** — produce N update blobs from concurrent edits on A+B; apply them to a fresh doc in a randomized order WITH duplicates and assert convergence to the same `yDocToDocumentJson` as the in-order result (idempotent + commutative). Use a fixed seed list of permutations (no `Math.random` — enumerate a few permutations + a duplicated-update case explicitly).
- [ ] **Step 2: Offline matrix** — for the combinations {text edit, structural insert, tracked change} × {A then B, B then A}: both edit offline, exchange, assert no data loss + attribution intact + identical converged JSON on both.
- [ ] **Step 3: w:id-intent** — assert `yDocToDocumentJson` emits tracked runs with empty/placeholder `meta.id` (so serialize is the single allocator); a small assertion documenting the contract Task 12 relies on.
- [ ] **Step 4: Run green + commit.** `git add -A && git commit -m "test(coedit): chaos, offline-reconnect matrix, w:id allocation intent"`

---

### Task 6: Relay — `doc_id` stream partitioning (backend)

**Files:**
- Modify: `backend/src/lib/db.ts` (matter_updates schema + helpers), `backend/src/lib/matters.ts` (FanoutHub), `backend/src/routes/matters.ts` (push/pull/ticket/ws), `backend/src/contract.ts`
- Test: `backend/test/sync-relay.test.ts` (extend)

- [ ] **Step 1: Write failing tests** (extend the relay suite): pushing with `doc_id: 'docA'` and `doc_id: 'docB'` keeps separate cursors; a pull with `doc_id: 'docA'` returns only docA blobs; absent `doc_id` defaults to `_notes` (the existing notes tests still pass unchanged); the idempotency unique key is per `(matter_id, doc_id, blob_id)`; WS fan-out delivers only the subscribed doc's frames.
- [ ] **Step 2: Run red.** `cd backend && bun test test/sync-relay.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Add `doc_id TEXT NOT NULL DEFAULT '_notes'` to the `matter_updates` CREATE TABLE (idempotent — new column on a fresh DB; for the in-memory test DB no migration needed; add an `ALTER TABLE ... ADD COLUMN` guarded by a "column exists" check in the Store init for production DBs that predate this). Change the unique index to `(matter_id, doc_id, blob_id)` and the order index to `(matter_id, doc_id, id)`. Thread `doc_id` (default `_notes`) through `appendMatterUpdate`, `getMatterUpdatesSince`, `latestMatterCursor`. `FanoutHub` keys channels by `${matter_id}::${doc_id}`. `handlePushUpdate` reads `body.doc_id ?? '_notes'`, stores + broadcasts on that channel; `handlePullUpdates` reads `?doc_id=` (default `_notes`); the WS sync subscribes to one `(matter, doc)` (carry `doc_id` on the sync-ticket or the subscribe). Add `doc_id?` to `PushUpdateRequest`, `PulledUpdate`, `SyncUpdateFrame`, the pull query, and the ticket in `backend/src/contract.ts`.
- [ ] **Step 4: Run green + full backend suite.** `cd backend && bun test` → all green (the existing notes/relay tests must stay green with `_notes` defaulting).
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(coedit): relay doc_id stream partitioning (notes default _notes, back-compat)"`

---

### Task 7: Client contract + FirmApiClient + MatterSyncClient doc_id

**Files:**
- Modify: `src/modules/firm/contract.ts` (mirror Task 6 doc_id fields), `src/modules/firm/FirmApiClient.ts` (doc_id on `pushUpdate`/`pullUpdates`/`createSyncTicket`), `src/modules/firm/MatterSyncClient.ts` (accept an optional `docId`, default `_notes`; thread it through push/pull/ticket/ws)
- Test: `tests/unit/firm/matterSync.test.ts` (extend — a docId-scoped client only sees its stream)

- [ ] **Step 1: Write a failing test** that two `MatterSyncClient`s on the SAME matter but DIFFERENT docIds do not receive each other's updates (using the existing mock relay in that test file). 
- [ ] **Step 2: Run red, implement, green.** Mirror the doc_id contract fields; add an optional `docId` ctor/opts param to `MatterSyncClient` (default `_notes` so the notes path is unchanged); thread into the FirmApiClient calls. Keep the existing notes tests green.
- [ ] **Step 3: tsc + commit.** `npx tsc --noEmit` clean. `git add -A && git commit -m "feat(coedit): doc_id through client contract, FirmApiClient, MatterSyncClient"`

---

### Task 8: MatterDocSyncClient — doc-scoped E2EE transport

**Files:**
- Create: `src/modules/coedit/MatterDocSyncClient.ts`
- Test: `tests/unit/coedit/matterDocSync.test.ts`

- [ ] **Step 1: Write a failing two-client integration test** (mirroring `matterSync.test.ts`): two `MatterDocSyncClient`s for the same `(matter, docId)` over a mock relay, each wrapping a `Y.Doc` built by `documentJsonToYDoc`; an `editRunText` on client A propagates (encrypted) to client B and both `yDocToDocumentJson` converge; an update for a DIFFERENT docId is not applied.
- [ ] **Step 2: Run red, implement.** `MatterDocSyncClient` reuses `MatterSyncClient` (now docId-aware from Task 7) OR composes its internals: it takes `{ matterId, docId, doc: Y.Doc, getKey, getEpoch }`, wires the local `doc.on('update', ...)` → `encryptUpdate` → push (skip the remote-origin sentinel), and incoming frames → `decryptUpdate` → `Y.applyUpdate(doc, update, remoteOrigin)`. Reuse `matterCrypto` + `matterKeyService` verbatim (same per-matter key + epoch; co-editing blobs ride the same key). Prefer composing `MatterSyncClient` with `docId` to avoid duplicating the transport.
- [ ] **Step 3: Green + tsc + commit.** `git add -A && git commit -m "feat(coedit): MatterDocSyncClient doc-scoped E2EE transport reusing matter key"`

---

### Task 9: coeditSession — lifecycle (open/join/seed/save/close) singleton

**Files:**
- Create: `src/modules/coedit/coeditSession.ts`
- Test: `tests/unit/coedit/coeditSession.test.ts`

- [ ] **Step 1: Write failing tests** for: `openCoeditSession(matterId, docId, fileName, initialJson)` returns a session with a live `Y.Doc`; if the relay already has state it JOINS (the relay state wins, local `initialJson` is NOT seeded over it); if empty it SEEDS from `initialJson`; a `clientCache`/`pendingCache` singleton-per-`(matter,doc)` (mirroring `matterNotesSync.ts`) returns the same session for concurrent opens (React StrictMode guard); `getDocumentJson()` returns the current converged JSON; `onChange(cb)` fires on local+remote updates; `close()` snapshots + tears down.
- [ ] **Step 2: Run red, implement** mirroring `matterNotesSync.ts`'s `ensureMatterSync` (cache + promise-singleton). Seed-vs-join: after the sync client's catch-up, if the doc's `body` is empty AND `initialJson` is provided, seed it inside a transaction; otherwise the relay state is authoritative.
- [ ] **Step 3: Green + tsc + commit.** `git add -A && git commit -m "feat(coedit): coeditSession lifecycle singleton (join-or-seed, snapshot-on-close)"`

---

### Task 10: DocxEditor co-edit integration

**Files:**
- Modify: `src/components/media/DocxEditor.tsx`
- Test: `tests/unit/coedit/DocxEditor.coedit.test.tsx`

- [ ] **Step 1: Write a failing test** — render `DocxEditor` with a co-edit context (mock `coeditSession` exposing a `Y.Doc` + `getDocumentJson` + `onChange`); a remote CRDT change calls the editor's render path (the doc updates on screen); a local run edit calls `editRunText` on the session (assert via the mocked session) instead of the solo `docx_author_revisions`. Mock the session + Tauri commands; mirror existing DocxEditor tests' setup.
- [ ] **Step 2: Run red, implement.** Add a `coedit?: { session: CoeditSession }` prop/context. When present:
  - On mount: render from `session.getDocumentJson()` instead of `docx_open` alone (still `docx_open` to get the original package handle for save, but the live tree comes from the session).
  - `session.onChange(() => applyResolvedDocument(session.getDocumentJson(), false))` — remote + local updates re-render through the existing choke point (save=false; autosave handles disk).
  - `handleRunEdit` → `session.editRunText(blockId, runId, oldText, newText, authorName)` (instead of in-place mutate / `docx_author_revisions`); tracked mode → `session.addTrackedInsertion/Deletion`; accept/reject → `session.resolveRevision`.
  - Autosave debounce → `docx_save(path, session.getDocumentJson())` (single-writer serialize; keeps the original package).
  - When `coedit` is absent, behavior is 100% unchanged (solo path).
- [ ] **Step 3: Green + tsc + the existing DocxEditor tests stay green + commit.** `git add -A && git commit -m "feat(coedit): DocxEditor live co-editing through coeditSession (solo path unchanged)"`

---

### Task 11: Basic presence (awareness) — best-effort

**Files:**
- Create: `src/modules/coedit/presence.ts`
- Modify: `src/components/media/DocxEditor.tsx` (render remote carets/names)
- Test: `tests/unit/coedit/presence.test.ts`

- [ ] **Step 1: Write a failing test** — a `PresenceChannel` over a mock ephemeral transport broadcasts `{ author, caret }` and surfaces other participants; local state updates don't echo to self. Use `y-protocols/awareness` (`Awareness`) if present in deps; else a tiny custom ephemeral map (do NOT persist).
- [ ] **Step 2: Run red, implement.** `presence.ts` wraps `Awareness` (or the minimal map) carried on a separate ephemeral channel (a `presence` doc_id stream that is NEVER persisted as document state — or the WS awareness sub-protocol). Render remote carets/names in `DocxEditor` (subtle, light theme). **If awareness wiring proves heavy, ship v1 WITHOUT live carets** — surface only a "N people editing" indicator from the relay's subscriber count, and note live carets as a fast-follow. Keep the core co-editing unaffected.
- [ ] **Step 3: Green + tsc + commit.** `git add -A && git commit -m "feat(coedit): basic presence (names + caret, best-effort)"`

---

### Task 12: Fidelity gate + w:id single-writer allocation

**Files:**
- Test: `tests/unit/coedit/fidelity.test.ts` (TS) and/or `src-tauri/crates/keepance-docx/tests/coedit_fidelity.rs` (Rust)
- Modify (only if needed): `src-tauri/crates/keepance-docx/src/serialize.rs` / `author.rs`

- [ ] **Step 1: Verify w:id allocation.** Read `keepance-docx` serialize + `Document::max_revision_id()`. Write a Rust test: a `Document` with two tracked insertions whose `meta.id` are EMPTY/placeholder serializes to `w:ins` elements with DISTINCT, valid `w:id`s. If serialize already allocates from `max_revision_id()+1` when ids are empty, the property holds — assert it. If NOT (it writes empty ids verbatim), add a single-writer allocator pass in serialize that assigns fresh sequential `w:id`s to any revision with an empty/placeholder id. TDD this.
- [ ] **Step 2: Fidelity round-trip test (TS).** Take a converged co-edited `Y.Doc` (build via the converters + a few concurrent edits synced), `yDocToDocumentJson`, then `docx_save`→re-`docx_open` (or call the Rust serialize/parse directly via a fixture test): assert the modeled tree is identical and unmodeled parts are byte-for-byte preserved (reuse the keepance-docx roundtrip harness pattern). Assert every tracked revision has a unique `w:id` after serialize.
- [ ] **Step 3: Green + commit.** `cd src-tauri && cargo test -p keepance-docx` green; TS green. `git add -A && git commit -m "test(coedit): fidelity gate + w:id single-writer uniqueness under concurrency"`

---

### Task 13: Full verification + changelog + strategy tick

**Files:**
- Modify: `CHANGELOG.md`, `docs/strategy/2026-06-10-vision-gap-closure-plan.md` (VG-8 STATUS)

- [ ] **Step 1:** Full suites: `npm run test` (client) green; `cd backend && bun test` green; `cd src-tauri && cargo test` green; `npx tsc --noEmit` clean; `npx eslint src/modules/coedit/` → no new errors.
- [ ] **Step 2:** `CHANGELOG.md` `[Unreleased] › Added` entry (plain language, NO em dashes, Jameson's voice): live multi-user Word co-editing for firm matters — same open document, live merge, offline-then-reconnect, tracked-change attribution survives concurrent edits, relay stores only E2EE blobs; list the key files. If new i18n strings were added in DocxEditor/presence, i18n them (en/de/es) + update the i18n snapshot test (NO em dashes).
- [ ] **Step 3:** Add the VG-8 STATUS line to the gap-closure plan (done, the 5 convergence cases + fidelity + chaos + offline green; real-Word spot check is Jameson's). Note: the real-Microsoft-Word open-without-repair fidelity check + a 2-attorney live session are Jameson's native items.
- [ ] **Step 4: Commit + push.** `git add -A && git commit -m "chore(coedit): full suites green + changelog + VG-8 status"` and push `keepance-3.0`.

---

## Self-Review

**Spec coverage:** §5 model (T1) · §6 converters + mutators (T1,T3) + textDiff (T2) · §7 open/save join-or-seed (T9,T10) · §8 transport (T8) · §9 relay doc_id (T6) + client (T7) · §10 editor (T10) · §11 convergence (T4) · §12 verification: convergence (T4), chaos/offline (T5), fidelity + w:id (T12), relay regression (T6) · §13 structure (all) · presence (T11) · risks R1 (T1+T12), R2 (T2), R3 (T12), R4 (T9 snapshot-on-close), R5 (T6 backfill), R6 (T11 best-effort). No gaps.

**Placeholder scan:** the converters, textDiff, mutators, convergence, relay, and transport carry full code/tests. The editor + presence + lifecycle tasks give exact files + interfaces + real test intents + integration points (DocxEditor's `applyResolvedDocument` choke point, `matterNotesSync.ts` cache pattern) with code where novel and "mirror the existing pattern" where one exists (per writing-plans for existing codebases). The two verify-then-maybe-change caveats (real DocumentJson field names in T1; whether keepance-docx already allocates w:id in T12) are explicit verify steps, not placeholders.

**Type consistency:** `documentJsonToYDoc`/`yDocToDocumentJson` (T1) reused in T3,T4,T5,T8,T9,T12; `applyTextDiff` (T2) used by `editRunText` (T3); the mutator names (`appendParagraph`/`insertRun`/`editRunText`/`deleteBlock`/`splitParagraph`/`addTrackedInsertion`/`addTrackedDeletion`/`resolveRevision`) are consistent T3→T8→T10; `doc_id`/`_notes` consistent across T6,T7,T8; `MatterDocSyncClient`/`coeditSession` names consistent T8→T9→T10.

## Execution note
Per the model policy this is the **xhigh** build: Sonnet implements each task; **Opus reviews EVERY diff** (data-integrity-sensitive); the convergence (T4), chaos/offline (T5), and fidelity (T12) tests are the hard gates. Build the converters + convergence (T1–T5) before any transport/editor work — they are the heart, and a convergence failure means a converter bug, fixed there.

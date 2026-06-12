# Live Multi-User .docx Co-Editing (VG-8) — Design Spec

**Date:** 2026-06-12 · **Wave:** 4 · **Status:** approved direction (Jameson, 2026-06-12) · **Effort tier:** xhigh (largest single build, data-integrity-sensitive) · **Plan of record:** `docs/strategy/2026-06-10-vision-gap-closure-plan.md` (VG-8)

> **Design of record for the CRDT model:** `spikes/firm-sync/DECISION.md` (GO; 5/5 convergence proven). This spec does NOT relitigate that — it settles how the proven model is **productionized** into the existing TS/yjs transport, the Rust OOXML engine, and the contenteditable editor.

---

## 1. Goal

Two or more firm members can edit the **same open `.docx`** at the same time and see each other's changes live, with no data loss, full offline-then-merge, and tracked-change attribution that survives concurrent edits. The relay only ever stores end-to-end-encrypted, opaque update blobs. Solo behavior is unchanged. This extends the existing live shared-matter-**notes** collaboration from notes to the Word document tree.

## 2. Architecture (one paragraph)

The structured document tree itself is the CRDT (a **yjs `Y.Doc`**), exactly as the spike proved in yrs (yjs is the wire-compatible original; the model ports directly). While a document is open, the converged `Y.Doc` is the live source of truth; the editor renders from it and writes edits into it. Concurrent edits converge by construction. On save we serialize the converged tree back to `.docx` through the in-house `keepance-docx` Rust engine, which preserves every unmodeled part (styles, numbering, headers, media, comments, raw XML) byte-for-byte. Updates sync as E2EE blobs over the **existing matter relay** (a dumb pipe that stores ciphertext only), reusing the **same per-matter key + epoch** as notes. The relay gains per-document partitioning (`doc_id`) so each document is its own cursor stream.

```
 DocxEditor (contenteditable per run)
      │  local edit → text-diff/structural op
      ▼
 docCrdt (Y.Doc)  ◄── remote update (decrypted) ── MatterDocSyncClient
      │  observe                                         │  encryptUpdate/pull/ws
      ▼                                                  ▼
 DocumentJson  ──save──► keepance-docx (Rust)      matter relay (doc_id stream, opaque ciphertext)
      ▲  open                serialize → .docx
      └───────── document_to_json / from_json ──────────┘
```

## 3. Non-goals (v1 — YAGNI)

- **Comments co-editing** — comments round-trip untouched via keepance-docx but are not live-co-edited in v1.
- **A ProseMirror/CodeMirror editor rewrite** — we bind the existing contenteditable-per-run editor (Fork 2). A richer editor is a future option.
- **CRDT GC/compaction tuning** beyond a snapshot-on-close (the doc rebuilds from relay catch-up on open; basic `Y.encodeStateAsUpdate` snapshot is enough for v1).
- **Co-editing raw/unknown blocks** — they ride as opaque ordered placeholders (structure preserved, content not character-merged).
- **Web/browser build** — co-editing is desktop (Tauri) + firm-tier only.
- **Cross-document or cross-matter editing**; live cursors beyond basic presence.

## 4. Decisions (the three forks — approved 2026-06-12)

1. **yjs (TypeScript) for the live document CRDT**, not yrs (Rust). Reuses the existing transport (`MatterSyncClient`), relay client, and editor (all TS/yjs); keepance-docx (Rust) stays the open/save serialization authority; the Rust↔TS boundary stays only at open/save. The spike's yrs proof transfers (same `Map`/`Array`/`Text` types; wire-compatible).
2. **Editor binding via per-run text-diff.** Keep contenteditable-per-run; on a run edit, diff old vs new text into `Y.Text` insert/delete ops at positions (character-level convergence) instead of replacing the whole run text. Structural edits map to `Y.Array` ops.
3. **Relay partitioning by `doc_id`.** Each co-edited document is its own cursor stream within a matter; notes become a reserved `_notes` doc_id.

## 5. The document-CRDT model (yjs)

```
Y.Doc
  meta : Y.Map           { matterId, docId, fileName, formatVersion }
  body : Y.Array<Y.Map>  ordered blocks
    block (paragraph) Y.Map:
      id       : string (uuid, stable identity)
      type     : 'paragraph' | 'raw'
      propsXml : string | null        (unmodeled w:pPr, preserved verbatim)
      runs     : Y.Array<Y.Map>       (only for type 'paragraph')
      rawXml   : string | null        (only for type 'raw' — opaque, not co-edited)
    run Y.Map:
      id       : string (uuid)
      kind     : 'text' | 'ins' | 'del'
      text     : Y.Text               (character-level CRDT body)
      author   : string | undefined   (ins/del only — immutable scalar, set once)
      date     : string | undefined   (ins/del only)
      propsXml : string | null        (unmodeled w:rPr, preserved verbatim)
```

Mirrors the spike's tree (`body: Array<Map>`, runs `Array<Map>`, text `Y.Text`, kind/author/date on the run) and the `keepance-docx` `Document` model (Paragraph → Inline::{Run, Insertion, Deletion}). Comments, the original package, and non-paragraph blocks beyond `raw` are NOT in the CRDT — keepance-docx preserves them at save. `author`/`date` are written once by the authoring replica and never mutated, so a concurrent merge cannot clobber attribution (spike p4).

## 6. The two converters (the heart of the integration)

A new TS module **`src/modules/coedit/docCrdt.ts`** owns the bidirectional mapping, with NO transport or UI concerns:

- `documentJsonToYDoc(doc: DocumentJson): Y.Doc` — build the CRDT tree from the engine's JSON (used to seed a brand-new document CRDT from an opened `.docx`).
- `yDocToDocumentJson(ydoc: Y.Doc): DocumentJson` — read the converged tree back to engine JSON (used at save and to render the editor).
- `applyRunTextEdit(ydoc, blockId, runId, oldText, newText)` — diff old→new and apply minimal `Y.Text` insert/delete ops (Fork 2).
- Structural mutators: `insertParagraph`, `deleteBlock`, `splitParagraph`, `insertRun`, `deleteRun`, `addTrackedInsertion`, `addTrackedDeletion`, `resolveRevision` — each a `Y.Doc` transaction stamped with the author origin (`doc.transact(fn, authorOrigin)`), the hook for the audit log + attribution.

**Determinism requirement:** `yDocToDocumentJson` must produce JSON that, fed to `keepance-docx` serialize, yields a valid `.docx`; and `documentJsonToYDoc → yDocToDocumentJson` must be a faithful round-trip for the modeled subset. This is the property the convergence + fidelity tests assert.

## 7. Open / save path

- **Open** (`DocxEditor` mount, firm matter, co-edit toggle on): `docx_open(path)` → `DocumentJson`. Then `MatterDocSyncClient.open(matterId, docId)`: catch up the relay's existing CRDT state for `(matterId, docId)`; if it exists, the converged relay state is authoritative (join it) and the local file seeds nothing; if no CRDT exists yet, seed the `Y.Doc` from the file's `DocumentJson` and become the first replica. The editor renders from `yDocToDocumentJson(ydoc)`.
- **Save** (existing autosave debounce, 1200ms): `yDocToDocumentJson(ydoc)` → `docx_save(path, doc)` (which uses `OpenedDocument.with_document(...).save_bytes()`, preserving the original package). **Single-writer at serialization:** only the local replica serializes its own view; `w:id`s for revisions are allocated here by keepance-docx from a monotonic counter, so concurrent authoring on other replicas can never mint colliding `w:id`s (DECISION R3). Saving is local and idempotent — every replica saves its converged view; the bytes converge because the tree converged.

**`docId` (decided):** a hex digest (e.g. SHA-256, truncated) of the document's **matter-relative file path**, also recorded in `meta.docId`. This needs no sidecar and makes reopening the same file deterministically rejoin its stream. Known v1 limitation: renaming/moving the file starts a fresh stream (the prior co-edit history is orphaned on the relay but the `.docx` itself — the real artifact — is unaffected). A rename-stable uuid sidecar is a noted fast-follow, not v1.

## 8. Transport — `MatterDocSyncClient`

A thin generalization of `MatterSyncClient` (or a sibling that reuses its internals) that takes a `docId` and a `Y.Doc`:
- Local `Y.Doc` `'update'` (origin ≠ remote sentinel) → `encryptUpdate(matterKey, update, epoch)` → `POST /matter/:id/updates` with `doc_id`.
- Catch up via `GET /matter/:id/updates?since=<cursor>&doc_id=<docId>`; live via the WS `sync` frames filtered to `doc_id`.
- Incoming blob → `decryptUpdate` → `Y.applyUpdate(ydoc, update, remoteOrigin)`.
- Reuses the **same** per-matter key + epoch + rotation path (`matterKeyService`, `matterCrypto`) — co-editing blobs and notes blobs share the matter key; only the `doc_id` stream differs. Epoch bump → re-fetch key → `rotateKey`, identical to notes.

## 9. Relay changes (backend)

- `matter_updates` table: add `doc_id TEXT NOT NULL DEFAULT '_notes'`; backfill existing rows to `_notes`; the unique idempotency index becomes `(matter_id, doc_id, blob_id)`; the ordering index `(matter_id, doc_id, id)`.
- `handlePushUpdate` reads `doc_id` (default `_notes`), stores it, broadcasts on the `(matter_id, doc_id)` channel.
- `handlePullUpdates` filters by `doc_id`; cursor is per `(matter_id, doc_id)`.
- `FanoutHub` keys subscriptions by `(matter_id, doc_id)`; the WS `sync` carries `doc_id` (subscribe to one doc per socket, or filter frames).
- Contract shapes (`backend/src/contract.ts` + client copy) gain `doc_id` on `PushUpdateRequest`, `PulledUpdate`, the pull query, `SyncUpdateFrame`, and the sync-ticket/subscribe. **Backward compatible:** absent `doc_id` ⇒ `_notes`, so the existing notes path is unchanged.
- Access control, walls, seat tokens, size cap, rate limits — all unchanged (per-matter, doc-agnostic).

## 10. Editor integration (`DocxEditor`)

- A `coedit` prop/context (matterId + docId) activates co-editing. When active: the editor's `applyResolvedDocument(doc, save)` choke point is fed by `yDocToDocumentJson` on every remote/local CRDT change (save=false for remote; the autosave handles disk).
- Local run edit (`handleRunEdit(blockIndex, inlineIndex, newText)`): instead of mutating `DocumentJson` directly, call `applyRunTextEdit(ydoc, blockId, runId, oldText, newText)`; the resulting `Y.Doc` update both syncs and re-renders via the observer. Tracked-change mode routes to `addTrackedInsertion`/`addTrackedDeletion` (CRDT mutations) rather than the Rust `docx_author_revisions` (which stays the solo path).
- Accept/reject a revision → `resolveRevision(ydoc, ...)` (a CRDT mutation that syncs), replacing the solo `docx_resolve_revision` while co-editing.
- **Basic presence:** Yjs awareness (author name + caret position) on an ephemeral channel over the WS; best-effort, never persisted, never authoritative. If the awareness wiring proves heavy, v1 ships without live carets and presence is a fast-follow (noted, not blocking).

## 11. Concurrency properties (proven by the spike; re-proven in yjs here)

- **p1 join replays identical state** — a late joiner catching up converges byte-identical.
- **p2 concurrent same-paragraph (same-run) edit, no data loss** — the per-run text-diff binding preserves both edits character-level.
- **p3 concurrent structural inserts converge** — two paragraphs inserted offline both present, consistent order.
- **p4 tracked changes ride the CRDT with attribution** — author/date immutable, survive a concurrent merge.
- **p5 commutative + idempotent, no coordinator** — updates applied in any order, twice, converge; each edit appears exactly once.

## 12. Verification (the rigor the overridden ship-gate protected — now mandatory)

1. **Convergence suite (TS, two-client):** ports the spike's p1–p5 to the production `docCrdt` + a simulated relay, in the existing matter-notes harness style.
2. **Fidelity gate:** a concurrently-edited converged `Y.Doc` → `yDocToDocumentJson` → keepance-docx serialize → re-open → asserts a clean round-trip (modeled content identical; unmodeled parts byte-for-byte). The **real-Microsoft-Word** open-without-repair check is Jameson's native spot item (cannot be coded).
3. **Chaos pass:** dropped, reordered, and replayed update blobs converge to the same state (idempotent/commutative) — a fuzz-style test over a permuted/duplicated update log.
4. **Offline-edit-then-reconnect matrix:** two replicas edit offline (text + structural + tracked), reconnect, converge with zero data loss and attribution intact.
5. **`w:id` uniqueness under concurrency:** after a concurrent authoring merge + serialize, every `w:ins`/`w:del` has a unique `w:id` (single-writer allocation holds).
6. **Relay regression:** the existing matter-notes sync suite (8/8) stays green with the `doc_id` change (notes = `_notes`).

## 13. Module / file structure

**New:**
- `src/modules/coedit/docCrdt.ts` — the `Y.Doc` ↔ `DocumentJson` converters + transactional mutators (§6). The integration's heart; keep it focused and pure (no transport/UI).
- `src/modules/coedit/MatterDocSyncClient.ts` — the doc-scoped transport (§8), reusing `MatterSyncClient` internals / `matterCrypto` / `matterKeyService`.
- `src/modules/coedit/coeditSession.ts` — lifecycle glue (open/join/seed/save/close, presence), the singleton-per-(matter,doc) manager (mirrors `matterNotesSync.ts`).
- `tests/unit/coedit/*` — convergence, chaos, offline, fidelity, w:id tests.

**Modified:**
- `backend/src/lib/db.ts` (doc_id column + indexes), `backend/src/routes/matters.ts` (push/pull/ticket/ws scoped by doc_id), `backend/src/lib/matters.ts` (FanoutHub keyed by (matter,doc)), `backend/src/contract.ts` + `src/modules/firm/contract.ts` (doc_id fields).
- `src/modules/firm/MatterSyncClient.ts` (accept a `docId`, or factor a shared core), `src/modules/firm/FirmApiClient.ts` (doc_id on push/pull/ticket).
- `src/components/media/DocxEditor.tsx` (co-edit activation + binding through `applyResolvedDocument` + the local-edit → CRDT path).
- `src-tauri/crates/keepance-docx/` — only if serialize needs a single-writer `w:id` allocator hook that isn't already present (verify; the model already carries `RevisionMeta.id` and `max_revision_id()`).

**Untouched:** the matter-notes editor + its sync (works through the same relay with `doc_id = _notes`), the vault, SSO, the assured backend.

## 14. Risks / watch-items

- **R1 yjs↔engine round-trip fidelity** — the converters must be loss-free for the modeled subset; raw/unmodeled parts must survive untouched. The fidelity gate is the guard. Mitigation: start the build TDD on the converters before any transport.
- **R2 editor binding granularity** — the per-run text-diff must produce correct `Y.Text` ops for inserts/deletes/replacements anywhere in a run; a naive whole-text replace loses concurrent merges. TDD the diff with adversarial cases.
- **R3 `w:id` collisions** — handled by single-writer allocation at serialize; the w:id-uniqueness test is the guard.
- **R4 CRDT growth** — long edit histories grow the `Y.Doc`; v1 mitigates with snapshot-on-close (rebuild from compact state on reopen). Compaction tuning is a deliberate non-goal for v1.
- **R5 relay migration** — the `doc_id` column add must backfill existing notes rows to `_notes` so live matters keep working; the relay regression suite is the guard.
- **R6 presence scope creep** — basic presence is best-effort; if awareness wiring is heavy it ships as a fast-follow without blocking the core co-editing.

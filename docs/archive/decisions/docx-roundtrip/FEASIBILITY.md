# Spike: In-house Word track-changes round-trip — FEASIBILITY REPORT

**Program gate:** Advisor Prep Hero 3.0 WS-A document engine.
**Question:** Can we faithfully round-trip Microsoft Word `.docx` files *with track
changes* — import a lawyer's redline, let the AI add its own tracked edits, export a
`.docx` the recipient opens in Word with every revision intact and individually
accept/reject-able — **fully in-house**, with no proprietary document SDK and no
cloud/SaaS service ever touching the document?

**Scope of this spike:** a bounded, TDD proof of the hardest 20% (tracked
insertions, tracked deletions, comments) so we can commit to the full build with
eyes open. It is a learning spike, not a product feature.

---

## (a) Verdict

**YES, with caveats.** Faithful in-house track-changes round-trip is achievable
using only generic, in-binary Rust crates (`zip` + `quick-xml`). This spike proves
the end-to-end loop for the three highest-value revision features:

- **Tracked insertions** (`w:ins`) — preserved and authorable. ✅
- **Tracked deletions** (`w:del` / `w:delText`) — preserved and authorable. ✅
- **Comments** (`comments.xml` + `commentRangeStart/End` + `commentReference`,
  with correct `[Content_Types].xml` and rels) — preserved with author/date/
  initials/text and a balanced anchor range. ✅

All three survive a parse → model → serialize round-trip with author, date, id, and
text intact; the document stays a structurally valid `.docx`; and a **new
`w:author="Advisor Prep Hero AI"` revision can be inserted alongside the originals**, each
revision keeping a unique `w:id` (which is how Word groups accept/reject).

**Independent confirmation (vendor-free):** `soffice` is not available here, so we
cannot open in Word/LibreOffice. Instead the produced files were cross-checked by
three independent parsers:
1. our own zip+XML reader (well-formedness, required parts, content-types/rels,
   schema-plausibility of revisions, balanced comment ranges, comment-ref
   resolution),
2. **Python `python-docx` + lxml** (a genuinely third-party OOXML reader) — opens
   both the fixture and the AI-authored file, reads the runs, and sees all
   `w:ins`/`w:del` with the right authors (`Opposing Counsel` + `Advisor Prep Hero AI`),
3. Python stdlib `minidom` pretty-print — confirms the byte structure matches what
   Word emits.

**Confidence level:** High that the package is structurally correct and that an
independent OOXML consumer parses the revisions and comments exactly as intended.
This does **not** verify Word's interactive accept/reject UI — that final
confirmation must happen on a real Microsoft Word instance with a design partner
(see risks). The structure produced is the canonical OOXML shape Word writes, so
the residual risk is low but non-zero.

---

## (b) Easy vs hard (OOXML revision features)

**Proven here (easy → moderate):**

| Feature | Markup | Status | Notes |
|---|---|---|---|
| Text insertion | `w:ins` wrapping runs | **Easy** | Wrapper element; round-trips cleanly. |
| Text deletion | `w:del` + `w:delText` | **Easy** | Same shape; text moves from `w:t` to `w:delText`. The only gotcha is using `delText` (not `t`) inside `del` — our validator enforces this. |
| Comments | `comments.xml` + range markers + reference + rels | **Moderate** | Spread across a separate part + two manifests; the work is plumbing, not algorithm. Comment *replies/resolution* (`commentsExtended.xml`, Word 2013+) is an extra part we did not exercise. |

**Not exercised here, expected difficulty for the full build:**

| Feature | Markup | Expected difficulty | Why |
|---|---|---|---|
| Formatting-change revisions | `w:rPrChange`, `w:pPrChange` | **Moderate** | These nest the *previous* run/paragraph props inside the change element. Needs a real run/paragraph-properties model (which the spike intentionally skips). Mechanically similar to ins/del once props are modeled. |
| Moves | `w:moveFrom` / `w:moveTo` (+ `moveFromRangeStart/End`, `moveToRangeStart/End`) | **Hard** | A move is a *paired* revision tied by a move-name across two locations; both sides must be emitted consistently and matched on accept/reject. Pairing + range bracketing is the tricky part. Fallback: many tools (and Word, when "track moves" is off) degrade a move to a delete+insert — acceptable v1 behavior. |
| Paragraph-mark revisions | `w:rPr/w:ins` or `w:del` inside `w:pPr` (the paragraph mark itself inserted/deleted) | **Hard-ish** | This is how Word tracks "merged/split paragraphs." Easy to drop accidentally; needs the paragraph-properties model and careful handling so paragraph boundaries accept/reject correctly. |
| Tables | `w:tbl/w:tr/w:tc` + `w:trPr` row revisions (`w:ins`/`w:del` on rows), `w:tblPrChange` | **Hard** | Tables are a whole sub-grammar; tracked row insert/delete and cell changes add another layer. Highest-effort structural item. |
| Numbering / lists | `numbering.xml` + `w:numPr` | **Moderate** | A separate part to preserve verbatim; revisions on list membership are uncommon but list *rendering* fidelity matters for lawyers. |
| Styles | `styles.xml` + `w:rStyle`/`w:pStyle` | **Moderate** | Must be preserved verbatim (we reference `CommentReference` style but do not author a styles part). Critical for visual fidelity, low algorithmic risk. |

**Headline:** insertions, deletions, and comments — the daily bread of legal
redlining — are the *easy* end and are now proven. The genuinely hard items are
**moves, paragraph-mark revisions, and tracked tables.** None are blockers; all are
scoped, incremental work on top of the same parse/serialize spine.

---

## (c) Recommended crates + engine design for WS-A

**Crates (all generic, compiled into our binary — no SDK, no service):**

- **`zip`** — OOXML package (it's just a ZIP of XML). Read + write, deflate.
- **`quick-xml`** — streaming XML reader/writer. The reader preserves revision
  markup; the writer gives correct escaping and deterministic output for free.
  (`roxmltree` is a fine read-only alternative but is DOM/read-only; we need to
  write, so `quick-xml` covers both with one dependency.)
- **`serde` / `serde_json`** — already in the tree; serialize the in-memory model
  to JSON for the React editor bridge.
- **`uuid`** — fresh, non-colliding `w:id`s for AI-authored revisions.
- **`chrono`** — `w:date` timestamps.

**Design — DOM model, not streaming.** Recommend a **document object model** held in
memory (this spike's `model.rs`), not a streaming transform. Rationale:

1. **The editor needs random access.** Rendering an inline insertion/deletion and
   wiring an "accept/reject this revision" button is trivial against typed nodes
   (`Inline::Insertion { meta, runs }`) and painful against a token stream or a
   "string + ranges" model.
2. **The AI authors by manipulating nodes.** `ai_insert_at_paragraph_end` /
   `ai_delete_run_containing` in this spike show the ergonomic win: locate text in
   the typed tree, swap a `Run` for a `Deletion`, append an `Insertion`. Accept/
   reject is then "drop the `w:del` wrapper / unwrap the `w:ins`."
3. **Round-trip fidelity is easier to reason about** with explicit nodes than with
   ad-hoc string surgery on XML.

**Representation for the React editor + AI:**

- Keep the Rust `Document` model as the source of truth. Expose it to the frontend
  as JSON (a tree of paragraphs → inlines, with revision/comment nodes as tagged
  variants). The editor renders `Insertion`/`Deletion` inline (green underline /
  red strikethrough) and shows comment anchors; "final" vs "show markup" views are
  just two render passes over the same tree.
- **Preserve-by-default for everything we don't model yet.** The single most
  important fidelity rule for the real build: *keep the original parts and unknown
  elements verbatim and re-emit them untouched.* This spike hand-authors the
  plumbing parts; the production engine must instead (a) keep every original part
  (`styles.xml`, `theme1.xml`, `settings.xml`, fonts, media, headers/footers) and
  write them back byte-for-byte, and (b) within `document.xml`, pass through
  unrecognized elements rather than dropping them. That converts "did we model
  feature X?" from a data-loss risk into a render-fidelity nice-to-have.
- **Stable revision ids.** `max_revision_id() + 1` here; production should use a
  monotonically-allocated counter seeded from the imported doc so AI edits never
  collide with existing or each other's ids.

**Where it lands:** the proven code maps directly onto
`src-tauri/src/commands/docx/` — `package.rs` (zip), `parse.rs`, `serialize.rs`,
`model.rs`, plus a Tauri command surface (`import_docx`, `export_docx`,
`accept_revision`, `reject_revision`, `author_revision`). No change to the crate
choices needed when it moves.

---

## (d) Top risks for the full build + mitigations

1. **"Opens in Word but a revision is subtly wrong" (the real gate).** Our
   validation is vendor-free; only Word can confirm accept/reject behaves.
   *Mitigate:* a Word-on-Windows fixture-diff harness in CI (round-trip a corpus,
   open in real Word via automation or a design-partner checklist), and lead the
   design-partner program with redline-heavy real documents.
2. **Lossy passthrough → silent data loss.** Dropping an unmodeled part/element
   loses content the lawyer can't see is gone — unacceptable in legal work.
   *Mitigate:* preserve-by-default architecture (keep originals verbatim; pass
   through unknown elements); add a round-trip "no-op import/export must be
   byte-stable modulo normalization" test on a large real-doc corpus.
3. **Moves + paragraph-mark + table revisions are genuinely hard.**
   *Mitigate:* phase them. v1 = ins/del/comments/formatting (rPrChange) faithfully;
   degrade moves to delete+insert if needed; add tables + paragraph-mark revisions
   in a fast-follow with their own fixtures.
4. **OOXML is huge and quirky** (namespace prefixes vary, `mc:AlternateContent`,
   vendor extensions, malformed-but-Word-tolerated files).
   *Mitigate:* match on local names (done here), be liberal on input / strict on
   output, and build the corpus from *real* opposing-counsel documents, not
   synthetic ones.
5. **Whitespace / encoding fidelity.** Lost `xml:space="preserve"` or mangled
   entities corrupt legal text. *Mitigate:* preserve whitespace verbatim (done) and
   rely on the XML writer's escaping (done); keep the idempotence test.

---

## (e) What surprised me

- **The hard part is plumbing, not algorithms.** `w:ins`/`w:del` are dead-simple
  wrapper elements; the effort is the OPC package + content-types + rels + the
  separate comments part. Once the package handling is right, revisions are easy.
- **`python-docx`'s `.text` hides revisions** — it reads only `w:t` directly under
  paragraph runs, so insertions (inside `w:ins`) and deletions (as `w:delText`) are
  *absent* from the naive body text. That's a useful tell: it mirrors Word's
  "final" view (insertions accepted-looking, deletions gone) and confirms our
  deletions are correctly stored as `delText`, not `t`. Good for an independent
  signal, but it means a naive python-docx reader is **not** sufficient to verify
  revision *content* — you must walk the element tree (which our validator does).
- **Determinism is cheap and worth it.** A deterministic serializer makes the
  round-trip idempotent, which gives stable diffs and plays well with Advisor Prep Hero's
  existing version-history feature — a nice unplanned alignment.
- **The existing TS path (`src/utils/docx-io.ts`) can't be incrementally fixed**
  for this. Mammoth → HTML → `docx` npm is fundamentally lossy and has no revision
  concept; the in-house Rust engine is the right call, and it's clearly tractable.

---

## How to run

```bash
cd spikes/docx-roundtrip
cargo test                      # 6 tests: fixture validity, preservation (A),
                                # authoring (B), committed-fixture consistency,
                                # + independent python-docx cross-validation
                                # (auto-skips if python-docx absent)

# Regenerate the committed fixture from the model (reproducible):
cargo run --bin gen_fixture

# Produce an AI-redlined doc to inspect by hand:
cargo run --bin gen_authored -- /tmp/authored.docx
python3 scripts/independent_validate.py fixtures/with-tracked-changes.docx /tmp/authored.docx
```

**Result in this environment:** `6 passed; 0 failed`, zero compiler warnings.

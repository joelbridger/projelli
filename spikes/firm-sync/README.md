# firm-sync — Keepance 3.0 de-risking spike (P0 gate 3 / WS-F)

Standalone Rust crate proving the **riskiest firm-platform assumption: conflict-free
collaborative editing of a shared "matter document"** — two clients make concurrent,
offline edits and converge to byte-identical state with **no central coordinator**,
including the case that loses data under naive last-write-wins.

Uses **`yrs`** (the Rust port of Yjs — an OSS CRDT library we compile into our own
binary, consistent with the in-house / no-SaaS-in-the-data-path constraint). This is a
**learning spike**, deliberately NOT wired into the Tauri build so tests are fast and
isolated. The proven approach is intended to move into the WS-F collaboration engine,
layered under the OOXML-DOM document model from Spike 1.

**Read [`DECISION.md`](./DECISION.md) for the architecture decision** covering all five
areas (collaboration/sync, identity/auth, per-org licensing, ethical walls/ACL, and the
assured zero-retention inference backend), the verdict, and the risk list.

## Run

```bash
cd spikes/firm-sync
cargo test                 # the proof — 5 convergence tests
cargo run --bin demo       # deterministic, human-readable convergence demo
```

### Expected output

`cargo test` → `test result: ok. 5 passed; 0 failed` (finishes in well under a second
after build).

`cargo run --bin demo` ends with:

```
identical state on both replicas: true
no data loss (both edits present): true
RESULT: PASS — conflict-free convergence with no central coordination.
```

## What the 5 tests prove

| Test | Property |
|---|---|
| `p1_join_replays_identical_state` | A second seat bootstraps by replaying full state and sees byte-identical content; the two replicas have distinct CRDT client ids. |
| `p2_concurrent_same_paragraph_edit_converges_no_data_loss` | **The conflict case.** Both replicas insert different text at the *same character position of the same paragraph* while offline; after a single delta exchange both converge and **both edits survive** (no last-write-wins clobber, no duplication of untouched text). |
| `p3_concurrent_structural_inserts_converge` | Concurrent *structural* edits (each appends a different paragraph offline) converge to one agreed order with no drops/dupes. |
| `p4_tracked_changes_ride_the_crdt_with_attribution` | A tracked insertion (author A) and a tracked deletion (author B) added concurrently both survive the merge **with author + date attribution intact** — proving Spike 1's `Inline::Insertion { author, date }` can be CRDT-backed. |
| `p5_commutative_idempotent_no_coordinator` | Merges are commutative + idempotent; a late-joining third replica that applies everyone's deltas in the "wrong" order, twice, converges to the same state. No coordinator anywhere. |

## Layout

| File | Role |
|---|---|
| `src/lib.rs` | `MatterDoc` — a Keepance client replica of one shared matter document, modeling Spike 1's paragraphs→runs OOXML-DOM tree directly on a `yrs` CRDT (body `Array<Map>` of paragraphs; each paragraph a `Map` with a `runs` `Array<Map>`; tracked-change runs carry `author`/`date`). Plus the no-coordinator sync primitives (`state_vector` / `diff_since` / `apply`) and `sync_pair`. |
| `src/bin/demo.rs` | Deterministic, asserted convergence demo (the conflict case + tracked change). |
| `tests/convergence.rs` | The 5-test proof above. |

## The crux it answers (from Spike 1)

Spike 1 fixed that documents are an in-memory typed DOM tree (paragraphs → inlines, with
tracked-change nodes as attributed variants) serialized to OOXML on save. WS-F's open
question was whether that *same* tree can be CRDT-backed so concurrent edits converge and
attributions survive a merge. Here the tree **is** the CRDT: every node is a `yrs` node,
so concurrent character edits and concurrent structural edits both converge by
construction, and a tracked insertion is just a run node with `kind="ins"` + `author` +
`date` that rides the CRDT unchanged. See `DECISION.md` §1 for how this serializes to
OOXML on save and how attribution is preserved.

## Finding worth flagging (yrs gotcha)

`yrs::Doc::get_or_insert_map` / `get_or_insert_array` open their **own** internal
transaction, so calling them while any transaction is open **deadlocks** (the doc is
guarded by a RwLock). The fix, baked into `MatterDoc`: resolve the root handles **once**
at construction and reuse the cached `MapRef`/`ArrayRef` everywhere else — never call
`get_or_insert_*` inside a transaction. The production engine must follow the same rule.

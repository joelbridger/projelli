# FEASIBILITY — matter-scoped, verified-citation retrieval (Keepance 3.0, P0 gate 2)

**Spike:** `spikes/matter-retrieval/` — standalone Rust crate exercising the same
LanceDB 0.21 + fastembed e5-small (384-dim) path the app ships, plus a
`matter_id` column at index time and a store-level `only_if` prefilter at query
time. Proven against a mixed (documents + emails) two-matter corpus with a
deliberately confusable cross-matter "closing date" pair.

**Test command + result:** `cd spikes/matter-retrieval && cargo test`
→ **`test result: ok. 10 passed; 0 failed`** (3 for P1, 3 for P2 incl. the
adversarial confusable case, 4 for P3). First run downloads e5-small (~120MB);
the run that produced this result completed the 10 integration tests in ~8.9s.

---

## (a) Verdict

**GO.** All three gate properties hold against the real stack:

1. **Exact-source cited retrieval over a mixed corpus** — natural-language
   queries return the correct chunk and resolve to the precise source
   (document path / `mail:<id>` + paragraph, and page for paginated docs),
   for both document and email content.
2. **Matter isolation** — a scoped query returns ONLY in-scope sources,
   including under the adversarial confusable-term case, because the matter
   filter is a LanceDB **prefilter** (applied to the row set before the vector
   search), not UI hiding and not a post-hoc filter on returned rows.
3. **Citation verification** — a citation resolves to an exact, content-addressed
   chunk; verification returns Verified / NotFound / MatterMismatch /
   TextMismatch, giving the app a hard basis to refuse unverifiable answers.

No architectural blocker. The work for WS-B / WS-C(scoping) is an *additive*
extension of the existing `rag` store — three columns, a required scope
parameter, and a verify command — not a rewrite.

---

## (b) Is matter isolation robust at the vector-store level?

**Yes — provided we use the default `prefilter` mode and never opt into
`postfilter`.** This is the single most important finding and it is verified from
the LanceDB 0.21.3 source, not just observed behaviour.

How LanceDB filtering composes with vector search (from
`lancedb-0.21.3/src/query.rs`):

- `QueryBase::only_if(sql)` sets `filter = Some(QueryFilter::Sql(...))`.
- The query's `prefilter` flag defaults to **`true`**
  (`QueryRequest::default()` → `prefilter: true`, line 660; `VectorQueryRequest`
  wraps a default `QueryRequest`, so `table.query().nearest_to(v)?.only_if(...)`
  inherits prefilter=true).
- The crate's own doc comment on `postfilter()` states: *"By default filtering
  will be performed before the vector search. This is how filtering is typically
  understood to work."* Prefiltering means the SQL predicate is pushed into the
  scan and the ANN search runs **only over rows that already satisfy the
  filter**. A row outside the scope is never a candidate, so similarity cannot
  surface it. This is what makes isolation airtight rather than best-effort.
- `postfilter()` is the *opt-in degraded mode*: it runs the vector search first
  and applies the filter to the top-k afterward. The crate warns this "can cause
  the query to return fewer than `limit` results." For our use it would be both
  wrong-by-omission (drop valid in-scope hits) and is the only path with any
  approximation risk. **The production code must never call `postfilter()` on a
  matter-scoped query**, and should encode that as a guard, not a convention.

Two further robustness notes proven in the spike:

- **Large top_k does not leak.** Asking for far more rows than the scoped matter
  contains still returns only in-scope rows (the prefilter shrinks the candidate
  set; it does not pad from out-of-scope rows to reach `limit`). Test
  `p2_isolation_holds_with_large_top_k_covering_whole_corpus`.
- **No ANN index = exact by construction.** The app today never builds a vector
  index (`create_index` is not called; nor does the spike). LanceDB therefore
  does a brute-force *flat* scan, and the prefilter is applied to the full table.
  There is no IVF/HNSW recall approximation in play at all today. When the corpus
  grows and an ANN index becomes worthwhile, prefilter over an indexed table
  still filters the row set first (Lance applies the predicate during the scan
  feeding the index search); the only thing an ANN index changes is recall of
  *similarity*, never the *scope boundary*. Recommendation in (f).

**Residual risk:** SQL-string filter construction. `only_if` takes a raw SQL
string. Matter ids are app-controlled (uuids), but the production code MUST
escape single quotes (the spike's `sql_escape`, identical to what
`store::delete_path` already does) and ideally validate matter_id against a
known set, so a crafted matter_id can never break out of the predicate. Treat the
filter string as security-sensitive.

---

## (c) Recommended extension of the chunk schema + Hit + rag_retrieve API

### Chunk schema (`store.rs::build_schema`)

Add two non-nullable columns; reuse the existing `source_type` and `page_number`:

| column | type | meaning |
|---|---|---|
| `matter_id` | Utf8, **NOT NULL** | the scope key; every chunk belongs to exactly one matter |
| `source_id` | Utf8, **NOT NULL** | originating source: the file path (docs/pdf) or `mail:<id>` (email). Today `path` already plays this role; promote/duplicate it to an explicit `source_id` so the citation contract is named and stable. |

`id` (the existing sha256(path:paragraph_index)) is already a content-addressed,
citation-grade key — keep it; it is what a citation points at. `page_number`
already exists (1-based for PDF; extend "document" path to carry it). `source_type`
already discriminates text/pdf/mail — extend the vocabulary or map "mail" → the
"email" display type at the edge.

**Migration:** the existing schema is append-friendly *for nullable* columns
(that is how A3/G4 columns were added). `matter_id`/`source_id` should be
non-nullable for new data, but a pre-3.0 table has rows without them. Recommended
path: on first 3.0 open, if the table lacks `matter_id`, **re-index** the
workspace into a new table (the indexer is idempotent and the corpus is local +
cheap to rebuild) rather than back-filling nulls — a null matter_id is a
confidentiality hazard (it would either leak into every scope or none). Gate the
re-index behind a one-time migration flag.

### `Hit` wire format (`mod.rs::Hit`)

Add (camelCase over IPC), keeping the frozen fields:

```
matter_id: String        // matterId — always present post-3.0
source_id: String        // sourceId — the resolvable source key
// path, chunkText, score, paragraphIndex, sourceType, pageNumber unchanged
```

The frontend can build a one-click citation from `{ sourceId, paragraphIndex,
pageNumber, id }` and render the source type badge from `sourceType`.

### `rag_retrieve` API

Make scope a **required** parameter, not optional, so a caller cannot
accidentally run an unscoped (cross-matter) query:

```
rag_retrieve(query: String, top_k: u32, scope: MatterScope) -> Vec<Hit>
// MatterScope = { Matter(matter_id) | AllMatters }   // AllMatters is explicit + audited
```

- `Matter(id)` → `nearest_to(qvec).only_if("matter_id = '<escaped id>'")` (prefilter).
- `AllMatters` is a deliberate, separately-named, audit-logged path (e.g. a
  cross-matter conflicts check) — never the default, never silently reachable.
- Forbid `postfilter()` in this code path.

The store-level helper `store::nearest` gains a `scope: Option<&str>` arg and
appends the `only_if` clause exactly as the spike's `retrieve` does.

---

## (d) How citation verification should work end to end

Goal: the app can **refuse to present an answer whose citation does not verify**.

1. **Retrieve carries citation material.** Every `Hit` already returns
   `{ id, sourceId, paragraphIndex, pageNumber, matterId, chunkText }`. The `id`
   is content-addressed: `sha256(source_id : paragraph_index)`. That tuple is
   enough to both *locate* the source and *recompute* the id.

2. **Answer emits citations.** The LLM answer is required to attach, per claim, a
   citation `{ id, matterId, sourceId, paragraphIndex, pageNumber, quotedText }`
   where `quotedText` is the span it relied on. (Prompt the model to quote, not
   paraphrase, in the citation envelope.)

3. **Verify before display** (`rag_verify_citation(citation) -> VerifyResult`):
   - Point-lookup the chunk by `id` **scoped to the claimed `matterId`**
     (`only_if("id = '..' AND matter_id = '..'")`).
   - `NotFound` → the id doesn't exist (fabricated/stale) **or** exists under a
     different matter. The spike distinguishes these: a second lookup by `id`
     alone returns `MatterMismatch { actual_matter }` vs `NotFound`.
   - If found, assert the stored chunk text **contains** the `quotedText`
     (whitespace-normalized). Pass → `Verified`; fail → `TextMismatch`
     (the answer misquoted/hallucinated the source).
   - Optionally re-assert `id == sha256(source_id : paragraph_index)` to catch a
     citation whose id/source_id were tampered to disagree.

4. **App policy:** present a claim only if its citation is `Verified`; otherwise
   strip the claim, flag the answer, or refuse. This is the mechanism behind the
   "no uncited/unverifiable answers, ever" non-negotiable.

What to store to make this work end to end: nothing new beyond the schema in (c).
`text` (plaintext for docs/pdf; decrypt-on-read for mail) + `id` + `matter_id`
are sufficient to resolve and verify. For mail, verification decrypts the stored
chunk in memory (the app already does this in `rag_retrieve`) before the text
comparison — see (e).

---

## (e) The residual-embedding concern (plaintext vectors persist)

**The concern is real and it is a property of the architecture, not a bug.** Even
when a chunk's *text* column is encrypted (mail today, and likely all client
content in 3.0), its **384-dim float vector is stored in plaintext** in the Lance
dataset — vectors must be plaintext for ANN/flat similarity to work at all. An
attacker with read access to `.keepance/vectors/` therefore gets:

- the vectors themselves (an approximate, *invertible-ish* representation of the
  source text — embedding-inversion research shows short texts can be partially
  reconstructed from their embeddings), and
- the **plaintext metadata columns**: `matter_id`, `source_id`/`path`,
  `paragraph_index`, `page_number`, `source_type`, `indexed_at`. For a law firm,
  `source_id` and `matter_id` alone are sensitive (they reveal which client has
  which documents/emails and the matter taxonomy).

This does NOT cause a **cross-matter** leak inside the app: vectors are tagged
with `matter_id` and the prefilter keeps Matter-A queries from ever scoring
Matter-B vectors. Matter isolation at query time is intact regardless of the
residual-embedding issue. The residual-embedding risk is a **data-at-rest
confidentiality** risk (someone reading the files off disk), orthogonal to query
scoping.

Recommendations (for WS-C / security workstream, not blocking this gate):

- **Encrypt the vector store at rest.** Treat `.keepance/vectors/` like the mail
  store: full-dataset encryption (the mail module already has `fde.rs` /
  per-blob crypto + a master key in the OS keychain). The cleanest path is
  OS-level or container-level encryption of the whole `.keepance` dir, since
  Lance needs plaintext vectors at query time and per-cell vector encryption
  would defeat ANN. At minimum, document that vectors + metadata are as sensitive
  as the source and must live inside the encrypted workspace boundary.
- **Treat `matter_id`/`source_id` as confidential metadata** — they leak the
  client/matter map. If that taxonomy is itself privileged, consider opaque ids
  (uuids, already the plan) so the on-disk strings don't reveal client names.
- **Per-matter datasets are an option, not a requirement.** A separate Lance
  table per matter would make cross-matter leakage *physically* impossible (no
  shared file) and shrink each query's candidate set, at the cost of more files
  and a harder cross-matter conflicts search. Given prefilter is provably exact,
  a single tagged table is acceptable for v1; per-matter tables are a defensible
  hardening if a design-partner firm demands physical separation. (See (f).)

---

## (f) Top risks + recommended design for WS-B and WS-C(scoping)

**Top risks**

1. **`postfilter` foot-gun.** If anyone ever adds `.postfilter()` (for latency)
   to a scoped query, isolation silently degrades to best-effort and can drop
   in-scope hits. *Mitigation:* never expose postfilter on the scoped path;
   add a unit/integration test that fails if a scoped query is built without
   prefilter; code-review checklist item.
2. **Unscoped queries by omission.** An optional scope param invites an
   accidental cross-matter query. *Mitigation:* make scope **required**; the only
   cross-matter path is an explicit, audited `AllMatters`.
3. **SQL-string injection via matter_id.** *Mitigation:* escape + validate
   matter_id against the known matter set before interpolating.
4. **Citation drift after re-index.** Chunk ids are `sha256(source_id :
   paragraph_index)`; if chunking changes, old citations may no longer resolve.
   *Mitigation:* keep the chunker stable; on re-index, citations re-resolve by
   `(source_id, page)` even if the exact paragraph_index shifts (resolve to the
   page/source and re-locate the quote). Treat the chunker as a versioned
   contract.
5. **Residual embeddings at rest** (see (e)) — disk-theft confidentiality, not a
   query-time leak. *Mitigation:* encrypt the vector store / `.keepance`
   boundary; opaque ids.
6. **Mail-chunk verification path.** Mail text is encrypted at rest; verification
   must decrypt-on-read (the app already does for retrieval) before comparing
   `quotedText`. If the keychain is locked, verification must fail *closed*
   (treat as unverifiable, refuse) rather than pass.

**Recommended design**

- **WS-B (cited recall):** Extend the existing `rag` store with `matter_id` +
  `source_id` (non-null), make `rag_retrieve(query, top_k, scope)` scope-required
  using `only_if` prefilter, return citation material in every `Hit`, and add
  `rag_verify_citation`. Require the answer layer to attach per-claim citations
  and gate display on `Verified`. This is the spike, productized — additive, low
  risk.
- **WS-C (matter scoping):** Enforce scope at THREE layers (defense in depth):
  (1) **index time** — every chunk written with a non-null `matter_id`;
  (2) **query time** — mandatory `only_if` prefilter (proven exact);
  (3) **app/audit** — scope is a required, logged parameter; `AllMatters` is a
  distinct audited capability. Add the postfilter-forbidden guard + the
  scoped-query test as standing regression protection. Decide single-tagged-table
  (default, proven exact) vs per-matter-tables (physical separation) per the
  confidentiality bar a design-partner firm sets; both are compatible with this
  schema (per-matter tables = same schema, table-name = matter_id).

---

## Test result (actual)

```
running 10 tests
test p1_document_query_returns_exact_source_with_citation ... ok
test p1_email_query_returns_exact_email_source_with_citation ... ok
test p1_mixed_corpus_both_documents_and_emails_are_retrievable ... ok
test p2_scoped_query_returns_only_in_scope_matter ... ok
test p2_adversarial_confusable_term_does_not_leak_across_matters ... ok
test p2_isolation_holds_with_large_top_k_covering_whole_corpus ... ok
test p3_valid_citation_verifies ... ok
test p3_fabricated_chunk_id_is_not_found ... ok
test p3_misquoted_text_fails_verification ... ok
test p3_citation_against_wrong_matter_is_rejected ... ok

test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.93s
```

### Demonstration (`cargo run --bin demo`) — the confusable case, observed

Unscoped, the Globex closing date ranks #2 by pure similarity, right behind
Acme's — the pair really is confusable:

```
UNSCOPED top sources for "what is the closing date":
  [matter-acme]   doc:acme-spa     score=0.893
  [matter-globex] doc:globex-lease score=0.882   <-- would leak without scoping
  [matter-globex] mail:globex-0001 score=0.862
  ...
SCOPED to matter-acme:
  [matter-acme]   doc:acme-spa     score=0.893
  [matter-acme]   mail:acme-0001   score=0.854
  [matter-acme]   mail:acme-0002   score=0.838
  [matter-acme]   doc:acme-diligence score=0.809
  -> cross-matter leak: none (PASS)
```

The store-level prefilter removes Globex entirely under Acme scope — not by
ranking, by exclusion from the candidate set.

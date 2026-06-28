// WS3d-B — the BM25 KEYWORD index for hybrid (keyword + vector) retrieval.
//
// WHAT THIS IS. The vector store (LanceDB + e5-small) finds chunks by *meaning*:
// it embeds the query and each chunk into vectors and compares them, so it can
// match "who pays the deposit" to a clause that never uses those words. Powerful,
// but blind to exact tokens — a party name, a statute number, a docket cite, a
// misspelling — that a lawyer often searches for verbatim. BM25 is the opposite:
// a classic keyword scorer rewarding documents that contain the query's actual
// terms (weighted by term rarity and document length). "Hybrid" runs BOTH and
// FUSES the rankings (Reciprocal Rank Fusion), so an exact keyword hit the vector
// pass ranked low can still surface. This module is the keyword half.
//
// SAFETY MODEL — read before changing anything.
//
//  * THE AUTHORITATIVE SCOPE BOUNDARY IS UNCHANGED. Every chunk this index
//    proposes is re-fetched from the vector store through the SAME
//    `build_retrieval_predicate` (matter / privilege / tombstone) filter the
//    vector pass uses (see `store::fetch_by_ids_scoped`). A proposal that fails
//    that filter — wrong matter, privileged, tombstoned, or simply deleted — is
//    dropped by the store and never reaches an answer.
//
//  * THIS INDEX IS ALSO SCOPE-AWARE *BEFORE* RANKING (defence in depth, and to
//    avoid "candidate saturation": without it, a flood of keyword matches in
//    OTHER matters could fill the keyword candidate budget and starve the
//    in-scope hits). `search` is given the query scope and keeps only in-scope,
//    non-tombstoned, privilege-appropriate chunks as it walks the ranking — so
//    the candidates handed to fusion are already the in-scope ones. A bug here
//    can only lose recall or propose a chunk the store then drops; it can NEVER
//    widen what the authoritative re-fetch admits.
//
//  * STALENESS IS HARMLESS *and* SELF-HEALING. The index is rebuilt wholesale
//    from the vector store and tagged with the LanceDB dataset VERSION it was
//    built at. `table.version()` bumps on every write (any source: file walk,
//    PDF, mail, CRM, OneDrive, deletes, retags), so the retrieval path rebuilds
//    the moment the version it sees differs from the one baked into the index.
//    That covers every writer without threading a hook through each one.
//
// ENCRYPTION AT REST. The persisted form holds chunk TEXT (the same plaintext the
// vector store keeps, only there it is AES-GCM encrypted), so the on-disk blob is
// likewise AES-256-GCM encrypted under the vector-store master key — never a
// plaintext keyword index on disk. Loading is FAIL-CLOSED: a missing, corrupt, or
// undecryptable file yields an EMPTY index (caller rebuilds, or runs vector-only),
// never a crash and never a plaintext write.
//
// CORPUS STATS / NO DRIFT. BM25 needs corpus-wide statistics (average document
// length and per-term document frequency). The `bm25` crate fits those once when
// the engine is built and does not update them incrementally. We always build the
// engine from the FULL current corpus snapshot, so every query runs against an
// engine fit to exactly that snapshot — no drift.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use bm25::{Document, Language, SearchEngine, SearchEngineBuilder};
use serde::{Deserialize, Serialize};

use super::store::PRIVILEGE_NONE;
use crate::commands::mail::crypto::{decrypt_with_key, encrypt_with_key};

/// On-disk file name for the encrypted keyword index, kept beside the LanceDB
/// dataset in the workspace's `.keepance/vectors/` directory. The `-v1` lets a
/// future format change ship a new name and ignore the old one fail-closed.
pub const INDEX_FILE_NAME: &str = "bm25-index-v1.enc";

/// Standard Reciprocal-Rank-Fusion constant (Cormack et al.; the de-facto default
/// in Elasticsearch / Vespa). Larger k flattens rank's contribution; smaller
/// sharpens it.
pub const RRF_K: f32 = 60.0;

const FORMAT_VERSION: u32 = 1;

/// One indexed chunk: its keyword text plus the scope facets needed to keep
/// ranking in-scope. NONE of this is the authoritative boundary (the store's
/// re-fetch is) — these facets only pre-filter the keyword candidate set so it
/// can't be saturated by out-of-scope matches, and so tombstoned content does not
/// participate in ranking.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct DocEntry {
    /// Keyed HMAC path token (same token the vector store stores). Used ONLY to
    /// suppress tombstoned content at query time — never as a plaintext path.
    path_token: String,
    /// Plaintext scope column, matched against the query's matter scope.
    matter_id: String,
    /// Privilege column ("none" / "attorney-client" / "work-product").
    privilege: String,
    /// The chunk text BM25 ranks over.
    text: String,
}

/// Serialized wire form: a flat, versioned list plus the LanceDB version the
/// snapshot was taken at, independent of `HashMap` iteration order.
#[derive(Serialize, Deserialize)]
struct PersistedV1 {
    version: u32,
    /// The `table.version()` of the vector store when this snapshot was built.
    /// Lets a warm start skip a rebuild when the store hasn't changed.
    built_at_table_version: u64,
    entries: Vec<PersistedEntry>,
}

#[derive(Serialize, Deserialize)]
struct PersistedEntry {
    chunk_id: String,
    path_token: String,
    matter_id: String,
    privilege: String,
    text: String,
}

/// The keyword index. Building the BM25 engine is the expensive part; it is built
/// lazily from `docs` and cached until the corpus is replaced.
pub struct Bm25Index {
    /// chunk_id -> entry. The authoritative content for THIS index.
    docs: HashMap<String, DocEntry>,
    /// Lazily-built, corpus-fit BM25 engine. `None` = needs (re)build.
    engine: Option<SearchEngine<String>>,
    /// The LanceDB dataset version this snapshot reflects. `None` = unknown
    /// (freshly constructed and never populated from the store) → always rebuild.
    built_at_table_version: Option<u64>,
    /// The vectors directory (workspace) this snapshot was built/loaded for. The
    /// index lives on a process-global `RagState`, so a workspace switch can leave
    /// a previous workspace's index in memory; the freshness check pairs the
    /// table VERSION with this PATH so a new workspace whose table happens to share
    /// a version number is never mistaken for fresh. `None` = never populated.
    built_for: Option<PathBuf>,
}

impl Default for Bm25Index {
    fn default() -> Self {
        Self::new()
    }
}

impl Bm25Index {
    pub fn new() -> Self {
        Bm25Index {
            docs: HashMap::new(),
            engine: None,
            built_at_table_version: None,
            built_for: None,
        }
    }

    pub fn len(&self) -> usize {
        self.docs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.docs.is_empty()
    }

    /// The LanceDB version this index reflects, if known.
    pub fn table_version(&self) -> Option<u64> {
        self.built_at_table_version
    }

    /// True when this index is known to reflect `current_table_version`. A `None`
    /// baked version (never populated) is always stale. Callers MUST also confirm
    /// `built_for` matches the active workspace (see `built_for`).
    pub fn is_fresh_for(&self, current_table_version: u64) -> bool {
        self.built_at_table_version == Some(current_table_version)
    }

    /// The vectors directory this index was built/loaded for, if any.
    pub fn built_for(&self) -> Option<&Path> {
        self.built_for.as_deref()
    }

    /// Record which vectors directory this snapshot belongs to (set right after a
    /// rebuild from that workspace's store).
    pub fn note_built_for(&mut self, dir: &Path) {
        self.built_for = Some(dir.to_path_buf());
    }

    /// Replace the ENTIRE corpus from a full snapshot read out of the vector
    /// store. `entries` is `(chunk_id, path_token, matter_id, privilege, text)`.
    /// `table_version` is the `table.version()` the snapshot was taken at.
    pub fn rebuild_from(&mut self, entries: Vec<(String, String, String, String, String)>, table_version: u64) {
        let mut docs = HashMap::with_capacity(entries.len());
        for (chunk_id, path_token, matter_id, privilege, text) in entries {
            docs.insert(
                chunk_id,
                DocEntry {
                    path_token,
                    matter_id,
                    privilege,
                    text,
                },
            );
        }
        self.docs = docs;
        self.engine = None; // force rebuild against the new corpus
        self.built_at_table_version = Some(table_version);
    }

    /// Build the corpus-fit BM25 engine from the current `docs`, caching it.
    fn ensure_engine(&mut self) {
        if self.engine.is_some() || self.docs.is_empty() {
            return;
        }
        let documents: Vec<Document<String>> = self
            .docs
            .iter()
            .map(|(id, e)| Document::new(id.clone(), e.text.clone()))
            .collect();
        let engine =
            SearchEngineBuilder::<String>::with_documents(Language::English, documents).build();
        self.engine = Some(engine);
    }

    /// Scope filter applied while walking the ranking. Keeps a chunk only when it
    /// matches the query's matter scope, is privilege-appropriate, and is not
    /// tombstoned. Mirrors `store::build_retrieval_predicate` semantics (the
    /// authoritative boundary) so the keyword candidate set is already in-scope.
    fn in_scope(
        entry: &DocEntry,
        scope: Option<&str>,
        include_privileged: bool,
        tombstoned_tokens: &[String],
    ) -> bool {
        if let Some(matter_id) = scope {
            if entry.matter_id != matter_id {
                return false;
            }
        }
        if !include_privileged && entry.privilege != PRIVILEGE_NONE {
            return false;
        }
        if tombstoned_tokens.iter().any(|t| t == &entry.path_token) {
            return false;
        }
        true
    }

    /// Keyword-search the corpus, returning up to `limit` in-scope
    /// `(chunk_id, bm25_score)` pairs ordered by score DESC with a deterministic
    /// `chunk_id`-ascending tiebreak (the crate's tie order is HashMap-iteration
    /// dependent, so we re-sort for reproducible fusion ranks). The scope facets
    /// are applied BEFORE truncation so out-of-scope matches cannot saturate the
    /// candidate budget.
    pub fn search(
        &mut self,
        query: &str,
        limit: usize,
        scope: Option<&str>,
        include_privileged: bool,
        tombstoned_tokens: &[String],
    ) -> Vec<(String, f32)> {
        if limit == 0 || query.trim().is_empty() {
            return Vec::new();
        }
        self.ensure_engine();
        let Some(engine) = self.engine.as_ref() else {
            return Vec::new();
        };
        // Rank over the full corpus (global IDF is the correct BM25), but keep
        // only in-scope candidates and re-sort deterministically before
        // truncating, so the cut boundary is stable run to run.
        let mut results: Vec<(String, f32)> = engine
            .search(query, None)
            .into_iter()
            .filter_map(|r| {
                self.docs.get(&r.document.id).and_then(|entry| {
                    if Self::in_scope(entry, scope, include_privileged, tombstoned_tokens) {
                        Some((r.document.id, r.score))
                    } else {
                        None
                    }
                })
            })
            .collect();
        results.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.0.cmp(&b.0))
        });
        results.truncate(limit);
        results
    }

    // ---- persistence -------------------------------------------------------

    /// Absolute path of the index file inside `dir` (the vectors directory).
    pub fn index_path(dir: &Path) -> PathBuf {
        dir.join(INDEX_FILE_NAME)
    }

    fn to_bytes(&self) -> Result<Vec<u8>> {
        let entries = self
            .docs
            .iter()
            .map(|(chunk_id, e)| PersistedEntry {
                chunk_id: chunk_id.clone(),
                path_token: e.path_token.clone(),
                matter_id: e.matter_id.clone(),
                privilege: e.privilege.clone(),
                text: e.text.clone(),
            })
            .collect();
        let persisted = PersistedV1 {
            version: FORMAT_VERSION,
            built_at_table_version: self.built_at_table_version.unwrap_or(0),
            entries,
        };
        serde_json::to_vec(&persisted).context("serialize bm25 index")
    }

    fn from_bytes(bytes: &[u8]) -> Result<Self> {
        let persisted: PersistedV1 =
            serde_json::from_slice(bytes).context("deserialize bm25 index")?;
        if persisted.version != FORMAT_VERSION {
            anyhow::bail!(
                "unsupported bm25 index version {} (expected {})",
                persisted.version,
                FORMAT_VERSION
            );
        }
        let mut docs = HashMap::with_capacity(persisted.entries.len());
        for e in persisted.entries {
            docs.insert(
                e.chunk_id,
                DocEntry {
                    path_token: e.path_token,
                    matter_id: e.matter_id,
                    privilege: e.privilege,
                    text: e.text,
                },
            );
        }
        Ok(Bm25Index {
            docs,
            engine: None,
            built_at_table_version: Some(persisted.built_at_table_version),
            // Set by `load` to the directory it was read from.
            built_for: None,
        })
    }

    /// Encrypt and atomically write the index to `dir/INDEX_FILE_NAME` (temp file
    /// + rename, so a crash mid-write can't leave a truncated index).
    pub fn persist(&self, dir: &Path, key: &[u8; 32]) -> Result<()> {
        std::fs::create_dir_all(dir).with_context(|| format!("create {}", dir.display()))?;
        let plaintext = self.to_bytes()?;
        let blob = encrypt_with_key(&plaintext, key).context("encrypt bm25 index")?;
        let final_path = Self::index_path(dir);
        let tmp_path = dir.join(format!("{INDEX_FILE_NAME}.tmp"));
        std::fs::write(&tmp_path, &blob)
            .with_context(|| format!("write {}", tmp_path.display()))?;
        std::fs::rename(&tmp_path, &final_path)
            .with_context(|| format!("rename into {}", final_path.display()))?;
        Ok(())
    }

    /// Load the index from `dir`, FAIL-CLOSED: any problem (no file, unreadable,
    /// undecryptable, corrupt, wrong version) yields an EMPTY index (caller
    /// rebuilds from the store, or runs vector-only) — never an error or a panic.
    /// `true` = a real index loaded; `false` = fell back to empty.
    pub fn load(dir: &Path, key: &[u8; 32]) -> (Bm25Index, bool) {
        let path = Self::index_path(dir);
        let blob = match std::fs::read(&path) {
            Ok(b) => b,
            Err(_) => return (Bm25Index::new(), false),
        };
        let plaintext = match decrypt_with_key(&blob, key) {
            Ok(p) => p,
            Err(e) => {
                log::warn!(
                    "bm25 index at {} could not be decrypted ({e:#}); starting empty",
                    path.display()
                );
                return (Bm25Index::new(), false);
            }
        };
        match Bm25Index::from_bytes(&plaintext) {
            Ok(mut idx) => {
                // Tag the loaded snapshot with the workspace dir it came from, so
                // the freshness check can reject a different workspace's index.
                idx.built_for = Some(dir.to_path_buf());
                (idx, true)
            }
            Err(e) => {
                log::warn!(
                    "bm25 index at {} is corrupt ({e:#}); starting empty",
                    path.display()
                );
                (Bm25Index::new(), false)
            }
        }
    }
}

/// Reciprocal Rank Fusion of a vector ranking and a keyword ranking.
///
/// Each input is a list of chunk ids ordered best-first. A chunk's fused score is
/// `sum over the lists it appears in of 1/(k + rank)` (rank 1-based). A chunk in
/// both lists gets both contributions. RRF needs no score normalization (it uses
/// ranks, not the incomparable cosine/BM25 magnitudes) and is the standard hybrid
/// fusion. Output is ordered by fused score DESC with a deterministic
/// `chunk_id`-ascending tiebreak.
pub fn rrf_fuse(vector_ranked: &[String], keyword_ranked: &[String], k: f32) -> Vec<(String, f32)> {
    let mut scores: HashMap<&str, f32> = HashMap::new();
    for (rank, id) in vector_ranked.iter().enumerate() {
        *scores.entry(id.as_str()).or_insert(0.0) += 1.0 / (k + (rank as f32) + 1.0);
    }
    for (rank, id) in keyword_ranked.iter().enumerate() {
        *scores.entry(id.as_str()).or_insert(0.0) += 1.0 / (k + (rank as f32) + 1.0);
    }
    let mut fused: Vec<(String, f32)> =
        scores.into_iter().map(|(id, s)| (id.to_string(), s)).collect();
    fused.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.cmp(&b.0))
    });
    fused
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONE: &str = PRIVILEGE_NONE;

    fn e(id: &str, matter: &str, text: &str) -> (String, String, String, String, String) {
        // path_token derived from matter+id is fine for tests (only equality matters).
        (id.into(), format!("tok-{id}"), matter.into(), NONE.into(), text.into())
    }

    fn build(entries: Vec<(String, String, String, String, String)>, v: u64) -> Bm25Index {
        let mut idx = Bm25Index::new();
        idx.rebuild_from(entries, v);
        idx
    }

    #[test]
    fn finds_keyword_match() {
        let mut idx = build(
            vec![
                e("c1", "m1", "the deposit is due on closing"),
                e("c2", "m1", "the parties agree to arbitration in Delaware"),
                e("c3", "m1", "force majeure clause covering pandemics"),
            ],
            1,
        );
        let hits = idx.search("arbitration Delaware", 10, Some("m1"), false, &[]);
        assert_eq!(hits[0].0, "c2", "the arbitration chunk must rank first");
    }

    #[test]
    fn empty_index_and_empty_query_return_nothing() {
        let mut idx = Bm25Index::new();
        assert!(idx.search("x", 10, None, false, &[]).is_empty());
        let mut idx2 = build(vec![e("c1", "m1", "hello world")], 1);
        assert!(idx2.search("   ", 10, Some("m1"), false, &[]).is_empty());
        assert!(idx2.search("hello", 0, Some("m1"), false, &[]).is_empty());
    }

    // ---- SECURITY: scope-aware ranking ------------------------------------

    #[test]
    fn scope_excludes_other_matters() {
        let mut idx = build(
            vec![
                e("a1", "matterA", "settlement agreement terms"),
                e("b1", "matterB", "settlement agreement terms"),
            ],
            1,
        );
        let hits = idx.search("settlement agreement", 10, Some("matterA"), false, &[]);
        assert!(hits.iter().all(|(id, _)| id == "a1"), "only matterA chunk allowed, got {hits:?}");
    }

    #[test]
    fn other_matter_flood_cannot_saturate_in_scope_candidate_budget() {
        // matterB has MANY strong keyword matches; matterA has exactly one. With a
        // small limit, a naive "rank globally then take top N" would return all
        // matterB (then drop them) and surface ZERO matterA hits. Scope-before-
        // truncate must still return matterA's hit.
        let mut entries = vec![e("a1", "matterA", "indemnification clause language")];
        for i in 0..50 {
            entries.push(e(&format!("b{i}"), "matterB", "indemnification clause language"));
        }
        let mut idx = build(entries, 1);
        let hits = idx.search("indemnification clause", 3, Some("matterA"), false, &[]);
        assert_eq!(hits.len(), 1, "exactly the one in-scope hit");
        assert_eq!(hits[0].0, "a1");
    }

    #[test]
    fn privileged_excluded_by_default_included_on_request() {
        let mut idx = Bm25Index::new();
        idx.rebuild_from(
            vec![
                ("p1".into(), "tok-p1".into(), "m1".into(), "attorney-client".into(), "privileged strategy memo".into()),
                ("n1".into(), "tok-n1".into(), "m1".into(), NONE.into(), "ordinary strategy memo".into()),
            ],
            1,
        );
        let default = idx.search("strategy memo", 10, Some("m1"), false, &[]);
        assert!(default.iter().all(|(id, _)| id == "n1"), "privileged hidden by default");
        let included = idx.search("strategy memo", 10, Some("m1"), true, &[]);
        assert!(included.iter().any(|(id, _)| id == "p1"), "privileged surfaces when included");
    }

    #[test]
    fn tombstoned_path_does_not_participate_in_ranking() {
        let mut idx = build(
            vec![
                e("c1", "m1", "unique-token-zebra appears here"),
                e("c2", "m1", "something unrelated"),
            ],
            1,
        );
        // c1's path token is tombstoned → it must be excluded even though it is the
        // only keyword match.
        let hits = idx.search("zebra", 10, Some("m1"), false, &["tok-c1".to_string()]);
        assert!(hits.iter().all(|(id, _)| id != "c1"), "tombstoned chunk must not appear");
    }

    // ---- determinism + versioning -----------------------------------------

    #[test]
    fn search_is_deterministic_across_insertion_order() {
        let a = build(vec![e("z", "m", "same words here"), e("a", "m", "same words here")], 1);
        let b = build(vec![e("a", "m", "same words here"), e("z", "m", "same words here")], 1);
        let mut a = a;
        let mut b = b;
        let ra = a.search("same words", 10, Some("m"), false, &[]);
        let rb = b.search("same words", 10, Some("m"), false, &[]);
        assert_eq!(ra, rb);
        let ids: Vec<String> = ra.into_iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec!["a".to_string(), "z".to_string()], "ties break by id asc");
    }

    #[test]
    fn freshness_tracks_table_version() {
        let idx = build(vec![e("c1", "m1", "x")], 7);
        assert!(idx.is_fresh_for(7));
        assert!(!idx.is_fresh_for(8));
        assert!(!Bm25Index::new().is_fresh_for(0), "never-populated is always stale");
    }

    // ---- persistence ------------------------------------------------------

    #[test]
    fn serialize_roundtrip_preserves_content_and_version() {
        let idx = build(
            vec![e("c1", "m1", "deposit due on closing"), e("c2", "m2", "arbitration in Delaware")],
            42,
        );
        let bytes = idx.to_bytes().expect("serialize");
        let mut restored = Bm25Index::from_bytes(&bytes).expect("deserialize");
        assert_eq!(restored.len(), 2);
        assert!(restored.is_fresh_for(42), "version survives roundtrip");
        assert_eq!(restored.search("arbitration", 10, Some("m2"), false, &[])[0].0, "c2");
    }

    #[test]
    fn from_bytes_rejects_garbage_and_bad_version() {
        assert!(Bm25Index::from_bytes(b"not json").is_err());
        assert!(Bm25Index::from_bytes(br#"{"version":999,"built_at_table_version":0,"entries":[]}"#).is_err());
    }

    #[test]
    fn persist_then_load_roundtrips_encrypted() {
        let key = [7u8; 32];
        let dir = std::env::temp_dir().join(format!("kp-bm25-rt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let idx = build(vec![e("c1", "m1", "confidential settlement terms")], 5);
        idx.persist(&dir, &key).expect("persist");
        let raw = std::fs::read(Bm25Index::index_path(&dir)).expect("read blob");
        assert!(
            !String::from_utf8_lossy(&raw).contains("confidential settlement"),
            "on-disk index must be encrypted, not plaintext"
        );
        let (mut loaded, ok) = Bm25Index::load(&dir, &key);
        assert!(ok);
        assert!(loaded.is_fresh_for(5));
        // A loaded index is tagged with the workspace dir it came from, so the
        // retrieval-path freshness check can reject a different workspace.
        assert_eq!(loaded.built_for(), Some(dir.as_path()));
        assert_eq!(loaded.search("settlement", 10, Some("m1"), false, &[])[0].0, "c1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn note_built_for_tags_workspace() {
        let mut idx = build(vec![e("c1", "m1", "x")], 3);
        assert_eq!(idx.built_for(), None, "rebuild_from alone leaves workspace untagged");
        let dir = std::path::Path::new("/ws/a/.keepance/vectors");
        idx.note_built_for(dir);
        assert_eq!(idx.built_for(), Some(dir));
    }

    #[test]
    fn load_fail_closed_on_missing_and_wrong_key() {
        let dir = std::env::temp_dir().join(format!("kp-bm25-fc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (idx, ok) = Bm25Index::load(&dir, &[9u8; 32]);
        assert!(!ok && idx.is_empty(), "missing → empty, no error");
        build(vec![e("c1", "m1", "secret")], 1).persist(&dir, &[1u8; 32]).expect("persist");
        let (loaded, ok) = Bm25Index::load(&dir, &[2u8; 32]);
        assert!(!ok && loaded.is_empty(), "wrong key → empty, no panic");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ---- RRF fusion -------------------------------------------------------

    #[test]
    fn rrf_rewards_agreement_and_includes_keyword_only() {
        let vector = vec!["d1".to_string(), "d2".to_string(), "d4".to_string()];
        let keyword = vec!["d3".to_string(), "d2".to_string(), "k9".to_string()];
        let fused = rrf_fuse(&vector, &keyword, RRF_K);
        assert_eq!(fused[0].0, "d2", "doc ranked highly by both wins");
        let ids: Vec<&str> = fused.iter().map(|(id, _)| id.as_str()).collect();
        assert!(ids.contains(&"k9"), "keyword-only doc is included");
    }

    #[test]
    fn rrf_deterministic_tiebreak_and_empty() {
        let fused = rrf_fuse(&["b".into()], &["a".into()], RRF_K);
        let ids: Vec<String> = fused.into_iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec!["a".to_string(), "b".to_string()]);
        assert!(rrf_fuse(&[], &[], RRF_K).is_empty());
    }
}

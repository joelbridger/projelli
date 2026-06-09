//! firm-sync — Keepance 3.0 WS-F de-risking spike.
//!
//! Proves the riskiest firm-platform assumption: **two clients can edit a
//! shared "matter document" concurrently and offline, then merge with NO
//! central coordinator and converge to identical state — conflict-free**,
//! including the case that would corrupt under naive last-write-wins.
//!
//! ## The crux this spike answers
//!
//! Spike 1 settled that documents are an in-memory typed DOM tree (paragraphs
//! -> inlines, with tracked-change nodes as attributed variants) serialized to
//! OOXML on save. The open WS-F question was: *can that same structured tree be
//! CRDT-backed so concurrent edits converge, and do author/date attributions on
//! tracked changes survive a concurrent merge?*
//!
//! Here we model the document tree directly on a `yrs` (Yjs) CRDT:
//!
//! ```text
//!   Doc (CRDT replica)
//!   └── "body": Array<Map>          ordered list of paragraphs (block sequence)
//!        └── paragraph: Map
//!             ├── "id":   String    stable paragraph id (uuid)
//!             └── "runs": Array<Map>   inline runs in document order
//!                  └── run: Map
//!                       ├── "kind":   "text" | "ins" | "del"   (tracked-change variant)
//!                       ├── "text":   Text   the run's characters (a CRDT text seq)
//!                       ├── "author": String (attribution; only on ins/del)
//!                       └── "date":   String (RFC3339; only on ins/del)
//!   └── "meta": Map                  matter_id + title (matches Spike 2's scope key)
//! ```
//!
//! This is the CRDT analog of Spike 1's `Document { paragraphs: Vec<Paragraph
//! { inlines: Vec<Inline::{Run,Insertion,Deletion}> }> }`. Every node is a CRDT
//! node, so concurrent structural edits (insert paragraph here, delete run
//! there) and concurrent character edits (both type in the same paragraph)
//! converge by construction. A tracked insertion is just a `run` Map with
//! `kind = "ins"` plus `author`/`date` — the attribution rides *on the CRDT*,
//! so it survives a merge unchanged (proven in `tests/convergence.rs`).
//!
//! ## Offline-then-merge (no server)
//!
//! Local-first is the default, so the model must work offline and sync later.
//! The sync primitive is three `yrs` calls, no coordinator:
//!   - `state_vector()`  — "what I already have" (a compact version summary).
//!   - `diff_since(sv)`  — bytes the peer is missing (encode_diff_v1).
//!   - `apply(bytes)`    — merge a peer's bytes (commutative, idempotent).
//!
//! Convergence holds regardless of *who* relays the bytes (a peer, a file on a
//! USB stick, or the optional assured relay). The relay is a dumb pipe — it
//! never needs to understand or decrypt the payload. That is the whole point:
//! correctness does not depend on a trusted central server.

use chrono::Utc;
use uuid::Uuid;
use yrs::types::ToJson;
use yrs::{
    Any, Array, ArrayPrelim, ArrayRef, Doc, GetString, Map, MapPrelim, MapRef, Origin, ReadTxn,
    StateVector, Text, TextPrelim, Transact, Update,
};
use yrs::updates::decoder::Decode;

/// Run kinds, mirroring Spike 1's `Inline` variants. A tracked insertion /
/// deletion carries author + date; a plain run does not.
pub const KIND_TEXT: &str = "text";
pub const KIND_INS: &str = "ins";
pub const KIND_DEL: &str = "del";

/// A single Keepance client replica of one shared matter document.
///
/// Wraps a `yrs::Doc`. Each replica has a distinct `client_id` (yrs assigns a
/// random one per `Doc`; we surface it for clarity). All edits go through
/// attributed transactions so the audit story and tracked-change attribution
/// are first-class.
pub struct MatterDoc {
    doc: Doc,
    /// Cached root handles. IMPORTANT: `Doc::get_or_insert_*` opens its OWN
    /// internal transaction, so calling it while any transaction is open
    /// deadlocks (yrs guards the doc with a RwLock). We resolve the roots once
    /// at construction and reuse the handles everywhere else.
    body: ArrayRef,
    meta: MapRef,
    /// Human label for the seat operating this replica ("attorney-a"), used as
    /// the transaction `Origin` and as tracked-change `author`.
    pub author: String,
}

/// A flattened, comparable snapshot of the document, used by tests to assert
/// that two replicas converged to *byte-identical* content (not just "looks
/// the same"). Plain text per paragraph plus the tracked-change runs with their
/// attribution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocSnapshot {
    pub matter_id: String,
    pub title: String,
    pub paragraphs: Vec<ParagraphSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParagraphSnapshot {
    pub id: String,
    /// Concatenated visible text of all runs in order (the "show markup" view:
    /// insertions and deletions both included, in document order).
    pub text: String,
    pub runs: Vec<RunSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunSnapshot {
    pub kind: String,
    pub text: String,
    /// Attribution; empty for plain text runs.
    pub author: String,
    pub date: String,
}

impl MatterDoc {
    /// Create a fresh replica for `author`. `matter_id` is the Spike-2 scope key
    /// stamped into the doc metadata (so the synced artifact is self-describing
    /// about which matter / ethical-wall it belongs to).
    pub fn new(author: &str, matter_id: &str, title: &str) -> Self {
        let doc = Doc::new();
        // Resolve roots ONCE, before opening any transaction (see field docs).
        let meta = doc.get_or_insert_map("meta");
        let body = doc.get_or_insert_array("body");
        {
            let origin: Origin = author.to_string().into();
            let mut txn = doc.transact_mut_with(origin);
            meta.insert(&mut txn, "matter_id", matter_id.to_string());
            meta.insert(&mut txn, "title", title.to_string());
        }
        MatterDoc {
            doc,
            body,
            meta,
            author: author.to_string(),
        }
    }

    /// Create a replica that joins an *existing* document by replaying its full
    /// state. This is how a second seat (or the same user on a second machine)
    /// bootstraps: receive one full-state update, apply it, then edit offline.
    pub fn join(author: &str, full_state: &[u8]) -> Self {
        let doc = Doc::new();
        // Materialize root handles (once, before any txn) so they share identity
        // with the incoming state's roots.
        let meta = doc.get_or_insert_map("meta");
        let body = doc.get_or_insert_array("body");
        {
            let origin: Origin = format!("{author}:join").into();
            let mut txn = doc.transact_mut_with(origin);
            let update = Update::decode_v1(full_state).expect("valid full-state update");
            txn.apply_update(update).expect("apply join state");
        }
        MatterDoc {
            doc,
            body,
            meta,
            author: author.to_string(),
        }
    }

    fn body(&self) -> ArrayRef {
        self.body.clone()
    }

    fn meta(&self) -> MapRef {
        self.meta.clone()
    }

    /// The CRDT client id yrs assigned this replica (distinct per replica).
    pub fn client_id(&self) -> yrs::ClientID {
        self.doc.client_id()
    }

    // ---- editing operations (all attributed to this replica's author) ----

    /// Append a plain paragraph with a single text run; returns its paragraph id.
    pub fn append_paragraph(&self, text: &str) -> String {
        let body = self.body();
        let para_id = Uuid::new_v4().to_string();
        let origin: Origin = self.author.clone().into();
        let mut txn = self.doc.transact_mut_with(origin);

        let para = body.push_back(&mut txn, MapPrelim::default());
        para.insert(&mut txn, "id", para_id.clone());
        let runs = para.insert(&mut txn, "runs", ArrayPrelim::default());
        let run = runs.push_back(&mut txn, MapPrelim::default());
        run.insert(&mut txn, "kind", KIND_TEXT.to_string());
        run.insert(&mut txn, "text", TextPrelim::new(text));
        para_id
    }

    /// Locate a paragraph by id; returns its index in the body array.
    fn find_paragraph_index<T: ReadTxn>(&self, txn: &T, para_id: &str) -> Option<u32> {
        let body = self.body();
        let len = body.len(txn);
        for i in 0..len {
            if let Some(yrs::Out::YMap(p)) = body.get(txn, i) {
                if let Some(yrs::Out::Any(Any::String(s))) = p.get(txn, "id") {
                    if s.as_ref() == para_id {
                        return Some(i);
                    }
                }
            }
        }
        None
    }

    fn paragraph_map<T: ReadTxn>(&self, txn: &T, para_id: &str) -> Option<MapRef> {
        let idx = self.find_paragraph_index(txn, para_id)?;
        match self.body().get(txn, idx) {
            Some(yrs::Out::YMap(p)) => Some(p),
            _ => None,
        }
    }

    /// Insert text into the *first text run* of a paragraph at character
    /// `index`. This is the operation that, run concurrently on two replicas
    /// against the SAME paragraph, would be a destructive conflict under
    /// last-write-wins — and converges cleanly here.
    pub fn insert_text_in_paragraph(&self, para_id: &str, index: u32, text: &str) {
        let origin: Origin = self.author.clone().into();
        let mut txn = self.doc.transact_mut_with(origin);
        let para = match self.paragraph_map(&txn, para_id) {
            Some(p) => p,
            None => return,
        };
        if let Some(yrs::Out::YArray(runs)) = para.get(&txn, "runs") {
            // first text run
            if let Some(yrs::Out::YMap(run)) = runs.get(&txn, 0) {
                if let Some(yrs::Out::YText(t)) = run.get(&txn, "text") {
                    let len = t.len(&txn);
                    let at = index.min(len);
                    t.insert(&mut txn, at, text);
                }
            }
        }
    }

    /// Add a *tracked insertion* run to the end of a paragraph, attributed to
    /// this replica's author + now(). This is the CRDT analog of Spike 1's
    /// `Inline::Insertion { meta: { author, date }, runs }` and the bonus the
    /// gate asks for: the attribution rides on the CRDT node, so it survives a
    /// concurrent merge unchanged.
    pub fn add_tracked_insertion(&self, para_id: &str, text: &str) {
        self.add_tracked_run(para_id, KIND_INS, text);
    }

    /// Add a *tracked deletion* run (the content the author proposes to remove,
    /// preserved with attribution — exactly like `w:del`/`w:delText`).
    pub fn add_tracked_deletion(&self, para_id: &str, text: &str) {
        self.add_tracked_run(para_id, KIND_DEL, text);
    }

    fn add_tracked_run(&self, para_id: &str, kind: &str, text: &str) {
        let date = Utc::now().to_rfc3339();
        let origin: Origin = self.author.clone().into();
        let mut txn = self.doc.transact_mut_with(origin);
        let para = match self.paragraph_map(&txn, para_id) {
            Some(p) => p,
            None => return,
        };
        if let Some(yrs::Out::YArray(runs)) = para.get(&txn, "runs") {
            let run = runs.push_back(&mut txn, MapPrelim::default());
            run.insert(&mut txn, "kind", kind.to_string());
            run.insert(&mut txn, "text", TextPrelim::new(text));
            run.insert(&mut txn, "author", self.author.clone());
            run.insert(&mut txn, "date", date);
        }
    }

    // ---- sync primitives (no coordinator) ----

    /// Compact summary of everything this replica already has.
    pub fn state_vector(&self) -> StateVector {
        self.doc.transact().state_vector()
    }

    /// The full state of this replica as a v1 update (used to bootstrap a new
    /// joiner). Equivalent to `diff_since(&StateVector::default())`.
    pub fn full_state(&self) -> Vec<u8> {
        self.doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default())
    }

    /// The bytes a peer at `remote_sv` is missing from this replica. This is the
    /// delta you exchange to sync — small, and it carries only the new ops.
    pub fn diff_since(&self, remote_sv: &StateVector) -> Vec<u8> {
        self.doc.transact().encode_diff_v1(remote_sv)
    }

    /// Merge a peer's update bytes. Commutative + idempotent: order of
    /// application across peers does not matter, and applying the same bytes
    /// twice is a no-op. Returns the byte length applied (for demo reporting).
    pub fn apply(&self, update_bytes: &[u8]) {
        let origin: Origin = format!("{}:sync", self.author).into();
        let mut txn = self.doc.transact_mut_with(origin);
        let update = Update::decode_v1(update_bytes).expect("valid update bytes");
        txn.apply_update(update).expect("apply peer update");
    }

    // ---- reading / snapshot ----

    /// Read the matter_id stamped in metadata.
    pub fn matter_id(&self) -> String {
        let txn = self.doc.transact();
        match self.meta().get(&txn, "matter_id") {
            Some(yrs::Out::Any(Any::String(s))) => s.to_string(),
            _ => String::new(),
        }
    }

    /// Flatten the document to a comparable snapshot (the equality oracle used
    /// to *prove* convergence in tests).
    pub fn snapshot(&self) -> DocSnapshot {
        let txn = self.doc.transact();
        let meta = self.meta();
        let matter_id = match meta.get(&txn, "matter_id") {
            Some(yrs::Out::Any(Any::String(s))) => s.to_string(),
            _ => String::new(),
        };
        let title = match meta.get(&txn, "title") {
            Some(yrs::Out::Any(Any::String(s))) => s.to_string(),
            _ => String::new(),
        };

        let body = self.body();
        let mut paragraphs = Vec::new();
        for i in 0..body.len(&txn) {
            let yrs::Out::YMap(p) = (match body.get(&txn, i) {
                Some(v) => v,
                None => continue,
            }) else {
                continue;
            };
            let id = match p.get(&txn, "id") {
                Some(yrs::Out::Any(Any::String(s))) => s.to_string(),
                _ => String::new(),
            };
            let mut runs = Vec::new();
            let mut text = String::new();
            if let Some(yrs::Out::YArray(rs)) = p.get(&txn, "runs") {
                for j in 0..rs.len(&txn) {
                    if let Some(yrs::Out::YMap(run)) = rs.get(&txn, j) {
                        let kind = match run.get(&txn, "kind") {
                            Some(yrs::Out::Any(Any::String(s))) => s.to_string(),
                            _ => KIND_TEXT.to_string(),
                        };
                        let rtext = match run.get(&txn, "text") {
                            Some(yrs::Out::YText(t)) => t.get_string(&txn),
                            _ => String::new(),
                        };
                        let author = match run.get(&txn, "author") {
                            Some(yrs::Out::Any(Any::String(s))) => s.to_string(),
                            _ => String::new(),
                        };
                        let date = match run.get(&txn, "date") {
                            Some(yrs::Out::Any(Any::String(s))) => s.to_string(),
                            _ => String::new(),
                        };
                        text.push_str(&rtext);
                        runs.push(RunSnapshot {
                            kind,
                            text: rtext,
                            author,
                            date,
                        });
                    }
                }
            }
            paragraphs.push(ParagraphSnapshot { id, text, runs });
        }

        DocSnapshot {
            matter_id,
            title,
            paragraphs,
        }
    }

    /// Debug helper: the document body as real JSON (handy in the demo binary).
    pub fn body_json(&self) -> String {
        let txn = self.doc.transact();
        let any = self.body().to_json(&txn);
        let mut buf = String::new();
        any.to_json(&mut buf);
        buf
    }
}

/// Two replicas exchange exactly the deltas each is missing and merge them.
/// This is the entire "sync" — symmetric, single round-trip, no third party.
/// After this call (assuming no further edits) both replicas have converged.
pub fn sync_pair(a: &MatterDoc, b: &MatterDoc) {
    // Each side computes what the OTHER is missing relative to its own state.
    let a_sv = a.state_vector();
    let b_sv = b.state_vector();
    let a_to_b = a.diff_since(&b_sv); // ops A has that B lacks
    let b_to_a = b.diff_since(&a_sv); // ops B has that A lacks
    b.apply(&a_to_b);
    a.apply(&b_to_a);
}

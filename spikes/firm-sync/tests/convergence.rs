//! The PROOF: two Keepance replicas of a shared matter document make
//! concurrent, offline edits and converge to byte-identical state with NO
//! central coordinator. Each test isolates one property the WS-F gate demands.

use firm_sync::{sync_pair, MatterDoc, KIND_DEL, KIND_INS, KIND_TEXT};

const MATTER: &str = "matter-acme-7f3a"; // Spike-2 scope key

/// Helper: build two replicas that already share a base document (one paragraph),
/// then go offline. Returns (replica_a, replica_b, paragraph_id).
fn two_replicas_sharing_base() -> (MatterDoc, MatterDoc, String) {
    let a = MatterDoc::new("attorney-a", MATTER, "Acme — Master Services Agreement");
    let pid = a.append_paragraph("The term of this Agreement is one year.");
    // Second seat joins by replaying A's full state, then both edit offline.
    let b = MatterDoc::join("attorney-b", &a.full_state());
    (a, b, pid)
}

/// P1 — Baseline: a joiner replays full state and sees an identical document.
#[test]
fn p1_join_replays_identical_state() {
    let (a, b, _pid) = two_replicas_sharing_base();
    assert_eq!(
        a.snapshot(),
        b.snapshot(),
        "a fresh joiner must see byte-identical state after replaying full state"
    );
    assert_eq!(a.matter_id(), MATTER);
    assert_eq!(b.matter_id(), MATTER);
    // Distinct CRDT client ids => genuinely two replicas, not an alias.
    assert_ne!(a.client_id(), b.client_id());
}

/// P2 — THE CONFLICT CASE. Both replicas, while OFFLINE, insert different text
/// into the *same character position of the same paragraph*. Under naive
/// last-write-wins one edit would clobber the other (data loss). Under the CRDT
/// both insertions survive and BOTH replicas converge to the SAME merged text.
#[test]
fn p2_concurrent_same_paragraph_edit_converges_no_data_loss() {
    let (a, b, pid) = two_replicas_sharing_base();

    // Sanity: identical starting point.
    let base = "The term of this Agreement is one year.";
    assert_eq!(a.snapshot().paragraphs[0].text, base);
    assert_eq!(b.snapshot().paragraphs[0].text, base);

    // --- both edit the SAME paragraph while offline (no sync between them) ---
    // Attorney A inserts "renewable " before "one year" (at char index 30).
    let at = base.find("one year").unwrap() as u32;
    a.insert_text_in_paragraph(&pid, at, "renewable ");
    // Attorney B, concurrently, inserts " (the \"Initial Term\")" at end of the
    // sentence body — but crucially we make them collide at the SAME index too
    // to exercise the hardest path: B also inserts at the same `at`.
    b.insert_text_in_paragraph(&pid, at, "automatically ");

    // Pre-sync they diverge (each only has its own edit) — expected.
    assert_ne!(
        a.snapshot(),
        b.snapshot(),
        "before sync the two offline replicas must differ"
    );

    // --- exchange deltas and merge (single round-trip, no coordinator) ---
    sync_pair(&a, &b);

    // CONVERGENCE: identical state on both sides.
    let sa = a.snapshot();
    let sb = b.snapshot();
    assert_eq!(sa, sb, "replicas must converge to identical state after sync");

    // NO DATA LOSS: both authors' words are present in the merged paragraph.
    let merged = &sa.paragraphs[0].text;
    assert!(
        merged.contains("renewable"),
        "A's edit must survive the merge, got: {merged:?}"
    );
    assert!(
        merged.contains("automatically"),
        "B's edit must survive the merge, got: {merged:?}"
    );
    // And the untouched remainder is intact exactly once.
    assert!(merged.contains("one year."));
    assert_eq!(
        merged.matches("one year.").count(),
        1,
        "no duplication of untouched text, got: {merged:?}"
    );
}

/// P3 — Concurrent STRUCTURAL edits: A appends a paragraph while B appends a
/// different paragraph, both offline. Naive sync would have to pick one ordering
/// or drop one; the CRDT keeps BOTH and both replicas agree on the same order.
#[test]
fn p3_concurrent_structural_inserts_converge() {
    let (a, b, _pid) = two_replicas_sharing_base();

    a.append_paragraph("9. Governing Law: Delaware.");
    b.append_paragraph("10. Severability.");

    sync_pair(&a, &b);

    let sa = a.snapshot();
    let sb = b.snapshot();
    assert_eq!(sa, sb, "structural inserts must converge to one agreed order");
    // Base + both new paragraphs, no drops, no dupes.
    assert_eq!(sa.paragraphs.len(), 3, "all three paragraphs present");
    let texts: Vec<&str> = sa.paragraphs.iter().map(|p| p.text.as_str()).collect();
    assert!(texts.iter().any(|t| t.contains("Governing Law")));
    assert!(texts.iter().any(|t| t.contains("Severability")));
}

/// P4 — TRACKED CHANGES survive a concurrent merge WITH attribution intact
/// (the bonus the gate asks for). Each attorney adds their own tracked
/// insertion to the same paragraph offline; after merge both tracked runs exist,
/// each still attributed to its real author and date. This is the proof that
/// `Inline::Insertion { author, date }` from Spike 1 can be CRDT-backed.
#[test]
fn p4_tracked_changes_ride_the_crdt_with_attribution() {
    let (a, b, pid) = two_replicas_sharing_base();

    a.add_tracked_insertion(&pid, " This clause was added by counsel A.");
    b.add_tracked_deletion(&pid, "one year"); // B proposes deleting the term

    sync_pair(&a, &b);

    let sa = a.snapshot();
    let sb = b.snapshot();
    assert_eq!(sa, sb, "tracked-change runs must converge identically");

    let runs = &sa.paragraphs[0].runs;
    // The base text run + A's tracked insertion + B's tracked deletion.
    let ins = runs
        .iter()
        .find(|r| r.kind == KIND_INS)
        .expect("A's tracked insertion present after merge");
    let del = runs
        .iter()
        .find(|r| r.kind == KIND_DEL)
        .expect("B's tracked deletion present after merge");

    // Attribution survived the concurrent merge unchanged.
    assert_eq!(ins.author, "attorney-a", "insertion keeps A's authorship");
    assert!(ins.text.contains("counsel A"));
    assert!(!ins.date.is_empty(), "insertion keeps its date");

    assert_eq!(del.author, "attorney-b", "deletion keeps B's authorship");
    assert_eq!(del.text, "one year");
    assert!(!del.date.is_empty(), "deletion keeps its date");

    // The original plain run is still there and unattributed.
    let plain = runs.iter().find(|r| r.kind == KIND_TEXT).unwrap();
    assert!(plain.author.is_empty());
}

/// P5 — Merge is COMMUTATIVE and IDEMPOTENT and needs no coordinator: applying
/// updates in any order, and re-applying, lands on the same state. A third
/// replica that joins late and merges everyone's deltas converges too.
#[test]
fn p5_commutative_idempotent_no_coordinator() {
    let (a, b, pid) = two_replicas_sharing_base();
    a.insert_text_in_paragraph(&pid, 0, "[A] ");
    b.add_tracked_insertion(&pid, " [B tracked]");

    // Capture deltas BEFORE any sync (pure offline edits).
    let a_delta = a.diff_since(&b.state_vector());
    let b_delta = b.diff_since(&a.state_vector());

    // Replica C bootstraps from A's base full-state, then merges both deltas
    // in the "wrong" order (B before A) and twice (idempotency).
    let c = MatterDoc::join("attorney-c", &a.full_state());
    c.apply(&b_delta);
    c.apply(&a_delta);
    c.apply(&b_delta); // duplicate application — must be a no-op
    c.apply(&a_delta); // duplicate application — must be a no-op

    // Bring A and B together the normal way.
    sync_pair(&a, &b);

    // All three converge despite different merge orders / a late joiner.
    assert_eq!(a.snapshot(), b.snapshot(), "A and B converge");
    assert_eq!(
        a.snapshot(),
        c.snapshot(),
        "late joiner C converges to the same state regardless of merge order"
    );

    // The edits are present exactly once (idempotency: no doubled text).
    let merged = &c.snapshot().paragraphs[0].text;
    assert_eq!(merged.matches("[A] ").count(), 1, "got {merged:?}");
    assert_eq!(merged.matches("[B tracked]").count(), 1, "got {merged:?}");
}

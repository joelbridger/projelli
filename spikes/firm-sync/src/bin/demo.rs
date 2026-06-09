//! Deterministic demo of conflict-free convergence with NO central coordinator.
//!
//! Run: `cargo run --bin demo`
//!
//! Shows two attorneys editing the SAME paragraph of a shared matter document
//! while offline, then exchanging deltas and converging to identical state with
//! both edits preserved (the case that loses data under last-write-wins), plus a
//! tracked insertion that rides the CRDT with attribution intact.

use firm_sync::{sync_pair, MatterDoc};

fn rule(title: &str) {
    println!("\n=== {title} ===");
}

fn main() {
    let matter = "matter-acme-7f3a";

    rule("1. Two replicas share a base document (B joins by replaying A's state)");
    let a = MatterDoc::new("attorney-a", matter, "Acme — Master Services Agreement");
    let pid = a.append_paragraph("The term of this Agreement is one year.");
    let b = MatterDoc::join("attorney-b", &a.full_state());
    println!("matter_id (A) = {}", a.matter_id());
    println!("matter_id (B) = {}", b.matter_id());
    println!("A client_id = {}, B client_id = {}  (distinct replicas)", a.client_id(), b.client_id());
    println!("A == B at start? {}", a.snapshot() == b.snapshot());

    rule("2. BOTH edit the SAME paragraph, OFFLINE (no sync between them)");
    let base = "The term of this Agreement is one year.";
    let at = base.find("one year").unwrap() as u32;
    a.insert_text_in_paragraph(&pid, at, "renewable ");
    b.insert_text_in_paragraph(&pid, at, "automatically ");
    // B also proposes a tracked deletion, attributed to B.
    b.add_tracked_insertion(&pid, " (the \"Initial Term\")");
    println!("A sees: {:?}", a.snapshot().paragraphs[0].text);
    println!("B sees: {:?}", b.snapshot().paragraphs[0].text);
    println!("Diverged before sync? {}", a.snapshot() != b.snapshot());
    println!("(Under naive last-write-wins, one of these edits would be lost.)");

    rule("3. Exchange deltas and merge — single round-trip, NO coordinator");
    let a_to_b = a.diff_since(&b.state_vector());
    let b_to_a = b.diff_since(&a.state_vector());
    println!("delta A->B = {} bytes, delta B->A = {} bytes", a_to_b.len(), b_to_a.len());
    sync_pair(&a, &b);

    rule("4. CONVERGED");
    let sa = a.snapshot();
    let sb = b.snapshot();
    println!("A == B after sync? {}", sa == sb);
    println!("merged paragraph: {:?}", sa.paragraphs[0].text);
    println!("contains A's 'renewable'?     {}", sa.paragraphs[0].text.contains("renewable"));
    println!("contains B's 'automatically'? {}", sa.paragraphs[0].text.contains("automatically"));

    println!("\ntracked-change runs (attribution survived the merge):");
    for r in &sa.paragraphs[0].runs {
        if r.kind != "text" {
            println!("  [{}] author={:?} text={:?} date={}", r.kind, r.author, r.text, &r.date[..r.date.len().min(19)]);
        }
    }

    rule("5. Convergence proof");
    let converged = sa == sb;
    let no_loss = sa.paragraphs[0].text.contains("renewable")
        && sa.paragraphs[0].text.contains("automatically");
    println!("identical state on both replicas: {converged}");
    println!("no data loss (both edits present): {no_loss}");
    assert!(converged, "replicas did not converge");
    assert!(no_loss, "an edit was lost");
    println!("\nRESULT: PASS — conflict-free convergence with no central coordination.");
}

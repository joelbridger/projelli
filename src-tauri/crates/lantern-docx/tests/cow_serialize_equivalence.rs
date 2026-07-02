//! P2.3 row 10: the copy-on-write save path (`serialize::serialize_into_bytes`,
//! used by `OpenedDocument::save_bytes`) must be BYTE-FOR-BYTE identical to the
//! prior clone-based path (`serialize_into_package(..).write_to_bytes()`) across
//! every comment branch — comments unchanged, comments edited, and comments fully
//! removed. Byte-perfect preservation is the whole point of the DOCX engine, so
//! the optimization is only valid if it changes nothing observable.

use lantern_docx::fixture::{build_fixture_model, FIXTURE_COMMENT_ID};
use lantern_docx::package::Package;
use lantern_docx::serialize::{serialize_into_bytes, serialize_into_package};
use lantern_docx::{open_docx_bytes, serialize_docx_bytes, Document};

/// Fixture bytes carrying real styles + a comments.xml, opened into a package.
fn fixture_package() -> Package {
    let bytes = serialize_docx_bytes(&build_fixture_model()).expect("serialize fixture");
    open_docx_bytes(&bytes).expect("open").package
}

/// Assert the CoW path equals the clone path byte-for-byte for `doc` against
/// `original`.
fn assert_equivalent(doc: &Document, original: &Package) {
    let clone_path = serialize_into_package(doc, original)
        .expect("serialize_into_package")
        .write_to_bytes()
        .expect("write_to_bytes");
    let cow_path = serialize_into_bytes(doc, original).expect("serialize_into_bytes");
    assert_eq!(
        clone_path, cow_path,
        "CoW serialize must be byte-identical to clone+insert+write"
    );
}

#[test]
fn cow_equals_clone_comments_unchanged() {
    let original = fixture_package();
    // Re-open to get the exact DOM the package parsed to (comments unchanged).
    let doc = open_docx_bytes(&serialize_docx_bytes(&build_fixture_model()).unwrap())
        .unwrap()
        .document;
    assert_equivalent(&doc, &original);
}

#[test]
fn cow_preserves_large_binary_part_byte_for_byte() {
    // The whole point of CoW: a big unmodified part (e.g. an embedded image) is
    // streamed straight from the original, never cloned — and survives byte-for-
    // byte. Inject a 512 KiB "media" part, then confirm the hot-path save keeps it
    // identical AND equals the clone path.
    let mut original = fixture_package();
    let media: Vec<u8> = (0..512 * 1024).map(|i| (i % 251) as u8).collect();
    original
        .parts
        .insert("word/media/image1.png".to_string(), media.clone());

    let doc = open_docx_bytes(&serialize_docx_bytes(&build_fixture_model()).unwrap())
        .unwrap()
        .document;
    assert_equivalent(&doc, &original);

    // And the media round-trips unchanged through the CoW save.
    let out = serialize_into_bytes(&doc, &original).unwrap();
    let reopened = open_docx_bytes(&out).unwrap().package;
    assert_eq!(
        reopened.get("word/media/image1.png"),
        Some(media.as_slice()),
        "large binary part must survive CoW save byte-for-byte"
    );
}

/// P2.3 row 10 MEASUREMENT (ignored; run with
/// `cargo test -p lantern-docx --test cow_serialize_equivalence measure_cow -- --ignored --nocapture`).
/// Times the OLD clone-whole-package save against the NEW copy-on-write save on a
/// document carrying a few MB of embedded media (images/fonts) — the parts the
/// clone path duplicated on every autosave.
#[test]
#[ignore]
fn measure_cow_vs_clone_save() {
    use std::time::Instant;
    let mut original = fixture_package();
    // ~4 MiB of embedded media across a few parts (typical for a real letter with
    // a logo + a couple of scanned exhibits).
    for n in 0..4 {
        let media: Vec<u8> = (0..1024 * 1024).map(|i| ((i + n) % 251) as u8).collect();
        original
            .parts
            .insert(format!("word/media/image{n}.png"), media);
    }
    let doc = open_docx_bytes(&serialize_docx_bytes(&build_fixture_model()).unwrap())
        .unwrap()
        .document;

    const REPS: usize = 200;
    let t0 = Instant::now();
    for _ in 0..REPS {
        let _ = serialize_into_package(&doc, &original)
            .unwrap()
            .write_to_bytes()
            .unwrap();
    }
    let clone_dur = t0.elapsed();

    let t1 = Instant::now();
    for _ in 0..REPS {
        let _ = serialize_into_bytes(&doc, &original).unwrap();
    }
    let cow_dur = t1.elapsed();

    eprintln!(
        "[P2.3 row 10] {REPS}x save of a ~4 MiB-media doc: CLONE {clone_dur:?}  COW {cow_dur:?}  speedup {:.2}x",
        clone_dur.as_secs_f64() / cow_dur.as_secs_f64().max(1e-9)
    );
}

#[test]
fn cow_equals_clone_comments_edited() {
    let original = fixture_package();
    let mut doc = open_docx_bytes(&serialize_docx_bytes(&build_fixture_model()).unwrap())
        .unwrap()
        .document;
    // Edit the existing comment's text (the "changed AND non-empty" branch that
    // regenerates comments.xml — CoW falls back to the clone path here).
    if let Some(c) = doc.comments.get_mut(FIXTURE_COMMENT_ID) {
        c.text = "a different comment body".to_string();
        c.body_xml = None;
    }
    assert_equivalent(&doc, &original);
}

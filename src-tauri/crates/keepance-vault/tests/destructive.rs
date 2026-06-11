/// Integration tests for the vault orchestration layer (Task 6).
///
/// Destructive-failure spec §13 items 8 (escape-hatch roundtrip) and 9 (migration-resume).
/// These are integration tests (separate binary) so they can reference `keepance_vault` as an
/// external crate, exercising the public API exactly as the Tauri command layer will.
use keepance_vault::vault::*;
use std::fs;

/// Item 8: encrypt_all then decrypt_all yields byte-identical files; zero KPV1 magic remains.
/// Also verifies that the walk handles nested subdirectories (sub/b.bin).
#[test]
fn escape_hatch_roundtrip_is_byte_identical() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    // Set up three files, one in a subdirectory.
    let files: &[(&str, &[u8])] = &[
        ("a.txt", b"alpha"),
        ("sub/b.bin", &[0u8, 1, 2, 3, 255]),
        ("c.md", b"# hi"),
    ];
    for (rel, content) in files {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, content).unwrap();
    }

    let vmk = [5u8; 32];

    // --- encrypt pass ---
    encrypt_all(root, &vmk).unwrap();

    // Every file now starts with the KPV1 magic.
    for (rel, _) in files {
        let blob = fs::read(root.join(rel)).unwrap();
        assert_eq!(&blob[..4], b"KPV1", "{rel} must have KPV1 magic after encrypt_all");
    }

    // --- decrypt pass (escape hatch) ---
    decrypt_all(root, &vmk).unwrap();

    // Byte-identical to originals; no KPV1 magic remains.
    for (rel, content) in files {
        let got = fs::read(root.join(rel)).unwrap();
        assert_eq!(
            got.as_slice(),
            *content,
            "{rel} must be byte-identical to original after decrypt_all"
        );
        // Guard against empty files (none in this test, but defensive).
        if !got.is_empty() {
            assert_ne!(&got[..got.len().min(4)], b"KPV1", "{rel} must not have KPV1 magic after decrypt_all");
        }
    }
}

/// Item 9: files already encrypted before encrypt_all is called are skipped (magic guard,
/// never double-encrypted); a previously-encrypted file decrypts to its ORIGINAL content.
#[test]
fn migration_resume_never_double_encrypts() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    // Plain file — should be encrypted by encrypt_all.
    fs::write(root.join("x.txt"), b"plain").unwrap();

    let vmk = [6u8; 32];

    // Pre-encrypt ONE file to simulate a partially-completed migration.
    let pre = keepance_vault::format::encrypt_file(b"already", &vmk).unwrap();
    fs::write(root.join("y.txt"), &pre).unwrap();

    // encrypt_all must skip y.txt (has magic), encrypt x.txt.
    encrypt_all(root, &vmk).unwrap();

    // x.txt was plain → must now decrypt to "plain".
    assert_eq!(
        decrypt_file_at(root.join("x.txt"), &vmk).unwrap(),
        b"plain",
        "x.txt should have been encrypted then decrypt to 'plain'"
    );

    // y.txt was pre-encrypted → must still decrypt to "already" (NOT double-encrypted).
    assert_eq!(
        decrypt_file_at(root.join("y.txt"), &vmk).unwrap(),
        b"already",
        "y.txt must not be double-encrypted; it should still decrypt to 'already'"
    );
}

/// The walk skips .keepance-vault.json (metadata file) and .kpv-tmp-* (orphan temps).
/// After encrypt_all, these files must be unchanged (not encrypted).
#[test]
fn walk_skips_metadata_and_temp_files() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    // A normal file that SHOULD be encrypted.
    fs::write(root.join("doc.txt"), b"content").unwrap();

    // Metadata file — must be skipped by the walk.
    let meta_content = b"{\"version\":1}";
    fs::write(root.join(".keepance-vault.json"), meta_content).unwrap();

    // Orphan temp file — must be swept and not encrypted.
    // (sweep_temps removes these before visiting; the file won't exist after the walk.)
    let tmp_content = b"orphan temp bytes";
    fs::write(root.join(".kpv-tmp-doc.txt-0000000000000001"), tmp_content).unwrap();

    let vmk = [7u8; 32];
    encrypt_all(root, &vmk).unwrap();

    // doc.txt was encrypted.
    let doc_blob = fs::read(root.join("doc.txt")).unwrap();
    assert_eq!(&doc_blob[..4], b"KPV1", "doc.txt must be encrypted");

    // .keepance-vault.json is NOT encrypted (not touched by the walk).
    let meta_blob = fs::read(root.join(".keepance-vault.json")).unwrap();
    assert_eq!(
        meta_blob.as_slice(),
        meta_content,
        ".keepance-vault.json must not be encrypted by encrypt_all"
    );

    // The orphan temp was swept (removed) by sweep_temps, so it no longer exists.
    assert!(
        !root.join(".kpv-tmp-doc.txt-0000000000000001").exists(),
        ".kpv-tmp-* files must be swept (removed) during the walk"
    );
}

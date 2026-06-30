/// Integration tests for the vault orchestration layer (Task 6).
///
/// Destructive-failure spec §13 items 8 (escape-hatch roundtrip) and 9 (migration-resume).
/// These are integration tests (separate binary) so they can reference `lantern_vault` as an
/// external crate, exercising the public API exactly as the Tauri command layer will.
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use lantern_vault::vault::*;
use std::fs;

const TEST_ESCROW_AAD_PREFIX: &str = "keepance-vault-test-admin-escrow:v1:epoch:";
const TEST_ESCROW_NONCE_LEN: usize = 12;
const TEST_ESCROW_TAG_LEN: usize = 16;

fn test_escrow_aad(epoch: u32) -> String {
    format!("{TEST_ESCROW_AAD_PREFIX}{epoch}")
}

fn wrap_vmk_for_test_admin_escrow(
    vmk: &[u8; 32],
    admin_escrow_key: &[u8; 32],
    epoch: u32,
) -> String {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(admin_escrow_key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let aad = test_escrow_aad(epoch);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: vmk.as_slice(),
                aad: aad.as_bytes(),
            },
        )
        .expect("test admin escrow wrap should encrypt");

    let mut wrapped = Vec::with_capacity(TEST_ESCROW_NONCE_LEN + ciphertext.len());
    wrapped.extend_from_slice(&nonce);
    wrapped.extend_from_slice(&ciphertext);
    BASE64.encode(wrapped)
}

fn unwrap_vmk_from_test_admin_escrow(
    wrapped_b64: &str,
    admin_escrow_key: &[u8; 32],
    epoch: u32,
) -> [u8; 32] {
    let wrapped = BASE64
        .decode(wrapped_b64)
        .expect("test admin escrow wrap should be valid base64");
    assert!(
        wrapped.len() >= TEST_ESCROW_NONCE_LEN + TEST_ESCROW_TAG_LEN,
        "test admin escrow wrap must contain nonce + GCM tag"
    );

    let (nonce_bytes, ciphertext) = wrapped.split_at(TEST_ESCROW_NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(admin_escrow_key));
    let aad = test_escrow_aad(epoch);
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(nonce_bytes),
            Payload {
                msg: ciphertext,
                aad: aad.as_bytes(),
            },
        )
        .expect("test admin escrow key should unwrap the VMK");

    assert_eq!(plaintext.len(), 32, "admin escrow must recover a 32-byte VMK");
    let mut vmk = [0u8; 32];
    vmk.copy_from_slice(&plaintext);
    vmk
}

/// DATA-LOSS GUARD: encrypt_all/decrypt_all must NEVER touch the `.lantern/` internal
/// store dir (LanceDB index, SQLCipher mail/audit DBs, encrypted mail blobs) — those are
/// read raw by other subsystems and KPV1-wrapping them would corrupt them irrecoverably.
#[test]
fn walk_never_touches_keepance_internal_dir() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join(".lantern/vectors")).unwrap();
    fs::create_dir_all(root.join(".lantern/mail/blobs")).unwrap();
    fs::write(root.join(".lantern/vectors/data.lance"), b"LANCE-RAW-BYTES").unwrap();
    fs::write(root.join(".lantern/mail-enc.db"), b"SQLCIPHER-RAW").unwrap();
    fs::write(root.join(".lantern/mail/blobs/m1.enc"), b"AES-GCM-BLOB").unwrap();
    fs::write(root.join("doc.txt"), b"user doc").unwrap();

    let vmk = [5u8; 32];
    encrypt_all(root, &vmk).unwrap();

    // The user's document IS encrypted...
    assert_eq!(&fs::read(root.join("doc.txt")).unwrap()[..4], b"KPV1");
    // ...but every .lantern internal file is byte-for-byte untouched (no KPV1 magic).
    assert_eq!(fs::read(root.join(".lantern/vectors/data.lance")).unwrap(), b"LANCE-RAW-BYTES");
    assert_eq!(fs::read(root.join(".lantern/mail-enc.db")).unwrap(), b"SQLCIPHER-RAW");
    assert_eq!(fs::read(root.join(".lantern/mail/blobs/m1.enc")).unwrap(), b"AES-GCM-BLOB");

    // decrypt_all (escape hatch) also leaves them alone.
    decrypt_all(root, &vmk).unwrap();
    assert_eq!(fs::read(root.join(".lantern/mail-enc.db")).unwrap(), b"SQLCIPHER-RAW");
    assert_eq!(fs::read(root.join(".lantern/vectors/data.lance")).unwrap(), b"LANCE-RAW-BYTES");
}

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
    let pre = lantern_vault::format::encrypt_file(b"already", &vmk).unwrap();
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

/// The walk skips .lantern-vault.json (metadata file) and .kpv-tmp-* (orphan temps).
/// After encrypt_all, these files must be unchanged (not encrypted).
#[test]
fn walk_skips_metadata_and_temp_files() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    // A normal file that SHOULD be encrypted.
    fs::write(root.join("doc.txt"), b"content").unwrap();

    // Metadata file — must be skipped by the walk.
    let meta_content = b"{\"version\":1}";
    fs::write(root.join(".lantern-vault.json"), meta_content).unwrap();

    // Orphan temp file — must be swept and not encrypted.
    // (sweep_temps removes these before visiting; the file won't exist after the walk.)
    let tmp_content = b"orphan temp bytes";
    fs::write(root.join(".kpv-tmp-doc.txt-0000000000000001"), tmp_content).unwrap();

    let vmk = [7u8; 32];
    encrypt_all(root, &vmk).unwrap();

    // doc.txt was encrypted.
    let doc_blob = fs::read(root.join("doc.txt")).unwrap();
    assert_eq!(&doc_blob[..4], b"KPV1", "doc.txt must be encrypted");

    // .lantern-vault.json is NOT encrypted (not touched by the walk).
    let meta_blob = fs::read(root.join(".lantern-vault.json")).unwrap();
    assert_eq!(
        meta_blob.as_slice(),
        meta_content,
        ".lantern-vault.json must not be encrypted by encrypt_all"
    );

    // The orphan temp was swept (removed) by sweep_temps, so it no longer exists.
    assert!(
        !root.join(".kpv-tmp-doc.txt-0000000000000001").exists(),
        ".kpv-tmp-* files must be swept (removed) during the walk"
    );
}

/// TEST-004: firm-admin escrow can recover an encrypted vault after the local VMK
/// is lost, without using the 24-word recovery phrase.
#[test]
fn escrow_recovery_decrypts_vault_without_recovery_phrase() {
    use lantern_vault::{
        metadata::{AdminWrapJson, EscrowJson, RecoveryWrapJson, VaultMetadata},
        recovery::create_recovery,
        verifier::{check_verifier, make_verifier},
    };

    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let doc_path = root.join("client-strategy.txt");
    let original_doc = b"Privileged memo: settlement floor is $425,000.";
    fs::write(&doc_path, original_doc).unwrap();

    let admin_escrow_key = [0xA5u8; 32];
    let epoch = 7;

    {
        let vmk = [0x31u8; 32];
        let (_unused_recovery_phrase, recovery_wrap) = create_recovery(&vmk).unwrap();
        let verifier_bytes = make_verifier(&vmk).unwrap();

        encrypt_all(root, &vmk).unwrap();
        assert_eq!(
            &fs::read(&doc_path).unwrap()[..4],
            b"KPV1",
            "document must be encrypted before recovery"
        );

        let admin_wrap = AdminWrapJson {
            user_id: "firm-admin-1".into(),
            device_id: "admin-device-1".into(),
            wrapped_b64: wrap_vmk_for_test_admin_escrow(&vmk, &admin_escrow_key, epoch),
        };
        let metadata = VaultMetadata {
            version: 1,
            vault_id: "test-004-escrow-recovery".into(),
            created_at: "2026-06-22T00:00:00Z".into(),
            recovery: RecoveryWrapJson::from_wrap(&recovery_wrap),
            verifier_b64: BASE64.encode(&verifier_bytes),
            escrow: Some(EscrowJson {
                epoch,
                admin_wraps: vec![admin_wrap],
            }),
        };
        metadata.write_to(root).unwrap();
    }

    let metadata = VaultMetadata::read_from(root).unwrap();
    let escrow = metadata.escrow.expect("escrow metadata must be provisioned");
    assert_eq!(escrow.admin_wraps.len(), 1);

    let recovered_vmk = unwrap_vmk_from_test_admin_escrow(
        &escrow.admin_wraps[0].wrapped_b64,
        &admin_escrow_key,
        escrow.epoch,
    );
    let verifier_bytes = BASE64.decode(metadata.verifier_b64).unwrap();
    assert!(
        check_verifier(&verifier_bytes, &recovered_vmk),
        "admin-escrow-recovered VMK must pass the vault verifier"
    );

    assert_eq!(
        decrypt_file_at(&doc_path, &recovered_vmk).unwrap(),
        original_doc,
        "admin escrow recovery must decrypt the original document bytes"
    );

    decrypt_all(root, &recovered_vmk).unwrap();
    assert_eq!(
        fs::read(&doc_path).unwrap(),
        original_doc,
        "admin escrow recovery must restore the vaulted file intact"
    );
}

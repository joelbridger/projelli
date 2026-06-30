use lantern_lib::commands::mail::crypto::decrypt_with_key;
use lantern_lib::commands::rag::embedder::{self, EMBEDDING_DIM};
use lantern_lib::commands::rag::model_download;
use lantern_lib::commands::rag::store::{self, PRIVILEGE_NONE};
use lantern_lib::commands::rag::{
    index_downloaded_document_bytes, DownloadedDocumentIndexOutcome,
};
use std::sync::atomic::AtomicBool;

const VEC_KEY: [u8; 32] = [0x6Bu8; 32];
const ONEDRIVE_MATTER: &str = "matter-b-acme";
const SOURCE_ID: &str = "onedrive:drive-demo:item-intake-memo";

fn model_is_provisioned() -> bool {
    model_download::model_files_cached(&embedder::resolve_cache_dir())
}

fn skip_without_model() -> bool {
    if model_is_provisioned() {
        return false;
    }
    if std::env::var("REQUIRE_RAG_MODEL")
        .ok()
        .filter(|v| !v.is_empty())
        .is_some()
    {
        panic!(
            "REQUIRE_RAG_MODEL set but e5-small cache missing; refusing to skip OneDrive import test"
        );
    }
    eprintln!("SKIP onedrive_fixture_import: e5-small model cache not provisioned");
    true
}

fn decrypted_hit_path(hit: &store::StoredHit) -> String {
    let path_enc = hit
        .path_enc
        .as_deref()
        .expect("OneDrive hit should carry path_enc");
    let blob = hex::decode(path_enc).expect("path_enc should be hex");
    String::from_utf8(decrypt_with_key(&blob, &VEC_KEY).expect("decrypt path_enc"))
        .expect("path_enc should decrypt to UTF-8")
}

fn decrypted_hit_text(hit: &store::StoredHit) -> String {
    let blob = hex::decode(&hit.text).expect("hit text should be hex ciphertext");
    String::from_utf8(decrypt_with_key(&blob, &VEC_KEY).expect("decrypt hit text"))
        .expect("hit text should decrypt to UTF-8")
}

#[tokio::test]
async fn downloaded_docx_indexes_as_encrypted_onedrive_chunk() {
    if skip_without_model() {
        return;
    }

    let fixture = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/matter-corpus/matter-b-acme/intake-memo-acme.docx"
    );
    let bytes = std::fs::read(fixture).expect("read OneDrive docx fixture");
    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let conn = store::open_connection(workspace.path())
        .await
        .expect("open vector store");
    let table = store::open_or_create_table(&conn)
        .await
        .expect("open chunks table");

    let outcome = index_downloaded_document_bytes(
        &table,
        SOURCE_ID,
        "intake-memo-acme.docx",
        &bytes,
        ONEDRIVE_MATTER,
        PRIVILEGE_NONE,
        &VEC_KEY,
        Some(&AtomicBool::new(false)),
    )
    .await
    .expect("index downloaded docx");

    match outcome {
        DownloadedDocumentIndexOutcome::Indexed(n) => assert!(n > 0),
        other => panic!("docx fixture should index, got {other:?}"),
    }

    let hits = store::nearest(
        &table,
        &vec![0.1f32; EMBEDDING_DIM],
        10,
        Some(ONEDRIVE_MATTER),
        false,
        &[],
    )
    .await
    .expect("vector search");

    let hit = hits
        .iter()
        .find(|hit| decrypted_hit_path(hit) == SOURCE_ID)
        .expect("vector search should surface the imported OneDrive chunk");

    assert_eq!(hit.source_type.as_deref(), Some("onedrive"));
    assert_eq!(hit.matter_id.as_deref(), Some(ONEDRIVE_MATTER));
    assert!(hit.encrypted, "OneDrive chunk text must be encrypted");
    let decrypted = decrypted_hit_text(hit);
    assert!(
        decrypted.contains("Acme") || decrypted.contains("intake"),
        "decrypted hit text should contain content from the docx fixture; got: {decrypted:?}"
    );
}

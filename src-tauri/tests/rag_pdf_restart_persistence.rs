//! Finding #19 — model-free restart proof for PDF search persistence.
//!
//! The saved manifest and LanceDB rows are written, all handles are dropped to
//! model an app exit, and the bulk planner reopens the workspace. Unchanged
//! PDFs must produce no work; changing one file must produce exactly one item.

use std::collections::HashSet;

use lantern_lib::commands::rag::{
    chunker::chunk_text,
    crypto,
    embedder::EMBEDDING_DIM,
    forget_pdf_receipt, manifest, plan_pdf_index_for_workspace,
    store::{self, SourceType},
};

const TEST_KEY: [u8; 32] = [0x19; 32];

fn saved_pdf_signature(
    path: &std::path::Path,
    intentionally_empty: bool,
) -> manifest::SourceSignature {
    let (size, mtime_ns) = manifest::stat_signature(path).expect("fixture stat");
    manifest::SourceSignature {
        size,
        mtime_ns,
        hash: None,
        extractor_version: manifest::EXTRACTOR_VERSION,
        chunker_version: manifest::CHUNKER_VERSION,
        embedder_version: manifest::EMBEDDER_VERSION.to_string(),
        pdf: Some(manifest::PdfSignature {
            pdf_extractor_version: manifest::PDF_EXTRACTOR_VERSION,
            ocr_enabled: true,
            ocr_version: manifest::OCR_VERSION,
            page_count: 1,
            empty_index: intentionally_empty,
        }),
        matter_id: store::UNASSIGNED_MATTER.to_string(),
        privilege: store::PRIVILEGE_NONE.to_string(),
        row_count: u32::from(!intentionally_empty),
        indexed_at: 1,
    }
}

#[tokio::test]
async fn pdf_index_survives_restart_and_only_changed_files_are_planned() {
    let temp = tempfile::TempDir::new().expect("temp workspace");
    let root = temp.path();
    let first = root.join("statement.pdf");
    let second = root.join("tax-return.pdf");
    std::fs::write(&first, b"saved PDF fixture one").expect("write first fixture");
    std::fs::write(&second, b"saved PDF fixture two").expect("write second fixture");

    let conn = store::open_connection(root)
        .await
        .expect("open saved store");
    let table = store::open_or_create_table(&conn)
        .await
        .expect("open saved chunks table");
    let mut saved_manifest = manifest::Manifest::new(store::INDEX_VERSION);

    for (index, path) in [&first, &second].into_iter().enumerate() {
        let path_string = path.to_string_lossy().to_string();
        let intentionally_empty = index == 1;
        if !intentionally_empty {
            let chunks = chunk_text(&path_string, "Extracted PDF text that remains searchable.");
            let rows = chunks
                .into_iter()
                .map(|chunk| (chunk, vec![0.19; EMBEDDING_DIM]))
                .collect();
            store::upsert_chunks_for_path(
                &table,
                &path_string,
                rows,
                SourceType::Pdf { page_number: 1 },
                store::UNASSIGNED_MATTER,
                store::PRIVILEGE_NONE,
                &TEST_KEY,
            )
            .await
            .expect("persist PDF rows");
        }

        saved_manifest.insert(
            crypto::path_token(&TEST_KEY, &path_string),
            saved_pdf_signature(path, intentionally_empty),
        );
    }
    manifest::save(root, &saved_manifest).expect("persist PDF manifest");

    // Simulate the process closing. The next calls must reopen the saved files,
    // not rely on either handle or any in-memory progress state above.
    drop(table);
    drop(conn);
    assert!(manifest::manifest_path(root).is_file());
    assert!(store::dataset_path(root).is_dir());

    let paths = vec![
        first.to_string_lossy().to_string(),
        second.to_string_lossy().to_string(),
    ];
    let no_work =
        plan_pdf_index_for_workspace(root, paths.clone(), true, false, &HashSet::new(), &TEST_KEY)
            .await
            .expect("plan unchanged restart");
    assert!(no_work.is_empty(), "unchanged restart must rebuild nothing");

    std::fs::write(&second, b"saved PDF fixture two changed after restart")
        .expect("change second fixture");
    let changed =
        plan_pdf_index_for_workspace(root, paths, true, false, &HashSet::new(), &TEST_KEY)
            .await
            .expect("plan changed restart");
    assert_eq!(
        changed,
        vec![second.to_string_lossy().to_string()],
        "only the changed PDF should be rebuilt",
    );
}

#[tokio::test]
async fn intentionally_empty_pdf_stays_quiet_even_when_no_chunks_table_exists() {
    let temp = tempfile::TempDir::new().expect("temp workspace");
    let root = temp.path();
    let encrypted = root.join("encrypted.pdf");
    std::fs::write(&encrypted, b"encrypted PDF fixture").expect("write fixture");
    let path = encrypted.to_string_lossy().to_string();

    let mut saved_manifest = manifest::Manifest::new(store::INDEX_VERSION);
    saved_manifest.insert(
        crypto::path_token(&TEST_KEY, &path),
        saved_pdf_signature(&encrypted, true),
    );
    manifest::save(root, &saved_manifest).expect("persist empty PDF receipt");

    let work =
        plan_pdf_index_for_workspace(root, vec![path], true, false, &HashSet::new(), &TEST_KEY)
            .await
            .expect("plan empty-only restart");
    assert!(
        work.is_empty(),
        "saved empty PDF must not repeat every launch"
    );
}

#[tokio::test]
async fn empty_receipt_does_not_hide_rows_left_under_an_old_client_scope() {
    let temp = tempfile::TempDir::new().expect("temp workspace");
    let root = temp.path();
    let pdf = root.join("moved-client.pdf");
    std::fs::write(&pdf, b"encrypted after client move").expect("write fixture");
    let path = pdf.to_string_lossy().to_string();

    let conn = store::open_connection(root).await.expect("open store");
    let table = store::open_or_create_table(&conn)
        .await
        .expect("open table");
    let rows = chunk_text(&path, "stale text under the former client")
        .into_iter()
        .map(|chunk| (chunk, vec![0.19; EMBEDDING_DIM]))
        .collect();
    store::upsert_chunks_for_path(
        &table,
        &path,
        rows,
        SourceType::Pdf { page_number: 1 },
        "old-client",
        store::PRIVILEGE_NONE,
        &TEST_KEY,
    )
    .await
    .expect("persist stale old-client rows");

    let mut receipt = saved_pdf_signature(&pdf, true);
    receipt.matter_id = "new-client".to_string();
    let mut saved_manifest = manifest::Manifest::new(store::INDEX_VERSION);
    saved_manifest.insert(crypto::path_token(&TEST_KEY, &path), receipt);
    manifest::save(root, &saved_manifest).expect("persist empty receipt");

    drop(table);
    drop(conn);
    let work = plan_pdf_index_for_workspace(
        root,
        vec![path.clone()],
        true,
        false,
        &HashSet::new(),
        &TEST_KEY,
    )
    .await
    .expect("plan stale-scope restart");
    assert_eq!(
        work,
        vec![path],
        "stale rows in any scope must force healing"
    );
}

#[tokio::test]
async fn incomplete_ocr_retry_forgets_an_old_receipt_even_when_native_rows_survive() {
    let temp = tempfile::TempDir::new().expect("temp workspace");
    let root = temp.path();
    let pdf = root.join("mixed-native-and-scan.pdf");
    std::fs::write(&pdf, b"mixed PDF fixture").expect("write fixture");
    let path = pdf.to_string_lossy().to_string();

    let conn = store::open_connection(root).await.expect("open store");
    let table = store::open_or_create_table(&conn)
        .await
        .expect("open table");
    let rows = chunk_text(&path, "native page recovered while scanned page OCR failed")
        .into_iter()
        .map(|chunk| (chunk, vec![0.19; EMBEDDING_DIM]))
        .collect();
    store::upsert_chunks_for_path(
        &table,
        &path,
        rows,
        SourceType::Pdf { page_number: 1 },
        store::UNASSIGNED_MATTER,
        store::PRIVILEGE_NONE,
        &TEST_KEY,
    )
    .await
    .expect("persist partial native rows");

    let mut saved_manifest = manifest::Manifest::new(store::INDEX_VERSION);
    saved_manifest.insert(
        crypto::path_token(&TEST_KEY, &path),
        saved_pdf_signature(&pdf, false),
    );
    manifest::save(root, &saved_manifest).expect("persist old complete receipt");

    assert!(forget_pdf_receipt(root, &path, &TEST_KEY).expect("forget old receipt"));
    drop(table);
    drop(conn);

    let work = plan_pdf_index_for_workspace(
        root,
        vec![path.clone()],
        true,
        false,
        &HashSet::new(),
        &TEST_KEY,
    )
    .await
    .expect("plan retry after incomplete OCR");
    assert_eq!(
        work,
        vec![path],
        "partial native rows must not hide an OCR page that still needs retrying",
    );
}

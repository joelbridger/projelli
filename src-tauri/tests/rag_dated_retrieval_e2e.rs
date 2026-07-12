//! B1 honest retrieval seam: this drives the real `rag_retrieve` command over
//! an encrypted temporary mail + CRM store. The companion TypeScript binding
//! test consumes the same camelCase result shape through Ask citations, saved
//! conversation reload, and rendering.

use arrow_array::RecordBatchIterator;
use lantern_lib::commands::crm::store::CrmStore;
use lantern_lib::commands::mail::store::{EncryptedMailStore, MailRecord, MailStore};
use lantern_lib::commands::rag::chunker::{chunk_text, Chunk};
use lantern_lib::commands::rag::embedder::embed_documents_batched;
use lantern_lib::commands::rag::store::{self, PRIVILEGE_NONE};
use lantern_lib::commands::rag::{rag_retrieve, RagState, RetrievalScope};
use std::sync::Once;
use tauri::Manager;

const MATTER_ID: &str = "jordan";
const MAIL_KEY: [u8; 32] = [0x11; 32];
const CRM_KEY: [u8; 32] = [0x33; 32];
const VECTOR_KEY: [u8; 32] = [0x22; 32];

static HEADLESS_KEYS: Once = Once::new();

fn configure_headless_keys() {
    HEADLESS_KEYS.call_once(|| {
        std::env::set_var(
            "LANTERN_HEADLESS_TEST_MAIL_MASTER_KEY_HEX",
            hex::encode(MAIL_KEY),
        );
        std::env::set_var(
            "LANTERN_HEADLESS_TEST_CRM_MASTER_KEY_HEX",
            hex::encode(CRM_KEY),
        );
        std::env::set_var(
            "LANTERN_HEADLESS_TEST_VECTORS_MASTER_KEY_HEX",
            hex::encode(VECTOR_KEY),
        );
    });
}

fn mail_record(id: &str, received_date_time: &str) -> MailRecord {
    MailRecord {
        id: id.to_string(),
        folder_id: "inbox".to_string(),
        // These two rows are imported copies of ONE mail record. Their matching
        // Internet message id is the only production identity that can produce
        // a timestamp-copy warning; this is deliberately not a policy-vs-email
        // comparison of an extracted business fact.
        internet_message_id: Some("<jordan-review@example.test>".to_string()),
        relative_path: format!(".lantern/mail/blobs/{id}.enc"),
        received_date_time: Some(received_date_time.to_string()),
        provider: "m365".to_string(),
        account: "advisor@example.test".to_string(),
        subject: "Jordan review chronology".to_string(),
        from_addr: "advisor@example.test".to_string(),
        from_name: "Advisor".to_string(),
        snippet: "Jordan review chronology".to_string(),
        has_attachments: false,
        thread_id: None,
        auth_result: Default::default(),
        attachment_refs: Vec::new(),
        attachments_unsupported: false,
    }
}

async fn embedded_rows(path: &str, text: &str) -> Vec<(Chunk, Vec<f32>)> {
    let chunks = chunk_text(path, text);
    assert!(
        !chunks.is_empty(),
        "fixture source must produce a RAG chunk"
    );
    let texts: Vec<String> = chunks.iter().map(|chunk| chunk.text.clone()).collect();
    let vectors = embed_documents_batched(&texts, None)
        .await
        .expect("embed fixture chunks")
        .expect("fixture chunks must have embeddings");
    chunks.into_iter().zip(vectors).collect()
}

async fn add_mail(table: &lancedb::Table, id: &str, text: &str) {
    let rows = embedded_rows(&format!("mail:{id}"), text).await;
    let batch = store::build_batch_mail(&rows, &VECTOR_KEY, MATTER_ID, PRIVILEGE_NONE)
        .expect("build encrypted mail batch");
    let schema = batch.schema();
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .expect("add mail RAG chunks");
}

async fn add_crm(table: &lancedb::Table, text: &str) {
    let rows = embedded_rows("crm:note:42", text).await;
    let batch = store::build_batch_crm(&rows, &VECTOR_KEY, MATTER_ID, PRIVILEGE_NONE)
        .expect("build encrypted CRM batch");
    let schema = batch.schema();
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .expect("add CRM RAG chunks");
}

#[tokio::test]
async fn rag_retrieve_carries_real_mail_and_crm_dates_to_citable_hits() {
    configure_headless_keys();
    let workspace = tempfile::tempdir().expect("temporary workspace");
    let ws = workspace.path();

    let mail = EncryptedMailStore::open_with_key(ws, &MAIL_KEY).expect("open encrypted mail store");
    mail.upsert(&mail_record("mail-copy-older", "2026-07-10T14:30:00Z"))
        .expect("save older mail copy");
    mail.upsert(&mail_record("mail-copy-newer", "2026-07-11T14:30:00Z"))
        .expect("save newer mail copy");
    drop(mail);

    let crm = CrmStore::open_with_key(ws, &CRM_KEY).expect("open encrypted CRM store");
    crm.upsert_object(
        "note:42",
        "note",
        "household:42",
        "2026-07-12T14:30:00Z",
        "jordan-review-note-v1",
        r#"{"id":"42","createdAt":"2026-07-09T14:30:00Z","updatedAt":"2026-07-12T14:30:00Z"}"#,
    )
    .expect("save CRM note");
    drop(crm);

    let connection = store::open_connection(ws).await.expect("open vector store");
    let table = store::open_or_create_table(&connection)
        .await
        .expect("open chunks table");
    add_mail(
        &table,
        "mail-copy-older",
        "Jordan review chronology: inbox copy.",
    )
    .await;
    add_mail(
        &table,
        "mail-copy-newer",
        "Jordan review chronology: archive copy.",
    )
    .await;
    add_crm(&table, "Jordan review chronology: CRM note is complete.").await;

    let app = tauri::test::mock_builder()
        .manage(RagState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("test app");
    {
        let state = app.state::<RagState>();
        *state.workspace_root.lock().await = Some(ws.to_path_buf());
    }

    // This is the production command, not a direct store query. It embeds the
    // query, retrieves the encrypted chunks, reads both real local stores, and
    // attaches the IPC fields the Ask citation binder persists.
    let hits = rag_retrieve(
        app.state::<RagState>(),
        "Jordan review chronology".to_string(),
        10,
        RetrievalScope::Matter {
            matter_id: MATTER_ID.to_string(),
        },
        None,
        None,
        None,
        None,
    )
    .await
    .expect("rag_retrieve must return citable hits");

    let older = hits
        .iter()
        .find(|hit| hit.source_id.as_deref() == Some("mail:mail-copy-older"))
        .expect("older mail copy retrieved");
    let newer = hits
        .iter()
        .find(|hit| hit.source_id.as_deref() == Some("mail:mail-copy-newer"))
        .expect("newer mail copy retrieved");
    let crm = hits
        .iter()
        .find(|hit| hit.source_id.as_deref() == Some("crm:note:42"))
        .expect("CRM note retrieved");

    assert_eq!(
        older
            .source_date
            .as_ref()
            .and_then(|date| date.value.as_deref()),
        Some("2026-07-10T14:30:00.000Z")
    );
    assert_eq!(
        older.dated_fact.as_ref().map(|fact| fact.key.as_str()),
        Some("mail-message:<jordan-review@example.test>:received-date")
    );
    assert_eq!(
        newer
            .source_date
            .as_ref()
            .and_then(|date| date.value.as_deref()),
        Some("2026-07-11T14:30:00.000Z")
    );
    assert!(
        older.date_conflict.is_some() && newer.date_conflict.is_some(),
        "only matching copies of one mail record receive the timestamp warning"
    );
    assert_eq!(
        crm.source_date
            .as_ref()
            .and_then(|date| date.value.as_deref()),
        Some("2026-07-12T14:30:00.000Z")
    );
    assert_eq!(
        crm.dated_fact.as_ref().map(|fact| fact.key.as_str()),
        Some("crm-record:note:42:updated-date")
    );
    assert_eq!(
        crm.date_conflict, None,
        "a distinct CRM record is not treated as a timestamp-copy warning"
    );

    // The frontend receives camelCase over IPC. Keep the bridge honest: these
    // are exactly the fields the companion binding/reload/render test uses.
    let wire = serde_json::to_value(&hits).expect("serialize retrieval hits");
    let older_wire = wire
        .as_array()
        .and_then(|rows| {
            rows.iter().find(|row| {
                row.get("sourceId").and_then(serde_json::Value::as_str)
                    == Some("mail:mail-copy-older")
            })
        })
        .expect("older copy on IPC wire");
    assert_eq!(
        older_wire
            .pointer("/sourceDate/kind")
            .and_then(serde_json::Value::as_str),
        Some("received")
    );
    assert_eq!(
        older_wire
            .pointer("/datedFact/key")
            .and_then(serde_json::Value::as_str),
        Some("mail-message:<jordan-review@example.test>:received-date")
    );
    assert!(
        older_wire.get("dateConflict").is_some(),
        "timestamp-copy warning crosses IPC with the citable hit"
    );
}

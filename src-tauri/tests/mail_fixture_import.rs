use arrow_array::RecordBatchIterator;
use lantern_lib::commands::mail::model::{BodyContentType, MailMessage, Recipient};
use lantern_lib::commands::mail::store::{EncryptedMailStore, MailListQuery, MailStore};
use lantern_lib::commands::mail::sync::apply_messages_enc;
use lantern_lib::commands::rag::chunker::chunk_text;
use lantern_lib::commands::rag::embedder::EMBEDDING_DIM;
use lantern_lib::commands::rag::store::{self, PRIVILEGE_NONE};
use std::sync::{Arc, Mutex};

const MAIL_KEY: [u8; 32] = [0x42u8; 32];
const VEC_KEY: [u8; 32] = [0x5Au8; 32];
const FOLDER_MATTER: &str = "matter-inbox-default";
const FILED_MATTER: &str = "matter-acme-litigation";

fn default_query() -> MailListQuery {
    MailListQuery {
        keyword: None,
        folder_id: None,
        provider: None,
        account: None,
        date_from: None,
        date_to: None,
        has_attachments: None,
        sort_by: "date".into(),
        sort_desc: true,
        limit: 50,
        offset: 0,
    }
}

fn fixture_message() -> MailMessage {
    MailMessage {
        id: "test-002-fixture-message".into(),
        conversation_id: Some("test-002-thread".into()),
        internet_message_id: Some("<test-002-fixture@example.test>".into()),
        subject: "Zephyr retainer escrow instructions".into(),
        received_date_time: Some("2026-06-22T12:34:56Z".into()),
        from_name: Some("Avery Client".into()),
        from_address: Some("avery.client@example.test".into()),
        to: vec![Recipient {
            name: Some("Priya Lawyer".into()),
            address: Some("priya@firm.example".into()),
        }],
        cc: vec![],
        folders: vec!["inbox".into()],
        thread_id: Some("test-002-thread".into()),
        provider: "m365".into(),
        account: "legal@example.test".into(),
        has_attachments: false,
        attachments_unsupported: false,
        auth_result: Default::default(),
        attachments: Vec::new(),
        body_content_type: BodyContentType::Text,
        body_text: "Wire the Zephyr retainer to the client trust account ending 4477 before Friday."
            .into(),
    }
}

async fn index_mail_entry(
    table: &lancedb::Table,
    message_id: &str,
    markdown: &str,
    matter_id: &str,
) {
    let path = format!("mail:{message_id}");
    let chunks = chunk_text(&path, markdown);
    assert!(
        !chunks.is_empty(),
        "fixture mail should produce at least one chunk"
    );
    let rows: Vec<_> = chunks
        .into_iter()
        .map(|chunk| (chunk, vec![0.1f32; EMBEDDING_DIM]))
        .collect();
    let batch = store::build_batch_mail(&rows, &VEC_KEY, matter_id, PRIVILEGE_NONE)
        .expect("build mail batch");
    let schema = batch.schema();
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .expect("add fixture mail chunk");
}

fn decrypted_hit_path(hit: &store::StoredHit) -> String {
    let path_enc = hit.path_enc.as_deref().expect("mail hit should carry path_enc");
    let blob = hex::decode(path_enc).expect("path_enc should be hex");
    String::from_utf8(
        lantern_lib::commands::mail::crypto::decrypt_with_key(&blob, &VEC_KEY)
            .expect("decrypt path_enc"),
    )
    .expect("path_enc should decrypt to UTF-8")
}

fn decrypted_hit_text(hit: &store::StoredHit) -> String {
    let blob = hex::decode(&hit.text).expect("mail hit text should be hex ciphertext");
    String::from_utf8(
        lantern_lib::commands::mail::crypto::decrypt_with_key(&blob, &VEC_KEY)
            .expect("decrypt hit text"),
    )
    .expect("hit text should decrypt to UTF-8")
}

#[tokio::test]
async fn fixture_email_import_lists_searches_and_files_to_matter_durably() {
    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let store =
        EncryptedMailStore::open_with_key(workspace.path(), &MAIL_KEY).expect("open mail store");
    let conn = store::open_connection(workspace.path())
        .await
        .expect("open vector store");
    let table = store::open_or_create_table(&conn)
        .await
        .expect("open chunks table");
    let message = fixture_message();

    let indexed = Arc::new(Mutex::new(Vec::<(String, String, String)>::new()));
    let indexed_for_callback = Arc::clone(&indexed);
    let stats = apply_messages_enc(
        &store,
        workspace.path(),
        "inbox",
        "m365",
        "legal@example.test",
        FOLDER_MATTER,
        std::slice::from_ref(&message),
        &[],
        &MAIL_KEY,
        &move |id, markdown, matter| {
            indexed_for_callback.lock().unwrap().push((
                id.to_string(),
                markdown.to_string(),
                matter.to_string(),
            ));
        },
        &|_| {},
    )
    .expect("fixture import should succeed");
    assert_eq!(stats.written, 1);

    let first_index = indexed.lock().unwrap().clone();
    assert_eq!(first_index.len(), 1);
    assert_eq!(first_index[0].0, message.id);
    assert_eq!(first_index[0].2, FOLDER_MATTER);
    index_mail_entry(
        &table,
        &first_index[0].0,
        &first_index[0].1,
        &first_index[0].2,
    )
    .await;

    let page = store.list_messages(&default_query()).expect("list messages");
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].id, message.id);
    assert_eq!(page.items[0].subject, "Zephyr retainer escrow instructions");
    assert_eq!(page.items[0].provider, "m365");
    assert_eq!(page.items[0].account, "legal@example.test");

    let keyword_page = store
        .list_messages(&MailListQuery {
            keyword: Some("zephyr".into()),
            ..default_query()
        })
        .expect("keyword search messages");
    assert_eq!(keyword_page.total, 1);
    assert_eq!(keyword_page.items[0].id, message.id);

    let hits = store::nearest(
        &table,
        &vec![0.1f32; EMBEDDING_DIM],
        5,
        Some(FOLDER_MATTER),
        false,
        &[],
    )
    .await
    .expect("AI/vector search");
    let mail_hit = hits
        .iter()
        .find(|hit| decrypted_hit_path(hit) == format!("mail:{}", message.id))
        .expect("AI/vector search should surface imported fixture email");
    assert_eq!(mail_hit.source_type.as_deref(), Some("mail"));
    assert_eq!(mail_hit.matter_id.as_deref(), Some(FOLDER_MATTER));
    assert!(
        decrypted_hit_text(mail_hit).contains("client trust account ending 4477"),
        "AI/vector search hit should decrypt back to the imported fixture body"
    );

    store
        .set_message_matter(&message.id, FILED_MATTER)
        .expect("durably file message to matter");
    let retagged = store::retag_matter_for_path(
        &table,
        &format!("mail:{}", message.id),
        FILED_MATTER,
        &VEC_KEY,
    )
    .await
    .expect("mirror filing into RAG store");
    assert!(
        retagged > 0,
        "file-to-matter should retag indexed mail chunks"
    );
    let filed_matter = store::matter_for_path(&table, &format!("mail:{}", message.id), &VEC_KEY)
        .await
        .expect("read filed matter from RAG")
        .expect("message should be indexed");
    assert_eq!(filed_matter, FILED_MATTER);

    let reopened =
        EncryptedMailStore::open_with_key(workspace.path(), &MAIL_KEY).expect("reopen mail store");
    assert_eq!(
        reopened
            .get_message_matter(&message.id)
            .expect("read durable matter")
            .as_deref(),
        Some(FILED_MATTER)
    );
    let reopened_page = reopened.list_messages(&default_query()).expect("list after reopen");
    assert_eq!(reopened_page.total, 1);
    assert_eq!(reopened_page.items[0].id, message.id);

    let reindexed = Arc::new(Mutex::new(Vec::<String>::new()));
    let reindexed_for_callback = Arc::clone(&reindexed);
    apply_messages_enc(
        &reopened,
        workspace.path(),
        "inbox",
        "m365",
        "legal@example.test",
        FOLDER_MATTER,
        std::slice::from_ref(&message),
        &[],
        &MAIL_KEY,
        &move |_id, _markdown, matter| {
            reindexed_for_callback.lock().unwrap().push(matter.to_string());
        },
        &|_| {},
    )
    .expect("re-import should honor durable filing override");
    assert_eq!(
        reindexed.lock().unwrap().as_slice(),
        [FILED_MATTER],
        "BUG-013/042 durable override should win over the folder default on re-import"
    );
}

use lantern_lib::commands::crm::{
    core_store::CrmCoreStore,
    hendricks_review::{self, HendricksContext},
};
use serde_json::json;

fn workspace() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    let dir = root
        .path()
        .join("Meetings/2026-07-02-hendricks-annual-review");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("meeting.json"), serde_json::to_vec(&json!({"matterId":"matter_sample_garcia_v_meridian","calendarEvent":{"id":"sample-hendricks-annual-review","title":"Hendricks annual review"}})).unwrap()).unwrap();
    std::fs::write(dir.join("transcript.json"), serde_json::to_vec(&json!({"meta":{"matterId":"matter_sample_garcia_v_meridian"},"segments":[{},{},{},{"endMs":92000,"text":"I will prepare the Schwab Roth authorization, check Robert's consulting 401(k) beneficiaries, and revisit 529 funding in October."}]})).unwrap()).unwrap();
    root
}
fn context(root: &std::path::Path) -> HendricksContext {
    HendricksContext {
        matter_id: "matter_sample_garcia_v_meridian".into(),
        household_ref: "sample-hendricks-household".into(),
        meeting_id: "sample-hendricks-annual-review".into(),
        workspace_root: root.to_string_lossy().into_owned(),
        workspace_generation: 1,
    }
}
fn store(root: &std::path::Path) -> CrmCoreStore {
    std::env::set_var(
        "LANTERN_HEADLESS_TEST_CRM_CORE_MASTER_KEY_HEX",
        "1111111111111111111111111111111111111111111111111111111111111111",
    );
    CrmCoreStore::open(root).unwrap()
}

#[test]
fn real_encrypted_seed_approval_and_local_delivery_are_exactly_once() {
    let root = workspace();
    let store = store(root.path());
    let context = context(root.path());
    let view = store
        .hendricks_review_transaction(|tx, root, key| {
            hendricks_review::ensure(tx, &context, root, key)
        })
        .unwrap();
    assert_eq!(view.artifacts.len(), 2);
    for id in ["builtin-hendricks-task-v1", "builtin-hendricks-crm-v1"] {
        store
            .hendricks_review_transaction(|tx, root, key| {
                hendricks_review::approve(tx, &context, root, key, id)
            })
            .unwrap();
    }
    let task = store
        .hendricks_review_transaction(|tx, root, key| {
            hendricks_review::deliver_task(tx, &context, root, key)
        })
        .unwrap();
    assert_eq!(
        task,
        store
            .hendricks_review_transaction(|tx, root, key| hendricks_review::deliver_task(
                tx, &context, root, key
            ))
            .unwrap()
    );
    let crm = store
        .hendricks_review_transaction(|tx, root, key| {
            hendricks_review::deliver_crm(tx, &context, root, key)
        })
        .unwrap();
    assert_eq!(
        crm,
        store
            .hendricks_review_transaction(|tx, root, key| hendricks_review::deliver_crm(
                tx, &context, root, key
            ))
            .unwrap()
    );
}

#[test]
fn changed_context_and_source_fail_before_delivery() {
    let root = workspace();
    let store = store(root.path());
    let context = context(root.path());
    store
        .hendricks_review_transaction(|tx, root, key| {
            hendricks_review::ensure(tx, &context, root, key)
        })
        .unwrap();
    let wrong = HendricksContext {
        matter_id: "other".into(),
        ..context.clone()
    };
    assert!(store
        .hendricks_review_transaction(|tx, root, key| hendricks_review::view(tx, &wrong, root, key))
        .is_err());
    std::fs::write(
        root.path()
            .join("Meetings/2026-07-02-hendricks-annual-review/transcript.json"),
        b"{}",
    )
    .unwrap();
    assert!(store
        .hendricks_review_transaction(|tx, root, key| hendricks_review::view(
            tx, &context, root, key
        ))
        .is_err());
}

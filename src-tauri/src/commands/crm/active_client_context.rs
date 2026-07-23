//! Native-only active-client context for future protected local actions.
//!
//! The renderer may request a household/matter pair, but it never receives or
//! supplies authority. This module validates the request against the existing
//! encrypted CRM read model and retains a private lease Rust code can recheck
//! immediately before a protected action. It does not prove browser pixels,
//! clicks, advisor identity, permissions, or provider authorization.

use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use super::{commands::CrmState, core_store::CrmCoreStore};

#[derive(Default)]
pub(crate) struct ActiveClientContextState {
    workspace: Option<PathBuf>,
    workspace_revision: u64,
    selection_revision: u64,
    selection: Option<ActiveClientSelection>,
}

#[derive(Clone)]
struct ActiveClientSelection {
    household_id: String,
    matter_id: String,
    workspace_revision: u64,
    selection_revision: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveClientContextReceipt {
    /// Display status only. This receipt is not authority and cannot be used
    /// to construct or consume a native lease.
    pub activated: bool,
    pub reason: Option<String>,
    pub workspace_revision: u64,
    pub selection_revision: u64,
}

/// Deliberately private native authority. It is neither serializable nor a
/// Tauri DTO, and no command accepts one as input.
#[derive(Clone)]
pub(crate) struct ActiveClientLease(ActiveClientSelection);

impl ActiveClientContextState {
    pub(crate) fn handoff_workspace(&mut self, workspace: PathBuf) {
        self.workspace_revision = self.workspace_revision.saturating_add(1);
        self.selection_revision = self.selection_revision.saturating_add(1);
        self.workspace = Some(workspace);
        self.selection = None;
    }

    fn clear(&mut self) {
        self.selection_revision = self.selection_revision.saturating_add(1);
        self.selection = None;
    }

    fn receipt(&self, activated: bool, reason: Option<&str>) -> ActiveClientContextReceipt {
        ActiveClientContextReceipt {
            activated,
            reason: reason.map(ToOwned::to_owned),
            workspace_revision: self.workspace_revision,
            selection_revision: self.selection_revision,
        }
    }

    fn capture(&self) -> Option<ActiveClientLease> {
        self.selection.clone().map(ActiveClientLease)
    }

    fn consume_exact(&self, lease: &ActiveClientLease) -> bool {
        let Some(current) = &self.selection else {
            return false;
        };
        current.workspace_revision == lease.0.workspace_revision
            && current.selection_revision == lease.0.selection_revision
            && current.household_id == lease.0.household_id
            && current.matter_id == lease.0.matter_id
    }
}

/// Capture a native-only approval lease for future protected code. The lease
/// must be rechecked with [`require_active_client_lease`] immediately before
/// execution; it is invalid after any selection or workspace transition.
pub(crate) async fn capture_active_client_lease(state: &CrmState) -> Option<ActiveClientLease> {
    state.active_client_context.lock().await.capture()
}

/// Capture a native-only approval lease only for the current exact private
/// household and matter selection. The supplied identifiers never leave this
/// lock or become part of the lease's public surface.
pub(crate) async fn capture_active_client_lease_for(
    state: &CrmState,
    household_id: &str,
    matter_id: &str,
) -> Result<ActiveClientLease, String> {
    let context = state.active_client_context.lock().await;
    let Some(selection) = context.selection.as_ref() else {
        return Err("No active client is selected.".to_string());
    };

    if household_id.is_empty()
        || matter_id.is_empty()
        || selection.household_id.is_empty()
        || selection.matter_id.is_empty()
        || context.workspace.is_none()
        || selection.workspace_revision != context.workspace_revision
        || selection.selection_revision != context.selection_revision
        || selection.household_id != household_id
        || selection.matter_id != matter_id
    {
        return Err("The requested client is not the active client.".to_string());
    }

    Ok(ActiveClientLease(selection.clone()))
}

/// Native-only execution gate for future protected local actions.
pub(crate) async fn require_active_client_lease(
    state: &CrmState,
    lease: &ActiveClientLease,
) -> Result<(), String> {
    if state
        .active_client_context
        .lock()
        .await
        .consume_exact(lease)
    {
        Ok(())
    } else {
        Err("The active client changed before this action could run.".to_string())
    }
}

fn exact_live_household(
    records: Vec<serde_json::Value>,
    household_id: &str,
    matter_id: &str,
) -> bool {
    let matching_households: Vec<_> = records
        .into_iter()
        .filter(|record| {
            record.get("kind").and_then(|value| value.as_str()) == Some("household")
                && record.get("id").and_then(|value| value.as_str()) == Some(household_id)
                && record.get("deleted").and_then(|value| value.as_bool()) != Some(true)
        })
        .collect();

    matching_households.len() == 1
        && matching_households[0]
            .get("matterId")
            .and_then(|value| value.as_str())
            == Some(matter_id)
}

async fn request_active_client_with_reader(
    state: &CrmState,
    household_id: String,
    matter_id: String,
    read_records: impl FnOnce(PathBuf) -> Result<Vec<serde_json::Value>, String> + Send + 'static,
) -> ActiveClientContextReceipt {
    let (workspace, workspace_revision) = {
        let mut context = state.active_client_context.lock().await;
        match (&context.workspace, context.workspace_revision) {
            (Some(workspace), revision) => (workspace.clone(), revision),
            (None, _) => {
                context.clear();
                return context.receipt(false, Some("workspace-not-set"));
            }
        }
    };

    let records = match tokio::task::spawn_blocking(move || read_records(workspace)).await {
        Ok(Ok(records)) => records,
        Ok(Err(_)) | Err(_) => {
            let mut context = state.active_client_context.lock().await;
            context.clear();
            return context.receipt(false, Some("crm-read-refused"));
        }
    };

    let mut context = state.active_client_context.lock().await;
    if context.workspace_revision != workspace_revision {
        context.clear();
        return context.receipt(false, Some("workspace-changed"));
    }
    if !exact_live_household(records, &household_id, &matter_id) {
        context.clear();
        return context.receipt(false, Some("household-matter-not-exact"));
    }

    context.selection_revision = context.selection_revision.saturating_add(1);
    let selection = ActiveClientSelection {
        household_id,
        matter_id,
        workspace_revision: context.workspace_revision,
        selection_revision: context.selection_revision,
    };
    context.selection = Some(selection);
    context.receipt(true, None)
}

/// Renderer inputs are untrusted identifiers. The existing SQLCipher store is
/// opened read-only and exactly one live household must agree with both ids.
#[tauri::command]
pub async fn crm_request_active_client(
    state: State<'_, CrmState>,
    household_id: String,
    matter_id: String,
) -> Result<ActiveClientContextReceipt, String> {
    Ok(
        request_active_client_with_reader(&state, household_id, matter_id, |workspace| {
            CrmCoreStore::open_read_only(&workspace)
                .and_then(|store| store.list_live_records())
                .map_err(|error| error.to_string())
        })
        .await,
    )
}

/// Clears native selection for all non-pair, teardown, and refusal paths.
#[tauri::command]
pub async fn crm_clear_active_client_context(
    state: State<'_, CrmState>,
) -> Result<ActiveClientContextReceipt, String> {
    let mut context = state.active_client_context.lock().await;
    context.clear();
    Ok(context.receipt(false, Some("cleared")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::crm::core_store::{CrmCoreStore, CrmDocRow};
    use serde_json::json;
    use tempfile::TempDir;

    const KEY: [u8; 32] = [0x51; 32];

    fn record(id: &str, matter_id: &str) -> serde_json::Value {
        json!({
            "kind": "household",
            "id": id,
            "matterId": matter_id,
            "name": "Test household"
        })
    }

    async fn state_at(workspace: &TempDir) -> CrmState {
        let state = CrmState::default();
        state
            .service()
            .set_workspace(workspace.path().to_path_buf())
            .await;
        state
    }

    fn seed(workspace: &TempDir, records: &[serde_json::Value]) {
        let store = CrmCoreStore::open_with_key(workspace.path(), &KEY).unwrap();
        for (index, record) in records.iter().enumerate() {
            store
                .upsert_doc(&CrmDocRow {
                    doc_key: format!("active-client-test-{index}"),
                    matter_id: "test-matter".to_string(),
                    doc_id: format!("live:active-client-test-{index}"),
                    yjs_state: serde_json::to_vec(record).unwrap(),
                    state_vector: Vec::new(),
                    updated_at: format!("2026-07-23T00:00:0{index}Z"),
                    deleted: false,
                })
                .unwrap();
        }
    }

    fn storage_evidence(workspace: &TempDir) -> (Vec<serde_json::Value>, Vec<(String, Vec<u8>)>) {
        let reader = CrmCoreStore::open_read_only_with_key(workspace.path(), &KEY).unwrap();
        let records = reader.list_live_records().unwrap();
        drop(reader);

        let storage_dir = CrmCoreStore::db_path(workspace.path())
            .parent()
            .unwrap()
            .to_path_buf();
        let mut files = std::fs::read_dir(storage_dir)
            .unwrap()
            .map(|entry| {
                let path = entry.unwrap().path();
                (
                    path.file_name().unwrap().to_string_lossy().into_owned(),
                    std::fs::read(path).unwrap(),
                )
            })
            .collect::<Vec<_>>();
        files.sort_by(|left, right| left.0.cmp(&right.0));
        (records, files)
    }

    async fn request(
        state: &CrmState,
        household_id: &str,
        matter_id: &str,
    ) -> ActiveClientContextReceipt {
        request_active_client_with_reader(
            state,
            household_id.to_string(),
            matter_id.to_string(),
            |workspace| {
                CrmCoreStore::open_read_only_with_key(&workspace, &KEY)
                    .and_then(|store| store.list_live_records())
                    .map_err(|error| error.to_string())
            },
        )
        .await
    }

    #[tokio::test]
    async fn exact_live_pair_captures_a_target_bound_private_lease_and_consumes_it() {
        let workspace = TempDir::new().unwrap();
        seed(&workspace, &[record("household-a", "matter-a")]);
        let state = state_at(&workspace).await;

        assert!(request(&state, "household-a", "matter-a").await.activated);
        let lease = capture_active_client_lease_for(&state, "household-a", "matter-a")
            .await
            .expect("target-bound private lease");
        require_active_client_lease(&state, &lease).await.unwrap();
    }

    #[tokio::test]
    async fn target_mismatch_refuses_without_clearing_the_active_pair() {
        let workspace = TempDir::new().unwrap();
        seed(
            &workspace,
            &[
                record("household-a", "matter-a"),
                record("household-b", "matter-b"),
            ],
        );
        let state = state_at(&workspace).await;

        assert!(request(&state, "household-a", "matter-a").await.activated);
        assert!(capture_active_client_lease_for(&state, "", "matter-a")
            .await
            .is_err());
        assert!(capture_active_client_lease_for(&state, "household-a", "")
            .await
            .is_err());
        assert!(
            capture_active_client_lease_for(&state, "household-b", "matter-a")
                .await
                .is_err()
        );
        assert!(
            capture_active_client_lease_for(&state, "household-a", "matter-b")
                .await
                .is_err()
        );

        let lease = capture_active_client_lease_for(&state, "household-a", "matter-a")
            .await
            .expect("A remains the active private pair");
        require_active_client_lease(&state, &lease).await.unwrap();
    }

    #[tokio::test]
    async fn missing_deleted_duplicate_and_disagreeing_records_refuse_and_clear() {
        for (records, household_id, matter_id) in [
            (
                vec![record("household-live", "matter-live")],
                "household-missing",
                "matter-a",
            ),
            (
                vec![
                    record("household-live", "matter-live"),
                    json!({"kind":"household", "id":"household-a", "matterId":"matter-a", "deleted":true}),
                ],
                "household-a",
                "matter-a",
            ),
            (
                vec![
                    record("household-live", "matter-live"),
                    record("household-a", "matter-a"),
                    record("household-a", "matter-a"),
                ],
                "household-a",
                "matter-a",
            ),
            (
                vec![
                    record("household-live", "matter-live"),
                    record("household-a", "matter-other"),
                ],
                "household-a",
                "matter-a",
            ),
        ] {
            let workspace = TempDir::new().unwrap();
            seed(&workspace, &records);
            let state = state_at(&workspace).await;
            assert!(
                request(&state, "household-live", "matter-live")
                    .await
                    .activated
            );
            let live_lease = capture_active_client_lease(&state)
                .await
                .expect("live lease before refusal");
            assert!(!request(&state, household_id, matter_id).await.activated);
            assert!(capture_active_client_lease(&state).await.is_none());
            assert!(require_active_client_lease(&state, &live_lease)
                .await
                .is_err());
        }
    }

    #[tokio::test]
    async fn client_switch_replaces_pair_and_invalidates_the_old_target_bound_lease() {
        let workspace = TempDir::new().unwrap();
        seed(
            &workspace,
            &[
                record("household-a", "matter-a"),
                record("household-b", "matter-b"),
            ],
        );
        let state = state_at(&workspace).await;
        let first = request(&state, "household-a", "matter-a").await;
        let old_lease = capture_active_client_lease_for(&state, "household-a", "matter-a")
            .await
            .unwrap();
        let second = request(&state, "household-b", "matter-b").await;
        assert!(second.selection_revision > first.selection_revision);
        assert!(require_active_client_lease(&state, &old_lease)
            .await
            .is_err());
        let current = capture_active_client_lease_for(&state, "household-b", "matter-b")
            .await
            .unwrap();
        assert!(require_active_client_lease(&state, &current).await.is_ok());
    }

    #[tokio::test]
    async fn workspace_handoffs_never_revive_or_preserve_a_target_bound_lease() {
        let a = TempDir::new().unwrap();
        let b = TempDir::new().unwrap();
        seed(&a, &[record("household-a", "matter-a")]);
        seed(&b, &[record("household-b", "matter-b")]);
        let state = state_at(&a).await;
        let first = request(&state, "household-a", "matter-a").await;
        let lease = capture_active_client_lease_for(&state, "household-a", "matter-a")
            .await
            .unwrap();
        state.service().set_workspace(b.path().to_path_buf()).await;
        state.service().set_workspace(a.path().to_path_buf()).await;
        let after_return = state
            .active_client_context
            .lock()
            .await
            .receipt(false, None);
        assert!(after_return.workspace_revision > first.workspace_revision);
        assert!(capture_active_client_lease(&state).await.is_none());
        assert!(require_active_client_lease(&state, &lease).await.is_err());

        assert!(request(&state, "household-a", "matter-a").await.activated);
        let same_path_lease = capture_active_client_lease_for(&state, "household-a", "matter-a")
            .await
            .unwrap();
        let before_same_path_handoff = after_return.workspace_revision;
        state.service().set_workspace(a.path().to_path_buf()).await;
        let after_same_path_handoff = state
            .active_client_context
            .lock()
            .await
            .receipt(false, None);
        assert!(
            after_same_path_handoff.workspace_revision > before_same_path_handoff,
            "a same-path handoff must advance the native workspace revision"
        );
        assert!(capture_active_client_lease(&state).await.is_none());
        assert!(require_active_client_lease(&state, &same_path_lease)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn clear_and_default_states_have_no_lease() {
        let state = CrmState::default();
        assert!(capture_active_client_lease(&state).await.is_none());
        assert!(
            capture_active_client_lease_for(&state, "household-a", "matter-a")
                .await
                .is_err()
        );

        let workspace = TempDir::new().unwrap();
        seed(&workspace, &[record("household-a", "matter-a")]);
        let state = state_at(&workspace).await;
        assert!(request(&state, "household-a", "matter-a").await.activated);
        let live_lease = capture_active_client_lease(&state)
            .await
            .expect("live lease before clear");
        let receipt = {
            let mut context = state.active_client_context.lock().await;
            context.clear();
            context.receipt(false, Some("cleared"))
        };
        assert!(!receipt.activated);
        assert!(capture_active_client_lease(&state).await.is_none());
        assert!(
            capture_active_client_lease_for(&state, "household-a", "matter-a")
                .await
                .is_err()
        );
        assert!(require_active_client_lease(&state, &live_lease)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn target_bound_capture_and_mismatch_leave_real_sqlcipher_storage_unchanged() {
        let workspace = TempDir::new().unwrap();
        seed(
            &workspace,
            &[
                record("household-a", "matter-a"),
                record("household-b", "matter-b"),
            ],
        );
        let state = state_at(&workspace).await;
        assert!(request(&state, "household-a", "matter-a").await.activated);
        let before = storage_evidence(&workspace);

        assert!(
            capture_active_client_lease_for(&state, "household-b", "matter-b")
                .await
                .is_err()
        );
        let lease = capture_active_client_lease_for(&state, "household-a", "matter-a")
            .await
            .unwrap();
        require_active_client_lease(&state, &lease).await.unwrap();

        let after = storage_evidence(&workspace);
        assert_eq!(after.0, before.0, "CRM live records must not change");
        assert_eq!(after.1, before.1, "SQLCipher storage bytes must not change");
    }

    #[test]
    fn target_bound_helper_has_no_serialized_command_or_lease_field_surface() {
        let source = include_str!("active_client_context.rs");
        let lease_surface = &source[source.find("pub(crate) struct ActiveClientLease").unwrap()
            ..source.find("impl ActiveClientContextState").unwrap()];
        let helper = &source[source
            .find("pub(crate) async fn capture_active_client_lease_for")
            .unwrap()
            ..source
                .find("pub(crate) async fn require_active_client_lease")
                .unwrap()];

        assert!(!lease_surface.contains("Serialize"));
        assert!(!lease_surface.contains("impl ActiveClientLease"));
        assert!(!lease_surface.contains("household_id(&self"));
        assert!(!lease_surface.contains("matter_id(&self"));
        assert!(!helper.contains("#[tauri::command]"));
        assert!(!helper.contains("State<'"));
        assert!(!helper.contains("ActiveClientContextReceipt"));
        assert!(!helper.contains("pub async"));
    }

    #[tokio::test]
    async fn fabricated_renderer_receipts_and_revisions_cannot_consume_a_live_lease() {
        let workspace = TempDir::new().unwrap();
        seed(&workspace, &[record("household-a", "matter-a")]);
        let state = state_at(&workspace).await;
        assert!(request(&state, "household-a", "matter-a").await.activated);
        let live_lease = capture_active_client_lease(&state)
            .await
            .expect("live native lease");
        let fabricated_receipt = ActiveClientContextReceipt {
            activated: true,
            reason: None,
            workspace_revision: u64::MAX,
            selection_revision: u64::MAX,
        };
        assert!(fabricated_receipt.activated);
        // This display DTO is not an input to any authority API. Only native
        // validation can put a private ActiveClientLease in state, and a
        // fabricated renderer revision cannot consume the already-live one.
        require_active_client_lease(&state, &live_lease)
            .await
            .unwrap();
    }
}

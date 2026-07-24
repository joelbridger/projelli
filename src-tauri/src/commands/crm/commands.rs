//! Stable CRM state/service boundary and legacy command compatibility facade.
//!
//! Existing renderer and native-manifest paths continue to resolve through
//! this module. Command implementations belong under `crm::features`; do not
//! add `#[tauri::command]` functions here.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize};
use std::sync::Arc;

use tauri::Manager;

use crate::commands::crm::write;

pub use super::features::connector::commands::*;

/// Shared native CRM state. The public fields are retained for source
/// compatibility with the existing generic core, search, migration, and test
/// boundaries. New feature modules should use [`CrmState::service`] for shared
/// workspace access instead of coupling to connector lifecycle internals.
pub struct CrmState {
    pub workspace: tokio::sync::Mutex<Option<PathBuf>>,
    pub(crate) active_client_context:
        tokio::sync::Mutex<super::active_client_context::ActiveClientContextState>,
    /// Serializes the private active-client authority boundary with protected
    /// encrypted transactions. This is deliberately a semaphore permit, not
    /// a mutex guard that could be held during blocking SQLCipher work.
    pub(crate) active_client_execution_permit: Arc<tokio::sync::Semaphore>,
    pub is_syncing: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub last_report: tokio::sync::Mutex<Option<CrmSyncReportDto>>,
    pub progress_households: Arc<AtomicU32>,
    pub oauth_cancel: Arc<AtomicBool>,
    pub write_guard: write::WriteInFlightGuard,
    pub write_in_flight: Arc<AtomicUsize>,
    pub disconnect_requested: Arc<AtomicBool>,
    pub connect_in_progress: Arc<AtomicBool>,
    pub downgrade_unconfirmed: tokio::sync::Mutex<HashSet<String>>,
}

impl Default for CrmState {
    fn default() -> Self {
        Self {
            workspace: tokio::sync::Mutex::new(None),
            active_client_context: tokio::sync::Mutex::new(
                super::active_client_context::ActiveClientContextState::default(),
            ),
            active_client_execution_permit: Arc::new(tokio::sync::Semaphore::new(1)),
            is_syncing: Arc::new(AtomicBool::new(false)),
            cancel: Arc::new(AtomicBool::new(false)),
            last_report: tokio::sync::Mutex::new(None),
            progress_households: Arc::new(AtomicU32::new(0)),
            oauth_cancel: Arc::new(AtomicBool::new(false)),
            write_guard: write::WriteInFlightGuard::new(),
            write_in_flight: Arc::new(AtomicUsize::new(0)),
            disconnect_requested: Arc::new(AtomicBool::new(false)),
            connect_in_progress: Arc::new(AtomicBool::new(false)),
            downgrade_unconfirmed: tokio::sync::Mutex::new(HashSet::new()),
        }
    }
}

impl CrmState {
    /// The narrow shared service offered to feature-owned CRM commands.
    pub fn service(&self) -> CrmService<'_> {
        CrmService { state: self }
    }
}

/// Stable service boundary for shared CRM workspace/state access.
///
/// Connector-only synchronization flags remain on [`CrmState`] for existing
/// behavior. Atomic feature modules should need only this service to open the
/// landed CRM core store from the active workspace.
#[derive(Clone, Copy)]
pub struct CrmService<'a> {
    state: &'a CrmState,
}

impl CrmService<'_> {
    pub async fn workspace(&self) -> Result<PathBuf, String> {
        self.optional_workspace()
            .await
            .ok_or_else(|| "Open a workspace before using CRM data.".to_string())
    }

    pub async fn optional_workspace(&self) -> Option<PathBuf> {
        self.state.workspace.lock().await.clone()
    }

    pub async fn set_workspace(&self, workspace: PathBuf) {
        // Every handoff is an authority boundary, including the same path.
        // Clearing before publishing the compatibility workspace field means
        // an old client lease never survives A → B → A.
        let _permit = Arc::clone(&self.state.active_client_execution_permit)
            .acquire_owned()
            .await
            .expect("active-client execution permit remains open");
        self.state
            .active_client_context
            .lock()
            .await
            .handoff_workspace(workspace.clone());
        *self.state.workspace.lock().await = Some(workspace);
    }
}

pub fn manage_state(app: &tauri::App) {
    app.manage(CrmState::default());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn crm_service_is_the_stable_workspace_boundary() {
        let state = CrmState::default();
        let service = state.service();

        assert_eq!(
            service.workspace().await.unwrap_err(),
            "Open a workspace before using CRM data."
        );

        let workspace = PathBuf::from("/tmp/lantern-crm-service-boundary");
        service.set_workspace(workspace.clone()).await;
        assert_eq!(service.workspace().await.unwrap(), workspace);
    }
}

pub mod store;

use store::{
    EncryptedAuditSink, IntakeFactInput, IntakeFactsStore, MaskedClientFact,
    RevealedClientFact,
};
use tauri::{Manager, State};

pub struct IntakeState {
    pub workspace: tokio::sync::Mutex<Option<std::path::PathBuf>>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(IntakeState {
        workspace: tokio::sync::Mutex::new(None),
    });
}

#[tauri::command]
pub async fn intake_set_workspace(
    state: State<'_, IntakeState>,
    path: String,
) -> Result<(), String> {
    *state.workspace.lock().await = Some(std::path::PathBuf::from(path));
    Ok(())
}

async fn workspace(state: &State<'_, IntakeState>) -> Result<std::path::PathBuf, String> {
    state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or_else(|| "intake workspace not set".to_string())
}

#[tauri::command]
pub async fn intake_fact_upsert(
    state: State<'_, IntakeState>,
    input: IntakeFactInput,
) -> Result<MaskedClientFact, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<MaskedClientFact> {
        let store = IntakeFactsStore::open(&ws)?;
        let audit = EncryptedAuditSink::new(ws);
        store.upsert_fact(input, &audit)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_fact_list(
    state: State<'_, IntakeState>,
    matter_id: String,
) -> Result<Vec<MaskedClientFact>, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<MaskedClientFact>> {
        let store = IntakeFactsStore::open(&ws)?;
        store.list_masked(&matter_id)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_fact_reveal(
    state: State<'_, IntakeState>,
    fact_id: String,
) -> Result<RevealedClientFact, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<RevealedClientFact> {
        let store = IntakeFactsStore::open(&ws)?;
        let audit = EncryptedAuditSink::new(ws);
        store.reveal_fact(&fact_id, &audit)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_fact_purge(
    state: State<'_, IntakeState>,
    fact_id: String,
) -> Result<Vec<String>, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<String>> {
        let store = IntakeFactsStore::open(&ws)?;
        let audit = EncryptedAuditSink::new(ws);
        store.purge(&fact_id, &audit)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

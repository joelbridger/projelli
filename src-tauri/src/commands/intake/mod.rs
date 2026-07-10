pub mod store;

use store::{
    EmailReplyProposalInput, EmailReplyProposalRecord, EmailReplyQuarantineInput,
    EmailReplyQuarantineRecord, EncryptedAuditSink, IntakeFactInput, IntakeFactsStore,
    MaskedClientFact, RevealedClientFact,
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
    matter_id: String,
    fact_id: String,
) -> Result<RevealedClientFact, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<RevealedClientFact> {
        let store = IntakeFactsStore::open(&ws)?;
        let audit = EncryptedAuditSink::new(ws);
        store.reveal_fact(&matter_id, &fact_id, &audit)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_fact_purge(
    state: State<'_, IntakeState>,
    matter_id: String,
    fact_id: String,
) -> Result<Vec<String>, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<String>> {
        let store = IntakeFactsStore::open(&ws)?;
        let audit = EncryptedAuditSink::new(ws);
        store.purge(&matter_id, &fact_id, &audit)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_email_reply_save_proposal(
    state: State<'_, IntakeState>,
    input: EmailReplyProposalInput,
) -> Result<Option<EmailReplyProposalRecord>, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(
        move || -> anyhow::Result<Option<EmailReplyProposalRecord>> {
            let store = IntakeFactsStore::open(&ws)?;
            store.enqueue_email_reply_proposal(input)
        },
    )
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_email_reply_save_quarantine(
    state: State<'_, IntakeState>,
    input: EmailReplyQuarantineInput,
) -> Result<Option<EmailReplyQuarantineRecord>, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(
        move || -> anyhow::Result<Option<EmailReplyQuarantineRecord>> {
            let store = IntakeFactsStore::open(&ws)?;
            store.enqueue_email_reply_quarantine(input)
        },
    )
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_email_reply_list_proposals(
    state: State<'_, IntakeState>,
    matter_id: Option<String>,
) -> Result<Vec<EmailReplyProposalRecord>, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<EmailReplyProposalRecord>> {
        let store = IntakeFactsStore::open(&ws)?;
        store.list_email_reply_proposals(matter_id.as_deref())
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_email_reply_get_proposal(
    state: State<'_, IntakeState>,
    proposal_id: String,
) -> Result<EmailReplyProposalRecord, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<EmailReplyProposalRecord> {
        let store = IntakeFactsStore::open(&ws)?;
        store.get_email_reply_proposal(&proposal_id)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_email_reply_set_proposal_status(
    state: State<'_, IntakeState>,
    proposal_id: String,
    status: String,
    error: Option<String>,
) -> Result<EmailReplyProposalRecord, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<EmailReplyProposalRecord> {
        let store = IntakeFactsStore::open(&ws)?;
        store.set_email_reply_proposal_status(&proposal_id, &status, error.as_deref())
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_email_reply_list_quarantines(
    state: State<'_, IntakeState>,
    matter_id: Option<String>,
) -> Result<Vec<EmailReplyQuarantineRecord>, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<EmailReplyQuarantineRecord>> {
        let store = IntakeFactsStore::open(&ws)?;
        store.list_email_reply_quarantines(matter_id.as_deref())
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

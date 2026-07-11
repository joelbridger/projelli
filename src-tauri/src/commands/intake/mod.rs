pub mod store;

use store::{
    DocumentExtractionProposalAcceptInput, DocumentExtractionProposalAcceptResult,
    DocumentExtractionProposalInput, DocumentExtractionProposalRecord,
    DocumentExtractionProposalRowCompletion, EmailReplyProposalInput, EmailReplyProposalRecord,
    EmailReplyProposalRowCompletion, EmailReplyQuarantineInput, EmailReplyQuarantineRecord,
    EncryptedAuditSink, IntakeFactInput, IntakeFactsStore, MaskedClientFact, RevealedClientFact,
};
use tauri::{Manager, State};
use sha2::{Digest, Sha256};

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

fn pdf_template_artifact_path(workspace_root: &std::path::Path, template_id: &str) -> anyhow::Result<std::path::PathBuf> {
    if !template_id
        .chars()
        .enumerate()
        .all(|(index, character)| (index == 0 && character.is_ascii_alphanumeric()) || character.is_ascii_alphanumeric() || character == '_' || character == '-')
        || template_id.len() < 8
        || template_id.len() > 128
    {
        anyhow::bail!("template id is not safe");
    }
    let digest = hex::encode(Sha256::digest(template_id.as_bytes()));
    Ok(crate::commands::data_dir::workspace_data_dir(workspace_root)
        .join("intake-pdf-templates")
        .join(format!("{digest}.enc")))
}

/// Store an entire PDF template record as an AES-GCM local artifact. The OS
/// keychain holds only this encryption key, so Windows' tiny credential blob
/// limit can never reject an advisor's actual PDF.
#[tauri::command]
pub async fn intake_pdf_template_artifact_write(
    state: State<'_, IntakeState>,
    template_id: String,
    value: String,
) -> Result<(), String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let path = pdf_template_artifact_path(&ws, &template_id)?;
        let parent = path.parent().ok_or_else(|| anyhow::anyhow!("artifact path has no parent"))?;
        std::fs::create_dir_all(parent)?;
        let key = crate::commands::mail::crypto::get_or_create_scoped_master_key(
            crate::identity::INTAKE_PDF_TEMPLATES_ENC_SERVICE,
        )?;
        let encrypted = crate::commands::mail::crypto::encrypt_with_key(value.as_bytes(), &key)?;
        let temp = path.with_extension(format!("tmp-{}", std::process::id()));
        std::fs::write(&temp, encrypted)?;
        std::fs::rename(&temp, &path)?;
        Ok(())
    })
    .await
    .map_err(|error| format!("join: {error}"))?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn intake_pdf_template_artifact_read(
    state: State<'_, IntakeState>,
    template_id: String,
) -> Result<Option<String>, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<Option<String>> {
        let path = pdf_template_artifact_path(&ws, &template_id)?;
        let encrypted = match std::fs::read(path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let key = crate::commands::mail::crypto::get_or_create_scoped_master_key(
            crate::identity::INTAKE_PDF_TEMPLATES_ENC_SERVICE,
        )?;
        let plaintext = crate::commands::mail::crypto::decrypt_with_key(&encrypted, &key)?;
        Ok(Some(String::from_utf8(plaintext).map_err(|_| anyhow::anyhow!("PDF template artifact is not UTF-8"))?))
    })
    .await
    .map_err(|error| format!("join: {error}"))?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn intake_pdf_template_artifact_delete(
    state: State<'_, IntakeState>,
    template_id: String,
) -> Result<(), String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let path = pdf_template_artifact_path(&ws, &template_id)?;
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    })
    .await
    .map_err(|error| format!("join: {error}"))?
    .map_err(|error| error.to_string())
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
pub async fn intake_email_reply_mark_row_completed(
    state: State<'_, IntakeState>,
    proposal_id: String,
    completion: EmailReplyProposalRowCompletion,
) -> Result<EmailReplyProposalRecord, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<EmailReplyProposalRecord> {
        let store = IntakeFactsStore::open(&ws)?;
        store.mark_email_reply_proposal_row_completed(&proposal_id, completion)
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
pub async fn intake_document_extraction_save_proposal(
    state: State<'_, IntakeState>,
    input: DocumentExtractionProposalInput,
) -> Result<DocumentExtractionProposalRecord, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(
        move || -> anyhow::Result<DocumentExtractionProposalRecord> {
            IntakeFactsStore::open(&ws)?.enqueue_document_extraction_proposal(input)
        },
    )
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_document_extraction_list_proposals(
    state: State<'_, IntakeState>,
    matter_id: Option<String>,
) -> Result<Vec<DocumentExtractionProposalRecord>, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(
        move || -> anyhow::Result<Vec<DocumentExtractionProposalRecord>> {
            IntakeFactsStore::open(&ws)?.list_document_extraction_proposals(matter_id.as_deref())
        },
    )
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_document_extraction_get_proposal(
    state: State<'_, IntakeState>,
    matter_id: String,
    proposal_id: String,
) -> Result<DocumentExtractionProposalRecord, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(
        move || -> anyhow::Result<DocumentExtractionProposalRecord> {
            let store = IntakeFactsStore::open(&ws)?;
            let audit = EncryptedAuditSink::new(ws);
            store.get_document_extraction_proposal(&matter_id, &proposal_id, &audit)
        },
    )
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_document_extraction_accept_row(
    state: State<'_, IntakeState>,
    input: DocumentExtractionProposalAcceptInput,
) -> Result<DocumentExtractionProposalAcceptResult, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(
        move || -> anyhow::Result<DocumentExtractionProposalAcceptResult> {
            let store = IntakeFactsStore::open(&ws)?;
            let audit = EncryptedAuditSink::new(ws);
            store.accept_document_extraction_proposal_row(input, &audit)
        },
    )
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_document_extraction_mark_row_completed(
    state: State<'_, IntakeState>,
    proposal_id: String,
    completion: DocumentExtractionProposalRowCompletion,
) -> Result<DocumentExtractionProposalRecord, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(
        move || -> anyhow::Result<DocumentExtractionProposalRecord> {
            IntakeFactsStore::open(&ws)?
                .mark_document_extraction_proposal_row_completed(&proposal_id, completion)
        },
    )
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_document_extraction_set_proposal_status(
    state: State<'_, IntakeState>,
    proposal_id: String,
    status: String,
    error: Option<String>,
) -> Result<DocumentExtractionProposalRecord, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(
        move || -> anyhow::Result<DocumentExtractionProposalRecord> {
            IntakeFactsStore::open(&ws)?.set_document_extraction_proposal_status(
                &proposal_id,
                &status,
                error.as_deref(),
            )
        },
    )
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

#[tauri::command]
pub async fn intake_email_reply_get_quarantine(
    state: State<'_, IntakeState>,
    quarantine_id: String,
) -> Result<EmailReplyQuarantineRecord, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<EmailReplyQuarantineRecord> {
        IntakeFactsStore::open(&ws)?.get_email_reply_quarantine(&quarantine_id)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn intake_email_reply_set_quarantine_status(
    state: State<'_, IntakeState>,
    quarantine_id: String,
    status: String,
) -> Result<EmailReplyQuarantineRecord, String> {
    let ws = workspace(&state).await?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<EmailReplyQuarantineRecord> {
        IntakeFactsStore::open(&ws)?.set_email_reply_quarantine_status(&quarantine_id, &status)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

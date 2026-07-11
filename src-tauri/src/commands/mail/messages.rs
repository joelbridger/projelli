use super::matter::folder_matter_from_rag;
use super::*;
use crate::commands::mail::store::{EncryptedMailStore, MailListPage, MailListQuery, MailStore};
use serde::Serialize;
use tauri::State;

/// Reverse `normalize::yaml_escape` for a double-quoted scalar value: `\n`/`\r`
/// become a space, `\"` a quote, `\\` a backslash. Char-based so an escaped
/// backslash followed by `n` is not mistaken for an escaped newline.
pub(crate) fn yaml_unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') | Some('r') => out.push(' '),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Extract the `subject` from a normalized mail document's YAML frontmatter.
/// Scans only the fenced frontmatter block, strips the surrounding double
/// quotes, and reverses `yaml_escape`. Returns "" if not present.
pub(crate) fn frontmatter_subject(markdown: &str) -> String {
    let mut in_frontmatter = false;
    for line in markdown.lines() {
        if line.trim() == "---" {
            if in_frontmatter {
                break; // closing fence reached
            }
            in_frontmatter = true;
            continue;
        }
        if !in_frontmatter {
            continue;
        }
        if let Some(rest) = line.strip_prefix("subject:") {
            let v = rest.trim();
            let inner = v
                .strip_prefix('"')
                .and_then(|s| s.strip_suffix('"'))
                .unwrap_or(v);
            return yaml_unescape(inner);
        }
    }
    String::new()
}
#[tauri::command]
pub async fn mail_set_workspace(state: State<'_, MailState>, path: String) -> Result<(), String> {
    *state.workspace.lock().await = Some(std::path::PathBuf::from(path));
    Ok(())
}

/// Fetch + decrypt ONE stored message by id and return it as a structured view
/// for the read-only mail viewer.
///
/// `id` is the provider message id — the part after `mail:` in a citation
/// source. A leading `mail:` prefix is tolerated so the viewer can pass the raw
/// citation source id straight through.
///
/// The plaintext (decrypted Markdown) lives only in this process's memory and
/// the returned struct; it is never written back to disk.
///
/// Pure core (`get_message_with_key`) takes the workspace + key so it is unit-
/// testable without the OS keychain.
pub(crate) fn get_message_with_key(
    workspace: &std::path::Path,
    id: &str,
    key: &[u8; 32],
) -> anyhow::Result<Option<view::MailView>> {
    use anyhow::Context;
    // Tolerate a "mail:" prefix so callers can pass the citation source id.
    let id = id.strip_prefix("mail:").unwrap_or(id);
    let store =
        EncryptedMailStore::open_with_key(workspace, key).context("open encrypted mail store")?;
    let rec = match store.get_record(id)? {
        Some(r) => r,
        None => return Ok(None),
    };
    let bytes = store
        .read_blob_with_key(&rec.relative_path, workspace, key)
        .with_context(|| format!("read+decrypt mail blob for {id}"))?;
    let markdown = String::from_utf8(bytes).context("decrypted mail blob is not UTF-8")?;
    let mut view = view::MailView::from_markdown(id, &markdown);
    // BUG-013: the DURABLE per-message matter override (manual filing) is the
    // source of truth — read it here from the same store open. The RAG-index
    // folder-level fallback is applied by `mail_get_message` only when there is
    // no manual filing. `UNASSIGNED_MATTER`/empty means "not filed".
    if let Some(m) = store.get_message_matter(id)? {
        if is_real_matter(&m) {
            view.matter_id = Some(m);
        }
    }
    Ok(Some(view))
}

#[tauri::command]
pub async fn mail_get_message(
    state: State<'_, MailState>,
    id: String,
) -> Result<view::MailView, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set")?;
    let key =
        crate::commands::mail::crypto::get_or_create_master_key().map_err(|e| e.to_string())?;
    // Decrypt + DB read are blocking fs/sqlite work; run off the async runtime.
    let ws_for_view = workspace.clone();
    let id_for_lookup = id.clone();
    let view = tokio::task::spawn_blocking(move || get_message_with_key(&ws_for_view, &id, &key))
        .await
        .map_err(|e| format!("join: {e}"))?
        .map_err(|e| e.to_string())?;
    let mut view = view.ok_or_else(|| "message not found".to_string())?;
    // BUG-013: `get_message_with_key` already set `matter_id` from the durable
    // per-message override (the source of truth). When there's no manual filing,
    // fall back to the folder-level matter stamped in the RAG index so the
    // viewer still reflects a folder→matter mapping. Best-effort: a lookup
    // failure leaves it None and never blocks opening the email.
    if view.matter_id.is_none() {
        view.matter_id = folder_matter_from_rag(&workspace, &id_for_lookup).await;
    }
    Ok(view)
}

/// Browse / keyword-search stored email metadata without decrypting any blob.
/// All matching is done against the plaintext columns inside the SQLCipher DB.
/// Mirrors `mail_get_message` in its spawn_blocking + workspace-guard pattern.
#[tauri::command]
pub async fn mail_list_messages(
    state: State<'_, MailState>,
    query: MailListQuery,
) -> Result<MailListPage, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set")?;
    let key =
        crate::commands::mail::crypto::get_or_create_master_key().map_err(|e| e.to_string())?;
    // SQLite work is blocking; run off the async runtime.
    tokio::task::spawn_blocking(move || {
        let store =
            EncryptedMailStore::open_with_key(&workspace, &key).map_err(|e| e.to_string())?;
        store.list_messages(&query).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}
/// On-demand fetched attachment bytes, returned to the frontend for display.
/// The bytes never touch disk — they live only in IPC memory and the
/// renderer-process until the user closes the attachment view.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAttachmentData {
    pub bytes_base64: String,
    pub content_type: String,
    pub filename: String,
}

/// Fetch one attachment's bytes on demand from the provider.
///
/// Bytes are returned in memory only — never written to disk — so the
/// encryption boundary is preserved. The caller controls how long the bytes
/// live in the renderer.
///
/// IMAP attachment download is not yet implemented and returns an error.
#[tauri::command]
pub async fn mail_get_attachment(
    policy: State<'_, crate::network_policy::NetworkPolicy>,
    provider: String,
    account: String,
    message_id: String,
    attachment_id: String,
) -> Result<MailAttachmentData, String> {
    use base64::Engine;
    match provider.as_str() {
        "m365" => {
            crate::commands::connector_network::authorize_url(
                &policy,
                &crate::network_policy::OUTLOOK_MAIL_OAUTH,
                "https://login.microsoftonline.com",
            )
            .map_err(|e| e.to_string())?;
            crate::commands::connector_network::authorize_url(
                &policy,
                &crate::network_policy::OUTLOOK_MAIL_SYNC,
                "https://graph.microsoft.com",
            )
            .map_err(|e| e.to_string())?;
        }
        "gmail" => {
            crate::commands::connector_network::authorize_url(
                &policy,
                &crate::network_policy::GMAIL_OAUTH,
                "https://oauth2.googleapis.com",
            )
            .map_err(|e| e.to_string())?;
            crate::commands::connector_network::authorize_url(
                &policy,
                &crate::network_policy::GMAIL_SYNC,
                "https://gmail.googleapis.com",
            )
            .map_err(|e| e.to_string())?;
        }
        _ => {}
    }
    let mut cancellation = policy.register_cancellation();
    tokio::select! {
        result = async {
    match provider.as_str() {
        "m365" => {
            let token = fresh_access_token(&policy).await?;
            let client = crate::commands::mail::graph::GraphClient::new_with_refresh(
                token,
                graph_token_refresh(policy.inner().clone()),
            )
            .with_network_policy(policy.inner().clone(), crate::network_policy::OUTLOOK_MAIL_SYNC);
            let (bytes, content_type, filename) = client
                .get_attachment(&message_id, &attachment_id)
                .await
                .map_err(|e| e.to_string())?;
            Ok(MailAttachmentData {
                bytes_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
                content_type,
                filename,
            })
        }
        "gmail" => {
            let token = fresh_gmail_access_token(&policy).await?;
            let client = crate::commands::mail::gmail::api::GmailClient::new(token)
                .with_network_policy(policy.inner().clone(), crate::network_policy::GMAIL_SYNC);
            // Gmail attachment id is the part-body `attachmentId` — message_id
            // is the gmail message id (without the "gmail:<account>:" prefix).
            let raw_msg_id = message_id
                .strip_prefix(&format!("gmail:{}:", account))
                .unwrap_or(&message_id);
            let bytes = client
                .get_attachment_raw(raw_msg_id, &attachment_id)
                .await
                .map_err(|e| e.to_string())?;
            // Content-type is not returned by the Gmail attachments endpoint.
            // Return a neutral default; the frontend can infer from the filename.
            Ok(MailAttachmentData {
                bytes_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
                content_type: "application/octet-stream".to_string(),
                filename: attachment_id.clone(), // best we have without re-parsing the message
            })
        }
        "imap" => Err("IMAP attachment download is not yet supported".to_string()),
        other => Err(format!("unknown provider: {other}")),
    }
        } => result,
        _ = cancellation.cancelled() => Err("Offline Mode cancelled the attachment fetch.".to_string()),
    }
}

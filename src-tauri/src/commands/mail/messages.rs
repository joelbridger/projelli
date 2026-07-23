use super::matter::folder_matter_from_rag;
use super::*;
use crate::commands::mail::store::{EncryptedMailStore, MailListPage, MailListQuery, MailStore};
use serde::Serialize;
use std::io::Write;
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

/// Request that the native host validate and own the selected workspace for
/// the dark M4 foundation. This accepts a folder request only; it returns no
/// path, handle, generation, store, or authority to the renderer.
#[tauri::command]
pub async fn m4_workspace_open_selected(
    state: State<'_, MailState>,
    path: String,
) -> Result<(), String> {
    state
        .open_m4_workspace_selected(std::path::Path::new(&path))
        .await
        .map_err(|error| error.to_string())
}

/// Revoke the dark M4 generation during a normal workspace transition. It
/// takes no path or other authority-shaped renderer value and cannot open one.
#[tauri::command]
pub async fn m4_workspace_revoke(state: State<'_, MailState>) -> Result<(), String> {
    state.revoke_m4_workspace().await;
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
    view.provider = if rec.provider.is_empty() {
        None
    } else {
        Some(rec.provider.clone())
    };
    view.account = if rec.account.is_empty() {
        None
    } else {
        Some(rec.account.clone())
    };
    view.thread_id = rec.thread_id.clone();
    view.auth_result = rec.auth_result.clone();
    view.has_attachments = rec.has_attachments;
    view.attachments = rec.attachment_refs.clone();
    view.attachments_unsupported = rec.attachments_unsupported;
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

async fn fetch_attachment_bytes(
    provider: &str,
    account: &str,
    message_id: &str,
    attachment_id: &str,
) -> Result<(Vec<u8>, String, String), String> {
    match provider {
        "m365" => {
            let token = fresh_access_token().await?;
            let client = crate::commands::mail::graph::GraphClient::new_with_refresh(
                token,
                graph_token_refresh(),
            );
            client
                .get_attachment(message_id, attachment_id)
                .await
                .map_err(|e| e.to_string())
        }
        "gmail" => {
            let token = fresh_gmail_access_token().await?;
            let client = crate::commands::mail::gmail::api::GmailClient::new(token);
            // Gmail attachment id is the part-body `attachmentId` — message_id
            // is the gmail message id (without the "gmail:<account>:" prefix).
            let raw_msg_id = message_id
                .strip_prefix(&format!("gmail:{}:", account))
                .unwrap_or(message_id);
            let bytes = client
                .get_attachment_raw(raw_msg_id, attachment_id)
                .await
                .map_err(|e| e.to_string())?;
            Ok((
                bytes,
                "application/octet-stream".to_string(),
                attachment_id.to_string(),
            ))
        }
        "imap" => Err("IMAP attachment download is not yet supported".to_string()),
        other => Err(format!("unknown provider: {other}")),
    }
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
    provider: String,
    account: String,
    message_id: String,
    attachment_id: String,
) -> Result<MailAttachmentData, String> {
    use base64::Engine;
    let (bytes, content_type, filename) =
        fetch_attachment_bytes(&provider, &account, &message_id, &attachment_id).await?;
    Ok(MailAttachmentData {
        bytes_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        content_type,
        filename,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailPersistedAttachment {
    pub path: String,
    pub filename: String,
    pub content_type: String,
    pub byte_size: u64,
}

fn normalize_relative_dir(destination_dir: &str) -> String {
    destination_dir
        .trim()
        .replace('\\', "/")
        .trim_matches('/')
        .to_string()
}

fn sanitize_attachment_filename(filename: &str) -> String {
    let mut safe = filename
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    safe = safe
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(['.', ' '])
        .to_string();
    if safe.is_empty() {
        safe = "attachment".to_string();
    }
    if crate::commands::pathguard::reject_reserved_windows_name(&safe).is_err() {
        safe = format!("attachment_{safe}");
    }
    safe
}

fn unique_filename(base: &str, attempt: u32) -> String {
    if attempt == 0 {
        return base.to_string();
    }
    if let Some((stem, ext)) = base.rsplit_once('.') {
        if !stem.is_empty() && !ext.is_empty() {
            return format!("{stem} ({}){}{}", attempt + 1, ".", ext);
        }
    }
    format!("{base} ({})", attempt + 1)
}

fn join_relative_file(destination_dir: &str, filename: &str) -> String {
    if destination_dir.is_empty() || destination_dir == "." {
        filename.to_string()
    } else {
        format!("{destination_dir}/{filename}")
    }
}

pub(crate) fn persist_attachment_bytes(
    workspace: &std::path::Path,
    destination_dir: &str,
    suggested_filename: &str,
    bytes: &[u8],
    content_type: &str,
) -> Result<MailPersistedAttachment, String> {
    let canon_ws = workspace
        .canonicalize()
        .map_err(|e| format!("workspace is not available: {e}"))?;
    let destination_dir = normalize_relative_dir(destination_dir);
    let safe_filename = sanitize_attachment_filename(suggested_filename);
    let destination_abs =
        crate::commands::pathguard::resolve_creatable(&canon_ws, &destination_dir, &canon_ws)?;
    std::fs::create_dir_all(&destination_abs)
        .map_err(|e| format!("create attachment folder: {e}"))?;

    for attempt in 0..1000 {
        let filename = unique_filename(&safe_filename, attempt);
        let relative_path = join_relative_file(&destination_dir, &filename);
        let target_abs =
            crate::commands::pathguard::resolve_creatable(&canon_ws, &relative_path, &canon_ws)?;
        if let Some(parent) = target_abs.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create attachment parent folder: {e}"))?;
        }
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target_abs)
        {
            Ok(mut file) => {
                file.write_all(bytes)
                    .map_err(|e| format!("write attachment: {e}"))?;
                return Ok(MailPersistedAttachment {
                    path: relative_path,
                    filename,
                    content_type: content_type.to_string(),
                    byte_size: bytes.len() as u64,
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("create attachment file: {e}")),
        }
    }

    Err("could not choose a unique attachment filename".to_string())
}

#[tauri::command]
pub async fn mail_persist_attachment(
    state: State<'_, MailState>,
    provider: String,
    account: String,
    message_id: String,
    attachment_id: String,
    destination_dir: String,
    filename: Option<String>,
) -> Result<MailPersistedAttachment, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set")?;
    let (bytes, content_type, provider_filename) =
        fetch_attachment_bytes(&provider, &account, &message_id, &attachment_id).await?;
    let suggested_filename = filename
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(&provider_filename)
        .to_string();

    tokio::task::spawn_blocking(move || {
        persist_attachment_bytes(
            &workspace,
            &destination_dir,
            &suggested_filename,
            &bytes,
            &content_type,
        )
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::persist_attachment_bytes;

    #[test]
    fn persist_attachment_sanitizes_and_uniquifies_filename() {
        let dir = tempfile::TempDir::new().unwrap();
        let first = persist_attachment_bytes(
            dir.path(),
            "Requests/onboarding/email-replies/msg-1",
            "Drivers:/License?.pdf",
            b"one",
            "application/pdf",
        )
        .expect("first write");
        let second = persist_attachment_bytes(
            dir.path(),
            "Requests/onboarding/email-replies/msg-1",
            "Drivers:/License?.pdf",
            b"two",
            "application/pdf",
        )
        .expect("second write");

        assert_eq!(first.filename, "Drivers__License_.pdf");
        assert_eq!(second.filename, "Drivers__License_ (2).pdf");
        assert_eq!(std::fs::read(dir.path().join(&first.path)).unwrap(), b"one");
        assert_eq!(
            std::fs::read(dir.path().join(&second.path)).unwrap(),
            b"two"
        );
    }

    #[test]
    fn persist_attachment_refuses_destination_traversal() {
        let dir = tempfile::TempDir::new().unwrap();
        let err = persist_attachment_bytes(
            dir.path(),
            "../outside",
            "license.pdf",
            b"nope",
            "application/pdf",
        )
        .unwrap_err();
        assert!(err.contains(".."), "got: {err}");
        assert!(!dir.path().join("../outside/license.pdf").exists());
    }

    #[test]
    fn persist_attachment_does_not_overwrite_existing_file() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join("Replies")).unwrap();
        std::fs::write(dir.path().join("Replies/statement.pdf"), b"existing").unwrap();

        let saved = persist_attachment_bytes(
            dir.path(),
            "Replies",
            "statement.pdf",
            b"new",
            "application/pdf",
        )
        .expect("write");

        assert_eq!(saved.path, "Replies/statement (2).pdf");
        assert_eq!(
            std::fs::read(dir.path().join("Replies/statement.pdf")).unwrap(),
            b"existing"
        );
        assert_eq!(std::fs::read(dir.path().join(saved.path)).unwrap(), b"new");
    }
}

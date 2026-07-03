use super::*;
use crate::commands::mail::store::{EncryptedMailStore, MailStore};
use tauri::State;

// ─────────────────────────────────────────────────────────────────────────────
// mail_send — compose and send from any connected provider
// ─────────────────────────────────────────────────────────────────────────────

/// Send an email via the named provider/account.
///
/// Parameters
/// ----------
/// * `provider`       — "m365" | "gmail" | "imap"
/// * `account`        — provider account id (e.g. "default" or the IMAP username)
/// * `to`/`cc`/`bcc`  — recipient address strings (RFC5322 `name <addr>` or bare addr)
/// * `subject`        — email subject
/// * `body`           — plain-text body (no HTML; Advisor Prep Hero is plain-text first)
/// * `in_reply_to_id` — provider message id of the message being replied to
///                      (the part after `mail:` in a citation source; a leading
///                      `mail:` prefix is tolerated). When present the command
///                      fetches the original message's `internet_message_id` and
///                      `references` header for threading.
///
/// Returns
/// -------
/// The sent message id (provider-specific) on success, or an empty string for
/// providers that do not return one (SMTP, Graph sendMail). The front end
/// should treat any non-error return as success.
///
/// Error strings
/// -------------
/// * `"scope_upgrade_required"` — the stored OAuth token predates the Mail.Send
///   scope; the frontend should prompt the user to reconnect (re-run the login
///   flow) to grant send permission.
/// * Any other string — a human-readable error.
#[tauri::command]
pub async fn mail_send(
    state: State<'_, MailState>,
    provider: String,
    account: String,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body: String,
    in_reply_to_id: Option<String>,
    attachments: Option<Vec<AttachmentInput>>,
) -> Result<String, String> {
    // Never log the body (may contain privileged content) or addresses (PII).
    // Log only the provider+account+subject-length for diagnostics.
    log::info!(
        "mail_send: provider={provider} account={account} subject_len={} attachments={}",
        subject.len(),
        attachments.as_ref().map(|a| a.len()).unwrap_or(0),
    );

    match provider.as_str() {
        "m365" => send_m365(state, to, cc, bcc, subject, body, in_reply_to_id, attachments.unwrap_or_default()).await,
        "gmail" => send_gmail(state, to, cc, bcc, subject, body, in_reply_to_id, attachments.unwrap_or_default()).await,
        "imap" => send_imap(state, account, to, cc, bcc, subject, body, in_reply_to_id, attachments.unwrap_or_default()).await,
        other => Err(format!("unknown provider: {other}")),
    }
}

/// Resolve the internet_message_id + references from a stored message record.
/// Returns (internet_message_id, references). Both may be None/empty.
/// Reads the encrypted blob, parses the YAML frontmatter for these fields.
/// Errors are non-fatal for threading: if we cannot resolve, we send without
/// threading headers rather than blocking the send.
fn resolve_threading_headers(
    workspace: &std::path::Path,
    msg_id: &str,
    key: &[u8; 32],
) -> (Option<String>, Option<String>) {
    let store = match EncryptedMailStore::open_with_key(workspace, key) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("mail_send: open store for threading: {e}");
            return (None, None);
        }
    };
    let rec = match store.get_record(msg_id) {
        Ok(Some(r)) => r,
        Ok(None) => return (None, None),
        Err(e) => {
            log::warn!("mail_send: get_record {msg_id} for threading: {e}");
            return (None, None);
        }
    };
    let bytes = match store.read_blob_with_key(&rec.relative_path, workspace, key) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("mail_send: read blob {msg_id} for threading: {e}");
            return (None, None);
        }
    };
    let markdown = match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => return (None, None),
    };
    // Parse the YAML frontmatter for internet_message_id and references.
    let mut internet_message_id: Option<String> = None;
    let mut references: Option<String> = None;
    let mut in_fm = false;
    for line in markdown.lines() {
        if line.trim() == "---" {
            if in_fm {
                break;
            }
            in_fm = true;
            continue;
        }
        if !in_fm {
            continue;
        }
        if let Some((key_name, val)) = line.split_once(':') {
            match key_name.trim() {
                "internet_message_id" => {
                    let v = val.trim().trim_matches('"');
                    if !v.is_empty() {
                        internet_message_id = Some(v.to_string());
                    }
                }
                "references" => {
                    let v = val.trim().trim_matches('"');
                    if !v.is_empty() {
                        references = Some(v.to_string());
                    }
                }
                _ => {}
            }
        }
    }
    (internet_message_id, references)
}

async fn send_m365(
    _state: State<'_, MailState>,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body: String,
    _in_reply_to_id: Option<String>,
    attachments: Vec<AttachmentInput>,
) -> Result<String, String> {
    let token = fresh_access_token().await?; // returns "scope_upgrade_required" when needed
    let client = crate::commands::mail::graph::GraphClient::new_with_refresh(
        token,
        graph_token_refresh(),
    );

    // conversation_id is not stored in MailRecord; pass None for now.
    // Threading for M365 replies can be added when conversationId is stored.
    client
        .send_message(
            &to,
            &cc,
            &bcc,
            &subject,
            &body,
            None,
            true,
            &attachments,
        )
        .await
        .map_err(|e| e.to_string())
}

async fn send_gmail(
    state: State<'_, MailState>,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body: String,
    in_reply_to_id: Option<String>,
    attachments: Vec<AttachmentInput>,
) -> Result<String, String> {
    let token = fresh_gmail_access_token().await?; // returns "scope_upgrade_required" when needed

    // Resolve threading headers from the stored message.
    let (in_reply_to, references) = if let Some(ref orig_id) = in_reply_to_id {
        let raw_id = orig_id.strip_prefix("mail:").unwrap_or(orig_id).to_string();
        let workspace = state.workspace.lock().await.clone();
        if let Some(ws) = workspace {
            let key = crate::commands::mail::crypto::get_or_create_master_key()
                .map_err(|e| e.to_string())?;
            let ws2 = ws.clone();
            let key2 = key;
            let raw_id2 = raw_id.clone();
            tokio::task::spawn_blocking(move || {
                resolve_threading_headers(&ws2, &raw_id2, &key2)
            })
            .await
            .unwrap_or((None, None))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    // Fetch the sender address from the Gmail profile.
    let gmail_client = crate::commands::mail::gmail::api::GmailClient::new(token.clone());
    let from = gmail_client
        .get_sender_address()
        .await
        .map_err(|e| e.to_string())?;

    gmail_client
        .send_message(
            &from,
            &to,
            &cc,
            &bcc,
            &subject,
            &body,
            in_reply_to.as_deref(),
            references.as_deref(),
            &attachments,
        )
        .await
        .map_err(|e| e.to_string())
}

async fn send_imap(
    state: State<'_, MailState>,
    _account: String,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body: String,
    in_reply_to_id: Option<String>,
    attachments: Vec<AttachmentInput>,
) -> Result<String, String> {
    let (cfg, password) = load_imap_config().ok_or("IMAP not connected")?;

    // Resolve threading headers.
    let (in_reply_to, references) = if let Some(ref orig_id) = in_reply_to_id {
        let raw_id = orig_id.strip_prefix("mail:").unwrap_or(orig_id).to_string();
        let workspace = state.workspace.lock().await.clone();
        if let Some(ws) = workspace {
            let key = crate::commands::mail::crypto::get_or_create_master_key()
                .map_err(|e| e.to_string())?;
            tokio::task::spawn_blocking(move || {
                resolve_threading_headers(&ws, &raw_id, &key)
            })
            .await
            .unwrap_or((None, None))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    let from = cfg.username.clone(); // username is the email address for IMAP
    let host = cfg.host.clone();
    let smtp_port: u16 = 587;

    crate::commands::mail::imap::send::smtp_send(
        &host,
        smtp_port,
        &cfg.username,
        &password,
        &from,
        &to,
        &cc,
        &bcc,
        &subject,
        &body,
        in_reply_to.as_deref(),
        references.as_deref(),
        &attachments,
    )
    .await
    .map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// mail_save_draft — Wave 0: save an AI-proposed draft into the account's REAL
// mailbox Drafts folder (Graph POST /me/messages, Gmail drafts.create), so the
// advisor reviews and sends from their own email client. Never sends.
// ─────────────────────────────────────────────────────────────────────────────

/// Parse a Wave-0 composite `account_id` ("<provider>:<account>", e.g.
/// "m365:default", "gmail:default") into (provider, account).
///
/// The composite form exists because the cross-wave contract pins the command
/// signature to a single `account_id` parameter while the mail stack addresses
/// accounts as (provider, account) pairs (see `ConnectedAccount`). Split on the
/// FIRST ':' only — IMAP account names are user-controlled strings.
fn parse_account_id(account_id: &str) -> Result<(String, String), String> {
    match account_id.split_once(':') {
        Some((p, a)) if !p.is_empty() && !a.is_empty() => Ok((p.to_string(), a.to_string())),
        _ => Err(format!(
            "invalid account_id {account_id:?}: expected \"<provider>:<account>\""
        )),
    }
}

/// Save a draft email into the provider's real Drafts folder. NEVER sends.
///
/// Parameters
/// ----------
/// * `account_id`  — "<provider>:<account>" (compose with the frontend's
///                    `composeMailAccountId`); providers: "m365" | "gmail".
///                    IMAP has no draft-save path (would need IMAP APPEND) and
///                    returns an error.
/// * `to`          — recipient address strings. ONLY ever sourced from the
///                    user-controlled To field — never from AI output.
/// * `subject`     — draft subject.
/// * `body_html`   — HTML body (per the cross-wave contract).
/// * `in_reply_to` — provider message id of the message being replied to
///                    (a leading `mail:` prefix is tolerated). None for a
///                    fresh (non-reply) draft — the normal Wave 0 case.
///
/// Returns the PROVIDER DRAFT ID on success.
///
/// Error strings: `"scope_upgrade_required"` (stored token predates the
/// Mail.ReadWrite / gmail.compose scopes; the frontend prompts a reconnect,
/// same as mail_send's scope handling) or a human-readable message.
#[tauri::command]
pub async fn mail_save_draft(
    state: State<'_, MailState>,
    account_id: String,
    to: Vec<String>,
    subject: String,
    body_html: String,
    in_reply_to: Option<String>,
) -> Result<String, String> {
    // Never log recipients or the body (PII / privileged content).
    log::info!(
        "mail_save_draft: account_id={account_id} subject_len={}",
        subject.len()
    );
    let (provider, _account) = parse_account_id(&account_id)?;
    match provider.as_str() {
        "m365" => save_draft_m365(to, subject, body_html, in_reply_to).await,
        "gmail" => save_draft_gmail(state, to, subject, body_html, in_reply_to).await,
        "imap" => Err("saving drafts is not supported for IMAP accounts".to_string()),
        other => Err(format!("unknown provider: {other}")),
    }
}

async fn save_draft_m365(
    to: Vec<String>,
    subject: String,
    body_html: String,
    in_reply_to: Option<String>,
) -> Result<String, String> {
    // Surfaces "scope_upgrade_required" for pre-upgrade tokens.
    let token = fresh_access_token().await?;
    let client = crate::commands::mail::graph::GraphClient::new_with_refresh(
        token,
        graph_token_refresh(),
    );
    match in_reply_to {
        Some(orig) => {
            let raw = orig.strip_prefix("mail:").unwrap_or(&orig).to_string();
            client
                .create_reply_draft(&raw, &to, &subject, &body_html)
                .await
                .map_err(|e| e.to_string())
        }
        None => client
            .create_draft(&to, &subject, &body_html)
            .await
            .map_err(|e| e.to_string()),
    }
}

async fn save_draft_gmail(
    state: State<'_, MailState>,
    to: Vec<String>,
    subject: String,
    body_html: String,
    in_reply_to: Option<String>,
) -> Result<String, String> {
    let token = fresh_gmail_access_token().await?;

    // Reply threading headers from the stored original (same path send_gmail
    // uses; non-fatal if unresolvable — the draft is saved unthreaded).
    let (in_reply_to_hdr, references) = if let Some(ref orig_id) = in_reply_to {
        let raw_id = orig_id.strip_prefix("mail:").unwrap_or(orig_id).to_string();
        let workspace = state.workspace.lock().await.clone();
        if let Some(ws) = workspace {
            let key = crate::commands::mail::crypto::get_or_create_master_key()
                .map_err(|e| e.to_string())?;
            tokio::task::spawn_blocking(move || resolve_threading_headers(&ws, &raw_id, &key))
                .await
                .unwrap_or((None, None))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    let gmail_client = crate::commands::mail::gmail::api::GmailClient::new(token);
    let from = gmail_client
        .get_sender_address()
        .await
        .map_err(|e| e.to_string())?;
    gmail_client
        .create_draft(
            &from,
            &to,
            &subject,
            &body_html,
            in_reply_to_hdr.as_deref(),
            references.as_deref(),
        )
        .await
        .map_err(|e| {
            // A pre-upgrade Gmail access token lacks gmail.compose and the API
            // answers 403. Map it to the same reconnect signal mail_send uses.
            // VERIFY-LIVE: confirm 403 (not 401) on a real pre-upgrade token.
            let msg = e.to_string();
            if msg.contains("HTTP 403") {
                "scope_upgrade_required".to_string()
            } else {
                msg
            }
        })
}

#[cfg(test)]
mod tests {
    use super::parse_account_id;

    #[test]
    fn parse_account_id_splits_provider_and_account() {
        assert_eq!(
            parse_account_id("m365:default").unwrap(),
            ("m365".to_string(), "default".to_string())
        );
        assert_eq!(
            parse_account_id("gmail:default").unwrap(),
            ("gmail".to_string(), "default".to_string())
        );
        // IMAP accounts are usernames that may themselves contain '@' — only
        // the FIRST ':' splits, the rest stays in the account part.
        assert_eq!(
            parse_account_id("imap:user@example.com").unwrap(),
            ("imap".to_string(), "user@example.com".to_string())
        );
    }

    #[test]
    fn parse_account_id_rejects_malformed_ids() {
        assert!(parse_account_id("m365").is_err());
        assert!(parse_account_id(":default").is_err());
        assert!(parse_account_id("m365:").is_err());
        assert!(parse_account_id("").is_err());
    }
}

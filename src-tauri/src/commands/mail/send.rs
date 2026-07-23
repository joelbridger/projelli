use super::*;
use crate::commands::mail::store::{EncryptedMailStore, MailStore};
use serde::Serialize;
use sha2::{Digest, Sha256};
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
        "m365" => {
            send_m365(
                state,
                to,
                cc,
                bcc,
                subject,
                body,
                in_reply_to_id,
                attachments.unwrap_or_default(),
            )
            .await
        }
        "gmail" => {
            send_gmail(
                state,
                to,
                cc,
                bcc,
                subject,
                body,
                in_reply_to_id,
                attachments.unwrap_or_default(),
            )
            .await
        }
        "imap" => {
            send_imap(
                state,
                account,
                to,
                cc,
                bcc,
                subject,
                body,
                in_reply_to_id,
                attachments.unwrap_or_default(),
            )
            .await
        }
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
    let client =
        crate::commands::mail::graph::GraphClient::new_with_refresh(token, graph_token_refresh());

    // conversation_id is not stored in MailRecord; pass None for now.
    // Threading for M365 replies can be added when conversationId is stored.
    client
        .send_message(&to, &cc, &bcc, &subject, &body, None, true, &attachments)
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
            tokio::task::spawn_blocking(move || resolve_threading_headers(&ws2, &raw_id2, &key2))
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
            tokio::task::spawn_blocking(move || resolve_threading_headers(&ws, &raw_id, &key))
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
// mail_send_existing_draft — explicit, approval-bound send of one saved draft
// ─────────────────────────────────────────────────────────────────────────────

/// The only three honest outcomes for an explicit existing-draft send.
///
/// `outcome-unknown` is intentionally not an error and deliberately carries
/// no retry instruction. A transport failure after the POST began can mean the
/// provider accepted the draft, so callers must reconcile with the mailbox
/// instead of blindly sending it again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ExistingDraftSendResult {
    Confirmed {
        provider: String,
        provider_receipt_id: Option<String>,
    },
    FailedBeforeSend {
        provider: String,
        reason: ExistingDraftFailureReason,
    },
    OutcomeUnknown {
        provider: String,
        reason: ExistingDraftUnknownReason,
        do_not_retry_automatically: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExistingDraftFailureReason {
    UnsupportedProvider,
    AccountMismatch,
    InvalidDraftId,
    DraftNotFoundOrUnavailable,
    DraftIdentityMismatch,
    DraftIsNotEditable,
    RecipientsMismatch,
    SubjectMismatch,
    BodyFingerprintMismatch,
    ProviderRefused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExistingDraftUnknownReason {
    ProviderResponseLost,
}

/// Explicitly send one provider draft only after proving that the currently
/// saved draft still matches the caller's approved snapshot.
///
/// There is deliberately no UI caller today. Importing its typed frontend
/// wrapper does nothing; a future human-triggered flow must call this command
/// with every approval field itself.
#[tauri::command]
pub async fn mail_send_existing_draft(
    _state: State<'_, MailState>,
    provider: String,
    account: String,
    draft_id: String,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    approved_body_fingerprint: String,
) -> Result<ExistingDraftSendResult, String> {
    // Never log the draft id, recipient addresses, subject, body, or provider
    // responses. These values may all expose client information.
    let failed = |reason| ExistingDraftSendResult::FailedBeforeSend {
        provider: safe_provider_label(&provider),
        reason,
    };

    if let Err(reason) =
        validate_existing_draft_request(&provider, &account, &draft_id, &approved_body_fingerprint)
    {
        return Ok(failed(reason));
    }

    let result = match provider.as_str() {
        "m365" => {
            let token = match fresh_access_token().await {
                Ok(token) => token,
                Err(_) => {
                    return Ok(failed(
                        ExistingDraftFailureReason::DraftNotFoundOrUnavailable,
                    ))
                }
            };
            let client = crate::commands::mail::graph::GraphClient::new_with_refresh(
                token,
                graph_token_refresh(),
            );
            let draft = match client.get_existing_draft(&draft_id).await {
                Ok(draft) => draft,
                Err(_) => {
                    return Ok(failed(
                        ExistingDraftFailureReason::DraftNotFoundOrUnavailable,
                    ))
                }
            };
            if let Err(reason) = validate_existing_draft_snapshot(
                &draft.id,
                Some(draft.is_draft),
                &draft_id,
                &draft.to,
                &draft.cc,
                &draft.bcc,
                &to,
                &cc,
                &bcc,
                &draft.subject,
                &subject,
                &draft.body,
                &approved_body_fingerprint,
            ) {
                return Ok(failed(reason));
            }
            match client.send_existing_draft(&draft_id).await {
                Ok(()) => ExistingDraftSendResult::Confirmed {
                    provider: "m365".to_string(),
                    // Graph's HTTP 202 is accepted by the provider, not proof
                    // of mailbox delivery. The validated draft id is its only
                    // available provider receipt.
                    provider_receipt_id: Some(draft_id),
                },
                Err(crate::commands::mail::graph::GraphExistingDraftSendError::ProviderRefused) => {
                    failed(ExistingDraftFailureReason::ProviderRefused)
                }
                Err(crate::commands::mail::graph::GraphExistingDraftSendError::OutcomeUnknown) => {
                    ExistingDraftSendResult::OutcomeUnknown {
                        provider: "m365".to_string(),
                        reason: ExistingDraftUnknownReason::ProviderResponseLost,
                        do_not_retry_automatically: true,
                    }
                }
            }
        }
        "gmail" => {
            let token = match fresh_gmail_access_token().await {
                Ok(token) => token,
                Err(_) => {
                    return Ok(failed(
                        ExistingDraftFailureReason::DraftNotFoundOrUnavailable,
                    ))
                }
            };
            let client = crate::commands::mail::gmail::api::GmailClient::new(token);
            let draft = match client.get_existing_draft(&draft_id).await {
                Ok(draft) => draft,
                Err(_) => {
                    return Ok(failed(
                        ExistingDraftFailureReason::DraftNotFoundOrUnavailable,
                    ))
                }
            };
            if let Err(reason) = validate_existing_draft_snapshot(
                &draft.id,
                None,
                &draft_id,
                &draft.to,
                &draft.cc,
                &draft.bcc,
                &to,
                &cc,
                &bcc,
                &draft.subject,
                &subject,
                &draft.body,
                &approved_body_fingerprint,
            ) {
                return Ok(failed(reason));
            }
            match client.send_existing_draft(&draft_id).await {
                Ok(message_id) => ExistingDraftSendResult::Confirmed {
                    provider: "gmail".to_string(),
                    provider_receipt_id: Some(message_id),
                },
                Err(
                    crate::commands::mail::gmail::api::GmailExistingDraftSendError::ProviderRefused,
                ) => failed(ExistingDraftFailureReason::ProviderRefused),
                Err(
                    crate::commands::mail::gmail::api::GmailExistingDraftSendError::OutcomeUnknown,
                ) => ExistingDraftSendResult::OutcomeUnknown {
                    provider: "gmail".to_string(),
                    reason: ExistingDraftUnknownReason::ProviderResponseLost,
                    do_not_retry_automatically: true,
                },
            }
        }
        _ => unreachable!("provider was checked before dispatch"),
    };
    Ok(result)
}

fn safe_provider_label(provider: &str) -> String {
    match provider {
        "m365" | "gmail" | "imap" => provider.to_string(),
        _ => "unsupported".to_string(),
    }
}

fn validate_existing_draft_request(
    provider: &str,
    account: &str,
    draft_id: &str,
    approved_body_fingerprint: &str,
) -> Result<(), ExistingDraftFailureReason> {
    if draft_id.trim().is_empty()
        || approved_body_fingerprint.len() != 64
        || !approved_body_fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(ExistingDraftFailureReason::InvalidDraftId);
    }
    match provider {
        "m365" if account == M365_ACCOUNT => Ok(()),
        "gmail" if account == GMAIL_ACCOUNT => Ok(()),
        "m365" | "gmail" => Err(ExistingDraftFailureReason::AccountMismatch),
        _ => Err(ExistingDraftFailureReason::UnsupportedProvider),
    }
}

#[allow(clippy::too_many_arguments)]
fn validate_existing_draft_snapshot(
    fetched_id: &str,
    is_draft: Option<bool>,
    approved_id: &str,
    fetched_to: &[String],
    fetched_cc: &[String],
    fetched_bcc: &[String],
    approved_to: &[String],
    approved_cc: &[String],
    approved_bcc: &[String],
    fetched_subject: &str,
    approved_subject: &str,
    fetched_body: &str,
    approved_body_fingerprint: &str,
) -> Result<(), ExistingDraftFailureReason> {
    if fetched_id != approved_id {
        return Err(ExistingDraftFailureReason::DraftIdentityMismatch);
    }
    if is_draft == Some(false) {
        return Err(ExistingDraftFailureReason::DraftIsNotEditable);
    }
    if !same_recipients(fetched_to, approved_to)
        || !same_recipients(fetched_cc, approved_cc)
        || !same_recipients(fetched_bcc, approved_bcc)
    {
        return Err(ExistingDraftFailureReason::RecipientsMismatch);
    }
    if fetched_subject != approved_subject {
        return Err(ExistingDraftFailureReason::SubjectMismatch);
    }
    if !fingerprint_matches(fetched_body, approved_body_fingerprint) {
        return Err(ExistingDraftFailureReason::BodyFingerprintMismatch);
    }
    Ok(())
}

fn fingerprint_matches(body: &str, approved_fingerprint: &str) -> bool {
    let actual = format!("{:x}", Sha256::digest(body.as_bytes()));
    actual == approved_fingerprint
}

fn same_recipients(actual: &[String], approved: &[String]) -> bool {
    fn canonical(values: &[String]) -> Vec<String> {
        let mut values: Vec<String> = values
            .iter()
            .map(|value| {
                let trimmed = value.trim();
                let address = trimmed
                    .rsplit_once('<')
                    .and_then(|(_, rest)| rest.strip_suffix('>'))
                    .unwrap_or(trimmed)
                    .trim();
                address.to_ascii_lowercase()
            })
            .collect();
        values.sort();
        values
    }
    canonical(actual) == canonical(approved)
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
    let client =
        crate::commands::mail::graph::GraphClient::new_with_refresh(token, graph_token_refresh());
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
    use super::*;

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

    #[test]
    fn existing_draft_request_refuses_wrong_provider_account_or_id_before_send() {
        let fingerprint = "a".repeat(64);
        assert_eq!(
            validate_existing_draft_request("imap", "default", "draft-1", &fingerprint),
            Err(ExistingDraftFailureReason::UnsupportedProvider)
        );
        assert_eq!(
            validate_existing_draft_request("gmail", "another-account", "draft-1", &fingerprint),
            Err(ExistingDraftFailureReason::AccountMismatch)
        );
        assert_eq!(
            validate_existing_draft_request("m365", "default", "", &fingerprint),
            Err(ExistingDraftFailureReason::InvalidDraftId)
        );
    }

    #[test]
    fn existing_draft_snapshot_refuses_identity_recipients_subject_and_body_changes() {
        let body = "approved private body";
        let fingerprint = format!("{:x}", Sha256::digest(body.as_bytes()));
        let valid = || {
            validate_existing_draft_snapshot(
                "draft-1",
                Some(true),
                "draft-1",
                &["client@example.com".into()],
                &[],
                &[],
                &["Client <client@example.com>".into()],
                &[],
                &[],
                "approved private subject",
                "approved private subject",
                body,
                &fingerprint,
            )
        };
        assert_eq!(valid(), Ok(()));
        assert_eq!(
            validate_existing_draft_snapshot(
                "other",
                Some(true),
                "draft-1",
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                "s",
                "s",
                body,
                &fingerprint
            ),
            Err(ExistingDraftFailureReason::DraftIdentityMismatch)
        );
        assert_eq!(
            validate_existing_draft_snapshot(
                "draft-1",
                Some(true),
                "draft-1",
                &["other@example.com".into()],
                &[],
                &[],
                &["client@example.com".into()],
                &[],
                &[],
                "s",
                "s",
                body,
                &fingerprint
            ),
            Err(ExistingDraftFailureReason::RecipientsMismatch)
        );
        assert_eq!(
            validate_existing_draft_snapshot(
                "draft-1",
                Some(true),
                "draft-1",
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                "changed",
                "approved",
                body,
                &fingerprint
            ),
            Err(ExistingDraftFailureReason::SubjectMismatch)
        );
        assert_eq!(
            validate_existing_draft_snapshot(
                "draft-1",
                Some(true),
                "draft-1",
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                "s",
                "s",
                "changed",
                &fingerprint
            ),
            Err(ExistingDraftFailureReason::BodyFingerprintMismatch)
        );
    }

    #[test]
    fn unknown_result_has_no_blind_retry_signal_or_sensitive_content() {
        let result = ExistingDraftSendResult::OutcomeUnknown {
            provider: "gmail".into(),
            reason: ExistingDraftUnknownReason::ProviderResponseLost,
            do_not_retry_automatically: true,
        };
        let value = serde_json::to_string(&result).unwrap();
        assert!(value.contains("outcome-unknown"));
        assert!(value.contains("doNotRetryAutomatically\":true"));
        assert!(!value.contains("client@example.com"));
        assert!(!value.contains("private subject"));
        assert!(!value.contains("private body"));
    }
}

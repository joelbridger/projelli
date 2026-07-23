//! Encrypted approved-draft claim history, sealed away from provider adapters.

#![allow(dead_code)] // Deliberately dark until sealed adapters are connected.

use anyhow::{bail, Context, Result};
use rusqlite::{params, OptionalExtension, Transaction};

use crate::commands::{
    crm::{core_model::ApprovedDraftClaimRecord, core_store::CrmCoreStore},
    mail::{
        verified_m4_credentials::VerifiedCredentialBinding,
        verified_mailbox::{
            pre_dispatch_guard, reload_exact_current_mailbox, VerifiedMailboxRecord,
        },
        verified_workspace_authority::VerifiedWorkspaceAuthority,
    },
};

/// Content-only provider input derived from an approved claim. Provider
/// identity is intentionally absent, and the user-facing subject keeps its
/// distinct `draft_subject` name so it cannot be confused with a provider
/// subject.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ApprovedDraftPayloadView {
    recipients_json: String,
    draft_subject: String,
    body: String,
}

impl ApprovedDraftPayloadView {
    pub(super) fn recipients_json(&self) -> &str {
        &self.recipients_json
    }

    pub(super) fn draft_subject(&self) -> &str {
        &self.draft_subject
    }

    pub(super) fn body(&self) -> &str {
        &self.body
    }
}

/// Narrows an encrypted approved-claim record to the only content a provider
/// adapter will later need. It never exposes or accepts provider identity.
pub(super) fn approved_draft_payload_view(
    claim: &ApprovedDraftClaimRecord,
) -> Result<ApprovedDraftPayloadView> {
    for value in [&claim.recipients_json, &claim.draft_subject, &claim.body] {
        if value.trim().is_empty() {
            bail!("approved draft payload has a missing required field")
        }
    }
    Ok(ApprovedDraftPayloadView {
        recipients_json: claim.recipients_json.clone(),
        draft_subject: claim.draft_subject.clone(),
        body: claim.body.clone(),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DraftClaimState {
    Prepared,
    Approved,
    Claimed,
    Saving,
    Saved,
    Unknown,
    Failed,
    Expired,
}

impl DraftClaimState {
    fn as_db(self) -> &'static str {
        match self {
            Self::Prepared => "prepared",
            Self::Approved => "approved",
            Self::Claimed => "claimed",
            Self::Saving => "saving",
            Self::Saved => "saved",
            Self::Unknown => "unknown",
            Self::Failed => "failed",
            Self::Expired => "expired",
        }
    }
    fn from_db(value: &str) -> Result<Self> {
        match value {
            "prepared" => Ok(Self::Prepared),
            "approved" => Ok(Self::Approved),
            "claimed" => Ok(Self::Claimed),
            "saving" => Ok(Self::Saving),
            "saved" => Ok(Self::Saved),
            "unknown" => Ok(Self::Unknown),
            "failed" => Ok(Self::Failed),
            "expired" => Ok(Self::Expired),
            _ => bail!("invalid draft-claim state"),
        }
    }
    pub(super) fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Prepared, Self::Approved | Self::Expired)
                | (Self::Approved, Self::Claimed | Self::Expired)
                | (Self::Claimed, Self::Saving | Self::Expired)
                | (Self::Saving, Self::Saved | Self::Unknown | Self::Failed)
        )
    }
}

/// Existing native approval content. Its fields remain separate from identity.
#[derive(Debug)]
pub(super) struct ApprovedDraftClaimInput {
    client_context: String,
    meeting_context: String,
    recipients_json: String,
    draft_subject: String,
    body: String,
    content_hash: String,
    approval_receipt: String,
    idempotency_key: String,
}

impl ApprovedDraftClaimInput {
    fn validate(&self) -> Result<()> {
        for value in [
            &self.client_context,
            &self.meeting_context,
            &self.recipients_json,
            &self.draft_subject,
            &self.body,
            &self.content_hash,
            &self.approval_receipt,
            &self.idempotency_key,
        ] {
            if value.trim().is_empty() {
                bail!("approved draft claim has a missing required field")
            }
        }
        Ok(())
    }
}

fn decode_claim(row: &rusqlite::Row<'_>) -> rusqlite::Result<ApprovedDraftClaimRecord> {
    Ok(ApprovedDraftClaimRecord {
        claim_handle: row.get(0)?,
        mailbox_handle: row.get(1)?,
        mailbox_version: row.get(2)?,
        workspace_handle: row.get(3)?,
        provider: row.get(4)?,
        workspace_generation: row.get(5)?,
        credential_generation: row.get(6)?,
        client_context: row.get(7)?,
        meeting_context: row.get(8)?,
        recipients_json: row.get(9)?,
        draft_subject: row.get(10)?,
        body: row.get(11)?,
        content_hash: row.get(12)?,
        approval_receipt: row.get(13)?,
        idempotency_key: row.get(14)?,
        version: row.get(15)?,
        status: row.get(16)?,
    })
}

/// The dark handoff boundary derives its key outcome only from encrypted claim
/// rows. Callers cannot choose a freshness or history classification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum DarkClaimHistory {
    CurrentApproved(ApprovedDraftClaimRecord),
    DuplicateKey,
    ConflictingKey,
    IndeterminateKey,
    Missing,
    Malformed,
    NotApproved,
}

fn claim_has_complete_fields(claim: &ApprovedDraftClaimRecord) -> bool {
    [
        &claim.claim_handle,
        &claim.mailbox_handle,
        &claim.workspace_handle,
        &claim.provider,
        &claim.client_context,
        &claim.meeting_context,
        &claim.recipients_json,
        &claim.draft_subject,
        &claim.body,
        &claim.content_hash,
        &claim.approval_receipt,
        &claim.idempotency_key,
        &claim.status,
    ]
    .iter()
    .all(|value| !value.trim().is_empty())
        && claim.mailbox_version != 0
        && claim.workspace_generation != 0
        && claim.credential_generation != 0
        && claim.version != 0
}

fn claim_matches_current_bindings(
    claim: &ApprovedDraftClaimRecord,
    workspace: &VerifiedWorkspaceAuthority,
    credential: &VerifiedCredentialBinding,
    mailbox: &VerifiedMailboxRecord,
) -> bool {
    claim.mailbox_handle == mailbox.handle()
        && claim.mailbox_version == mailbox.version()
        && claim.workspace_handle == workspace.native_handle()
        && claim.provider == credential.provider().as_db()
        && claim.workspace_generation == workspace.generation()
        && claim.credential_generation == credential.generation().value()
}

/// Reload one persisted claim key inside the caller's existing SQLCipher
/// IMMEDIATE transaction. Every outcome is derived from the row itself and
/// refuses to turn a caller-provided status into authority.
pub(super) fn reload_dark_handoff_claim_history(
    transaction: &Transaction<'_>,
    workspace: &VerifiedWorkspaceAuthority,
    credential: &VerifiedCredentialBinding,
    mailbox: &VerifiedMailboxRecord,
    expected: &ApprovedDraftClaimRecord,
) -> Result<DarkClaimHistory> {
    let current = transaction
        .query_row(
            "SELECT claim_handle,mailbox_handle,mailbox_version,workspace_handle,provider,workspace_generation,credential_generation,client_context,meeting_context,recipients_json,draft_subject,body,content_hash,approval_receipt,idempotency_key,version,status FROM verified_draft_claims WHERE workspace_handle=?1 AND provider=?2 AND idempotency_key=?3",
            params![workspace.native_handle(), credential.provider().as_db(), expected.idempotency_key],
            decode_claim,
        )
        .optional()
        .context("load dark handoff claim history")?;
    let Some(current) = current else {
        return Ok(DarkClaimHistory::Missing);
    };
    if !claim_has_complete_fields(&current) || DraftClaimState::from_db(&current.status).is_err() {
        return Ok(DarkClaimHistory::Malformed);
    }
    if !claim_matches_current_bindings(&current, workspace, credential, mailbox) {
        return Ok(DarkClaimHistory::ConflictingKey);
    }
    match DraftClaimState::from_db(&current.status)? {
        DraftClaimState::Approved if current == *expected => {
            Ok(DarkClaimHistory::CurrentApproved(current))
        }
        DraftClaimState::Approved => Ok(DarkClaimHistory::ConflictingKey),
        DraftClaimState::Unknown => Ok(DarkClaimHistory::IndeterminateKey),
        DraftClaimState::Claimed | DraftClaimState::Saving | DraftClaimState::Saved => {
            Ok(DarkClaimHistory::DuplicateKey)
        }
        _ => Ok(DarkClaimHistory::NotApproved),
    }
}

fn claim_handle(input: &ApprovedDraftClaimInput, mailbox: &VerifiedMailboxRecord) -> String {
    use sha2::{Digest, Sha256};
    let mut digest = Sha256::new();
    digest.update(mailbox.handle().as_bytes());
    digest.update([0]);
    digest.update(input.idempotency_key.as_bytes());
    format!("m4-claim-{}", &hex::encode(digest.finalize())[..24])
}

fn matching_idempotent_claim(
    transaction: &Transaction<'_>,
    workspace: &VerifiedWorkspaceAuthority,
    credential: &VerifiedCredentialBinding,
    input: &ApprovedDraftClaimInput,
    mailbox: &VerifiedMailboxRecord,
) -> Result<Option<ApprovedDraftClaimRecord>> {
    transaction.query_row(
        "SELECT claim_handle,mailbox_handle,mailbox_version,workspace_handle,provider,workspace_generation,credential_generation,client_context,meeting_context,recipients_json,draft_subject,body,content_hash,approval_receipt,idempotency_key,version,status FROM verified_draft_claims WHERE workspace_handle=?1 AND provider=?2 AND idempotency_key=?3",
        params![workspace.native_handle(), credential.provider().as_db(), input.idempotency_key], decode_claim,
    ).optional().context("load idempotent approved draft claim").and_then(|existing| {
        if let Some(existing) = existing {
            let same = existing.mailbox_handle == mailbox.handle() && existing.mailbox_version == mailbox.version() && existing.workspace_generation == workspace.generation() && existing.credential_generation == credential.generation().value() && existing.client_context == input.client_context && existing.meeting_context == input.meeting_context && existing.recipients_json == input.recipients_json && existing.draft_subject == input.draft_subject && existing.body == input.body && existing.content_hash == input.content_hash && existing.approval_receipt == input.approval_receipt;
            if !same { bail!("idempotency key is already bound to a different approved claim") }
            return Ok(Some(existing));
        }
        Ok(None)
    })
}

/// Final encrypted persistence boundary for an approval. It runs the final
/// guard then reloads the row again in the claim transaction before persisting.
pub(super) fn create_approved_draft_claim(
    store: &CrmCoreStore,
    workspace: &VerifiedWorkspaceAuthority,
    credential: &VerifiedCredentialBinding,
    expected_mailbox: &VerifiedMailboxRecord,
    resolved_address: &str,
    input: &ApprovedDraftClaimInput,
) -> Result<ApprovedDraftClaimRecord> {
    input.validate()?;
    let _dispatch = pre_dispatch_guard(
        store,
        workspace,
        credential,
        expected_mailbox,
        resolved_address,
    )?;
    store.m4_shared_foundation_transaction(|transaction| {
        let current = reload_exact_current_mailbox(transaction, workspace, credential, expected_mailbox, resolved_address)?;
        if let Some(existing) = matching_idempotent_claim(transaction, workspace, credential, input, &current)? { return Ok(existing) }
        let record = ApprovedDraftClaimRecord {
            claim_handle: claim_handle(input, &current), mailbox_handle: current.handle().to_string(), mailbox_version: current.version(), workspace_handle: workspace.native_handle().to_string(), provider: credential.provider().as_db().to_string(), workspace_generation: workspace.generation(), credential_generation: credential.generation().value(), client_context: input.client_context.clone(), meeting_context: input.meeting_context.clone(), recipients_json: input.recipients_json.clone(), draft_subject: input.draft_subject.clone(), body: input.body.clone(), content_hash: input.content_hash.clone(), approval_receipt: input.approval_receipt.clone(), idempotency_key: input.idempotency_key.clone(), version: 1, status: DraftClaimState::Approved.as_db().to_string(),
        };
        transaction.execute("INSERT INTO verified_draft_claims(claim_handle,mailbox_handle,mailbox_version,workspace_handle,provider,workspace_generation,credential_generation,client_context,meeting_context,recipients_json,draft_subject,body,content_hash,approval_receipt,idempotency_key,version,status) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)", params![record.claim_handle, record.mailbox_handle, record.mailbox_version, record.workspace_handle, record.provider, record.workspace_generation, record.credential_generation, record.client_context, record.meeting_context, record.recipients_json, record.draft_subject, record.body, record.content_hash, record.approval_receipt, record.idempotency_key, record.version, record.status])?;
        Ok(record)
    })
}

pub(super) fn transition_claim(
    store: &CrmCoreStore,
    claim_handle: &str,
    expected_version: u64,
    next: DraftClaimState,
) -> Result<ApprovedDraftClaimRecord> {
    store.m4_shared_foundation_transaction(|transaction| {
        let current = transaction.query_row("SELECT claim_handle,mailbox_handle,mailbox_version,workspace_handle,provider,workspace_generation,credential_generation,client_context,meeting_context,recipients_json,draft_subject,body,content_hash,approval_receipt,idempotency_key,version,status FROM verified_draft_claims WHERE claim_handle=?1", [claim_handle], decode_claim).optional()?.ok_or_else(|| anyhow::anyhow!("approved draft claim is absent"))?;
        if current.version != expected_version || !DraftClaimState::from_db(&current.status)?.can_transition_to(next) { bail!("invalid draft-claim transition or stale version") }
        transaction.execute("UPDATE verified_draft_claims SET status=?1,version=version+1 WHERE claim_handle=?2 AND version=?3", params![next.as_db(), claim_handle, expected_version])?;
        transaction.query_row("SELECT claim_handle,mailbox_handle,mailbox_version,workspace_handle,provider,workspace_generation,credential_generation,client_context,meeting_context,recipients_json,draft_subject,body,content_hash,approval_receipt,idempotency_key,version,status FROM verified_draft_claims WHERE claim_handle=?1", [claim_handle], decode_claim).context("reload transitioned approved draft claim")
    })
}

#[cfg(test)]
fn test_input(key: &str) -> ApprovedDraftClaimInput {
    ApprovedDraftClaimInput {
        client_context: "client-7".into(),
        meeting_context: "meeting-9".into(),
        recipients_json: "[\"client@example.com\"]".into(),
        draft_subject: "Review notes".into(),
        body: "Body".into(),
        content_hash: "hash-7".into(),
        approval_receipt: "approval-4".into(),
        idempotency_key: key.into(),
    }
}

#[cfg(test)]
pub(super) fn test_only_approved_draft_payload() -> ApprovedDraftPayloadView {
    ApprovedDraftPayloadView {
        recipients_json: "[\"client@example.com\"]".into(),
        draft_subject: "Advisor follow-up".into(),
        body: "Approved body".into(),
    }
}

#[cfg(test)]
pub(super) fn test_only_create_approved_claim(
    store: &CrmCoreStore,
    workspace: &VerifiedWorkspaceAuthority,
    credential: &VerifiedCredentialBinding,
    mailbox: &VerifiedMailboxRecord,
    key: &str,
) -> Result<ApprovedDraftClaimRecord> {
    create_approved_draft_claim(
        store,
        workspace,
        credential,
        mailbox,
        "ada@example.com",
        &test_input(key),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::mail::{
        verified_m4_credentials::{test_only_credential, M4CredentialProvider},
        verified_mailbox::{register_current_verified_mailbox, test_only_evidence},
        verified_workspace_lifecycle::test_only_current_workspace_authority,
    };
    use tempfile::TempDir;

    fn setup() -> (
        TempDir,
        CrmCoreStore,
        VerifiedWorkspaceAuthority,
        VerifiedCredentialBinding,
        VerifiedMailboxRecord,
    ) {
        let dir = TempDir::new().unwrap();
        let store = CrmCoreStore::open_with_key(dir.path(), &[42; 32]).unwrap();
        let workspace = test_only_current_workspace_authority("native-a", 1);
        let credential = test_only_credential(M4CredentialProvider::Microsoft, "subject-a", 1);
        let mailbox = register_current_verified_mailbox(
            &store,
            &workspace,
            &credential,
            &test_only_evidence("ada@example.com"),
        )
        .unwrap();
        (dir, store, workspace, credential, mailbox)
    }

    #[test]
    fn m4_shared_foundation_claim_rechecks_exact_binding_and_is_content_stable_idempotent() {
        let (_dir, store, workspace, credential, mailbox) = setup();
        let one = create_approved_draft_claim(
            &store,
            &workspace,
            &credential,
            &mailbox,
            "ada@example.com",
            &test_input("same-key"),
        )
        .unwrap();
        let two = create_approved_draft_claim(
            &store,
            &workspace,
            &credential,
            &mailbox,
            "ada@example.com",
            &test_input("same-key"),
        )
        .unwrap();
        assert_eq!(one, two);
        assert!(create_approved_draft_claim(
            &store,
            &workspace,
            &credential,
            &mailbox,
            "other@example.com",
            &test_input("bad-address")
        )
        .is_err());
        assert!(create_approved_draft_claim(
            &store,
            &test_only_current_workspace_authority("native-b", 1),
            &credential,
            &mailbox,
            "ada@example.com",
            &test_input("bad-workspace")
        )
        .is_err());
        assert!(create_approved_draft_claim(
            &store,
            &workspace,
            &credential,
            &mailbox,
            "ada@example.com",
            &test_input("same-key-different-content")
        )
        .is_ok());
        assert!(create_approved_draft_claim(
            &store,
            &workspace,
            &credential,
            &mailbox,
            "ada@example.com",
            &ApprovedDraftClaimInput {
                body: "Changed".into(),
                ..test_input("same-key")
            }
        )
        .is_err());
    }

    #[test]
    fn m4_shared_foundation_claim_state_machine_has_terminal_unknown_and_no_retry() {
        let (_dir, store, workspace, credential, mailbox) = setup();
        let claim = create_approved_draft_claim(
            &store,
            &workspace,
            &credential,
            &mailbox,
            "ada@example.com",
            &test_input("unknown-key"),
        )
        .unwrap();
        let claimed =
            transition_claim(&store, &claim.claim_handle, 1, DraftClaimState::Claimed).unwrap();
        let saving =
            transition_claim(&store, &claimed.claim_handle, 2, DraftClaimState::Saving).unwrap();
        let unknown =
            transition_claim(&store, &saving.claim_handle, 3, DraftClaimState::Unknown).unwrap();
        assert_eq!(unknown.status, "unknown");
        assert!(transition_claim(
            &store,
            &unknown.claim_handle,
            unknown.version,
            DraftClaimState::Saving
        )
        .is_err());
    }
}

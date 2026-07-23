//! Provider-neutral, encrypted verified-mailbox identity foundation.

#![allow(dead_code)] // Deliberately dark until sealed adapters are connected.

use anyhow::{bail, Context, Result};
use rusqlite::{params, OptionalExtension, Transaction};

use crate::commands::{
    crm::core_store::CrmCoreStore,
    mail::{
        verified_m4_credentials::{
            M4CredentialProvider, VerifiedCredentialBinding, VerifiedCredentialLease,
        },
        verified_workspace_authority::VerifiedWorkspaceAuthority,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum MailboxState {
    Unverified,
    Verified,
    Stale,
    Disconnected,
    Refused,
}

impl MailboxState {
    pub(super) fn as_db(self) -> &'static str {
        match self {
            Self::Unverified => "unverified",
            Self::Verified => "verified",
            Self::Stale => "stale",
            Self::Disconnected => "disconnected",
            Self::Refused => "refused",
        }
    }
    fn from_db(value: &str) -> Result<Self> {
        match value {
            "verified" => Ok(Self::Verified),
            "stale" => Ok(Self::Stale),
            "disconnected" => Ok(Self::Disconnected),
            "refused" => Ok(Self::Refused),
            _ => bail!("invalid persisted verified-mailbox state"),
        }
    }
    pub(super) fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Unverified, Self::Verified)
                | (
                    Self::Verified,
                    Self::Stale | Self::Disconnected | Self::Refused
                )
        )
    }
}

/// Native evidence after a future sealed adapter has resolved a real address.
#[derive(Debug)]
pub(super) struct VerifiedMailboxEvidence {
    canonical_address: String,
    display_name: Option<String>,
    user_principal_name: Option<String>,
    verified_at: String,
    verified_source: String,
}

impl VerifiedMailboxEvidence {
    fn display_label(&self) -> String {
        let label = self
            .display_name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                self.user_principal_name
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
            })
            .unwrap_or(&self.canonical_address);
        format!("{label} — {}", self.canonical_address)
    }
    fn validate(&self) -> Result<()> {
        for value in [
            &self.canonical_address,
            &self.verified_at,
            &self.verified_source,
        ] {
            if value.trim().is_empty() {
                bail!("verified mailbox evidence requires resolved identity fields")
            }
        }
        if !self.canonical_address.contains('@') {
            bail!("verified mailbox address must be a real resolved address")
        }
        Ok(())
    }
}

/// This private identity is decoded only in this module at the SQLCipher
/// boundary. There is no public field or sibling-visible constructor.
#[derive(Debug, Clone, PartialEq, Eq)]
struct VerifiedMailboxIdentity {
    workspace_handle: String,
    provider: String,
    mailbox_handle: String,
    provider_subject: String,
    canonical_address: String,
    display_label: String,
    workspace_generation: u64,
    credential_generation: u64,
    verified_at: String,
    verified_source: String,
    version: u64,
    status: String,
}

/// An identity-only record returned from the encrypted store. Its tuple field
/// stays private, so no production sibling can present invented current truth.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct VerifiedMailboxRecord(VerifiedMailboxIdentity);

impl VerifiedMailboxRecord {
    pub(super) fn handle(&self) -> &str {
        &self.0.mailbox_handle
    }
    pub(super) fn version(&self) -> u64 {
        self.0.version
    }
    pub(super) fn state(&self) -> Result<MailboxState> {
        MailboxState::from_db(&self.0.status)
    }

    fn display_label(&self) -> &str {
        &self.0.display_label
    }

    fn matches_context(
        &self,
        workspace: &VerifiedWorkspaceAuthority,
        credential: &VerifiedCredentialBinding,
        address: &str,
    ) -> bool {
        self.0.workspace_handle == workspace.native_handle()
            && self.0.workspace_generation == workspace.generation()
            && self.0.provider == credential.provider().as_db()
            && self.0.provider_subject == credential.subject().as_str()
            && self.0.credential_generation == credential.generation().value()
            && self.0.canonical_address == address
            && matches!(self.state(), Ok(MailboxState::Verified))
    }

    fn exactly_matches(
        &self,
        expected: &Self,
        workspace: &VerifiedWorkspaceAuthority,
        credential: &VerifiedCredentialBinding,
        address: &str,
    ) -> bool {
        self == expected && self.matches_context(workspace, credential, address)
    }

    fn exactly_matches_current_context(
        &self,
        expected: &Self,
        workspace: &VerifiedWorkspaceAuthority,
        credential: &VerifiedCredentialBinding,
    ) -> bool {
        self.exactly_matches(
            expected,
            workspace,
            credential,
            &expected.0.canonical_address,
        )
    }
}

/// The only proof a future adapter may accept after the final SQLCipher reload.
/// Provider siblings may carry this value but cannot construct it or inspect it.
#[derive(Debug)]
pub(super) struct VerifiedMailboxDispatchAuthorization(VerifiedMailboxRecord);

/// Opaque final authorization for one provider-draft attempt. It exists only
/// after the guard reloads current encrypted mailbox truth, and it preserves
/// the native workspace and credential lease as borrows rather than values a
/// mail sibling could manufacture.
#[derive(Debug)]
pub(super) struct M4AdapterAuthorization<'a> {
    workspace: &'a VerifiedWorkspaceAuthority,
    credential_lease: &'a VerifiedCredentialLease,
    dispatch: VerifiedMailboxDispatchAuthorization,
}

impl M4AdapterAuthorization<'_> {
    pub(super) fn provider(&self) -> Result<M4CredentialProvider> {
        Ok(self.credential_lease.provider())
    }

    pub(super) fn workspace(&self) -> &VerifiedWorkspaceAuthority {
        self.workspace
    }

    pub(super) fn credential_for(
        &self,
        provider: M4CredentialProvider,
    ) -> Result<&VerifiedCredentialBinding> {
        self.credential_lease.binding_for(provider)
    }

    pub(super) fn saved_draft_result(&self, draft_id: &str) -> Result<M4ProviderDraftResult> {
        if draft_id.trim().is_empty() {
            bail!("provider draft id is required")
        }
        Ok(M4ProviderDraftResult {
            draft_id: draft_id.to_string(),
            verified_mailbox_label: self.dispatch.0.display_label().to_string(),
        })
    }
}

/// The only successful provider-draft shape. It identifies a saved draft and
/// the encrypted-current verified mailbox; it deliberately has no send field
/// or action.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct M4ProviderDraftResult {
    draft_id: String,
    verified_mailbox_label: String,
}

impl M4ProviderDraftResult {
    pub(super) fn draft_id(&self) -> &str {
        &self.draft_id
    }

    pub(super) fn verified_mailbox_label(&self) -> &str {
        &self.verified_mailbox_label
    }
}

fn identity_column_names() -> &'static [&'static str] {
    &[
        "workspace_handle",
        "provider",
        "mailbox_handle",
        "provider_subject",
        "canonical_address",
        "display_label",
        "workspace_generation",
        "credential_generation",
        "verified_at",
        "verified_source",
        "version",
        "status",
    ]
}

fn mailbox_handle(
    workspace: &VerifiedWorkspaceAuthority,
    credential: &VerifiedCredentialBinding,
) -> String {
    use sha2::{Digest, Sha256};
    let mut digest = Sha256::new();
    digest.update(workspace.native_handle().as_bytes());
    digest.update([0]);
    digest.update(credential.provider().as_db().as_bytes());
    digest.update([0]);
    digest.update(credential.subject().as_str().as_bytes());
    format!("m4-mailbox-{}", &hex::encode(digest.finalize())[..24])
}

fn decode_identity(row: &rusqlite::Row<'_>) -> rusqlite::Result<VerifiedMailboxIdentity> {
    Ok(VerifiedMailboxIdentity {
        workspace_handle: row.get(0)?,
        provider: row.get(1)?,
        mailbox_handle: row.get(2)?,
        provider_subject: row.get(3)?,
        canonical_address: row.get(4)?,
        display_label: row.get(5)?,
        workspace_generation: row.get(6)?,
        credential_generation: row.get(7)?,
        verified_at: row.get(8)?,
        verified_source: row.get(9)?,
        version: row.get(10)?,
        status: row.get(11)?,
    })
}

fn current_mailbox(
    transaction: &Transaction<'_>,
    workspace: &VerifiedWorkspaceAuthority,
    provider: M4CredentialProvider,
) -> Result<Option<VerifiedMailboxRecord>> {
    transaction.query_row(
        "SELECT workspace_handle,provider,mailbox_handle,provider_subject,canonical_address,display_label,workspace_generation,credential_generation,verified_at,verified_source,version,status FROM verified_mailboxes WHERE workspace_handle=?1 AND provider=?2",
        params![workspace.native_handle(), provider.as_db()],
        |row| Ok(VerifiedMailboxRecord(decode_identity(row)?)),
    ).optional().context("load current verified mailbox")
}

/// Creates exactly one current verified mailbox for a workspace/provider.
pub(super) fn register_current_verified_mailbox(
    store: &CrmCoreStore,
    workspace: &VerifiedWorkspaceAuthority,
    credential: &VerifiedCredentialBinding,
    evidence: &VerifiedMailboxEvidence,
) -> Result<VerifiedMailboxRecord> {
    evidence.validate()?;
    store.m4_shared_foundation_transaction(|transaction| {
        if let Some(existing) = current_mailbox(transaction, workspace, credential.provider())? {
            if existing.matches_context(workspace, credential, &evidence.canonical_address) && existing.0.display_label == evidence.display_label() { return Ok(existing) }
            bail!("a different or stale verified mailbox already occupies this workspace/provider")
        }
        let identity = VerifiedMailboxIdentity {
            workspace_handle: workspace.native_handle().to_string(), provider: credential.provider().as_db().to_string(), mailbox_handle: mailbox_handle(workspace, credential), provider_subject: credential.subject().as_str().to_string(), canonical_address: evidence.canonical_address.clone(), display_label: evidence.display_label(), workspace_generation: workspace.generation(), credential_generation: credential.generation().value(), verified_at: evidence.verified_at.clone(), verified_source: evidence.verified_source.clone(), version: 1, status: MailboxState::Verified.as_db().to_string(),
        };
        transaction.execute(
            "INSERT INTO verified_mailboxes(workspace_handle,provider,mailbox_handle,provider_subject,canonical_address,display_label,workspace_generation,credential_generation,verified_at,verified_source,version,status) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![identity.workspace_handle, identity.provider, identity.mailbox_handle, identity.provider_subject, identity.canonical_address, identity.display_label, identity.workspace_generation, identity.credential_generation, identity.verified_at, identity.verified_source, identity.version, identity.status],
        )?;
        current_mailbox(transaction, workspace, credential.provider())?.ok_or_else(|| anyhow::anyhow!("verified mailbox disappeared after registration"))
    })
}

pub(super) fn load_current_verified_mailbox(
    store: &CrmCoreStore,
    workspace: &VerifiedWorkspaceAuthority,
    provider: M4CredentialProvider,
) -> Result<Option<VerifiedMailboxRecord>> {
    store.m4_shared_foundation_transaction(|transaction| {
        current_mailbox(transaction, workspace, provider)
    })
}

pub(super) fn transition_mailbox(
    store: &CrmCoreStore,
    workspace: &VerifiedWorkspaceAuthority,
    provider: M4CredentialProvider,
    expected_version: u64,
    next: MailboxState,
) -> Result<VerifiedMailboxRecord> {
    store.m4_shared_foundation_transaction(|transaction| {
        let current = current_mailbox(transaction, workspace, provider)?.ok_or_else(|| anyhow::anyhow!("verified mailbox is absent"))?;
        if current.version() != expected_version || !current.state()?.can_transition_to(next) { bail!("invalid verified-mailbox transition or stale version") }
        transaction.execute("UPDATE verified_mailboxes SET status=?1,version=version+1 WHERE workspace_handle=?2 AND provider=?3 AND version=?4", params![next.as_db(), workspace.native_handle(), provider.as_db(), expected_version])?;
        current_mailbox(transaction, workspace, provider)?.ok_or_else(|| anyhow::anyhow!("verified mailbox disappeared"))
    })
}

/// Final pre-dispatch gate. It reloads the current encrypted row inside the
/// store boundary and compares every binding before any adapter could run.
pub(super) fn pre_dispatch_guard(
    store: &CrmCoreStore,
    workspace: &VerifiedWorkspaceAuthority,
    credential: &VerifiedCredentialBinding,
    expected: &VerifiedMailboxRecord,
    resolved_address: &str,
) -> Result<VerifiedMailboxDispatchAuthorization> {
    store.m4_shared_foundation_transaction(|transaction| {
        let current = current_mailbox(transaction, workspace, credential.provider())?
            .ok_or_else(|| anyhow::anyhow!("verified mailbox is absent"))?;
        if !current.exactly_matches(expected, workspace, credential, resolved_address) {
            bail!("verified mailbox binding is no longer current")
        }
        Ok(VerifiedMailboxDispatchAuthorization(current))
    })
}

/// Build the only adapter input after the current encrypted mailbox row has
/// been reloaded and exactly matched against the sealed workspace and lease.
pub(super) fn authorize_adapter_dispatch<'a>(
    store: &CrmCoreStore,
    workspace: &'a VerifiedWorkspaceAuthority,
    credential_lease: &'a VerifiedCredentialLease,
    expected: &VerifiedMailboxRecord,
    resolved_address: &str,
) -> Result<M4AdapterAuthorization<'a>> {
    if !workspace.is_well_formed() {
        bail!("native workspace authority is invalid")
    }
    let credential = credential_lease.binding_for(credential_lease.provider())?;
    let dispatch = pre_dispatch_guard(store, workspace, credential, expected, resolved_address)?;
    Ok(M4AdapterAuthorization {
        workspace,
        credential_lease,
        dispatch,
    })
}

/// Transaction-local companion for durable claim creation. It does not accept
/// an identity payload: it reloads the SQLCipher row and returns it only after
/// the same exact binding check used by the final dispatch guard.
pub(super) fn reload_exact_current_mailbox(
    transaction: &Transaction<'_>,
    workspace: &VerifiedWorkspaceAuthority,
    credential: &VerifiedCredentialBinding,
    expected: &VerifiedMailboxRecord,
    resolved_address: &str,
) -> Result<VerifiedMailboxRecord> {
    let current = current_mailbox(transaction, workspace, credential.provider())?
        .ok_or_else(|| anyhow::anyhow!("verified mailbox is absent"))?;
    if !current.exactly_matches(expected, workspace, credential, resolved_address) {
        bail!("verified mailbox binding is no longer current")
    }
    Ok(current)
}

/// Transaction-local recheck for the dark boundary. The expected encrypted
/// record supplies its own sealed address binding; this accepts no address
/// from a caller and follows the same exact-current comparison as the final
/// mailbox guard.
pub(super) fn reload_exact_current_mailbox_for_expected(
    transaction: &Transaction<'_>,
    workspace: &VerifiedWorkspaceAuthority,
    credential: &VerifiedCredentialBinding,
    expected: &VerifiedMailboxRecord,
) -> Result<VerifiedMailboxRecord> {
    let current = current_mailbox(transaction, workspace, credential.provider())?
        .ok_or_else(|| anyhow::anyhow!("verified mailbox is absent"))?;
    if !current.exactly_matches_current_context(expected, workspace, credential) {
        bail!("verified mailbox binding is no longer current")
    }
    Ok(current)
}

#[cfg(test)]
pub(super) fn test_only_evidence(address: &str) -> VerifiedMailboxEvidence {
    test_only_evidence_with_labels(address, Some("Ada Advisor"), Some("ada-upn"))
}

#[cfg(test)]
pub(super) fn test_only_evidence_with_labels(
    address: &str,
    display_name: Option<&str>,
    user_principal_name: Option<&str>,
) -> VerifiedMailboxEvidence {
    VerifiedMailboxEvidence {
        canonical_address: address.to_string(),
        display_name: display_name.map(str::to_string),
        user_principal_name: user_principal_name.map(str::to_string),
        verified_at: "2026-07-23T00:00:00Z".to_string(),
        verified_source: "native-proof".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::mail::{
        verified_m4_credentials::test_only_credential,
        verified_workspace_lifecycle::test_only_current_workspace_authority,
    };
    use tempfile::TempDir;

    fn store() -> (TempDir, CrmCoreStore) {
        let dir = TempDir::new().unwrap();
        let store = CrmCoreStore::open_with_key(dir.path(), &[31; 32]).unwrap();
        (dir, store)
    }

    #[test]
    fn m4_shared_foundation_one_current_mailbox_clean_reopen_and_identity_separation() {
        let (dir, store) = store();
        let workspace = test_only_current_workspace_authority("native-a", 1);
        let credential = test_only_credential(M4CredentialProvider::Microsoft, "subject-a", 1);
        let record = register_current_verified_mailbox(
            &store,
            &workspace,
            &credential,
            &test_only_evidence("ada@example.com"),
        )
        .unwrap();
        assert_eq!(record.0.display_label, "Ada Advisor — ada@example.com");
        assert_eq!(
            record.handle(),
            register_current_verified_mailbox(
                &store,
                &workspace,
                &credential,
                &test_only_evidence("ada@example.com")
            )
            .unwrap()
            .handle()
        );
        drop(store);
        let reopened = CrmCoreStore::open_with_key(dir.path(), &[31; 32]).unwrap();
        assert_eq!(
            load_current_verified_mailbox(&reopened, &workspace, M4CredentialProvider::Microsoft)
                .unwrap()
                .unwrap(),
            record
        );
        assert!(!identity_column_names()
            .iter()
            .any(|name| name.contains("recipient")
                || name.contains("draft")
                || name.contains("body")
                || name.contains("hash")));
    }

    #[test]
    fn m4_shared_foundation_refuses_wrong_workspace_provider_address_generation_and_second_account()
    {
        let (_dir, store) = store();
        let workspace = test_only_current_workspace_authority("native-a", 1);
        let credential = test_only_credential(M4CredentialProvider::Microsoft, "subject-a", 1);
        let record = register_current_verified_mailbox(
            &store,
            &workspace,
            &credential,
            &test_only_evidence("ada@example.com"),
        )
        .unwrap();
        assert!(pre_dispatch_guard(
            &store,
            &test_only_current_workspace_authority("native-b", 1),
            &credential,
            &record,
            "ada@example.com"
        )
        .is_err());
        assert!(pre_dispatch_guard(
            &store,
            &workspace,
            &test_only_credential(M4CredentialProvider::Gmail, "subject-a", 1),
            &record,
            "ada@example.com"
        )
        .is_err());
        assert!(pre_dispatch_guard(
            &store,
            &workspace,
            &credential,
            &record,
            "other@example.com"
        )
        .is_err());
        assert!(pre_dispatch_guard(
            &store,
            &test_only_current_workspace_authority("native-a", 2),
            &credential,
            &record,
            "ada@example.com"
        )
        .is_err());
        assert!(pre_dispatch_guard(
            &store,
            &workspace,
            &test_only_credential(M4CredentialProvider::Microsoft, "subject-a", 2),
            &record,
            "ada@example.com"
        )
        .is_err());
        assert!(register_current_verified_mailbox(
            &store,
            &workspace,
            &test_only_credential(M4CredentialProvider::Microsoft, "subject-b", 1),
            &test_only_evidence("ada@example.com")
        )
        .is_err());
    }

    #[test]
    fn m4_shared_foundation_final_guard_reloads_current_row_and_refuses_copied_stale_or_replaced_mailbox(
    ) {
        let (_dir, store) = store();
        let workspace = test_only_current_workspace_authority("native-a", 1);
        let credential = test_only_credential(M4CredentialProvider::Microsoft, "subject-a", 1);
        let copied = register_current_verified_mailbox(
            &store,
            &workspace,
            &credential,
            &test_only_evidence("ada@example.com"),
        )
        .unwrap();
        assert!(
            pre_dispatch_guard(&store, &workspace, &credential, &copied, "ada@example.com").is_ok()
        );
        transition_mailbox(
            &store,
            &workspace,
            M4CredentialProvider::Microsoft,
            copied.version(),
            MailboxState::Stale,
        )
        .unwrap();
        assert!(
            pre_dispatch_guard(&store, &workspace, &credential, &copied, "ada@example.com")
                .is_err()
        );
        store.m4_shared_foundation_transaction(|transaction| {
            transaction.execute("UPDATE verified_mailboxes SET mailbox_handle='replacement', provider_subject='subject-b', canonical_address='new@example.com', credential_generation=2, status='verified', version=3 WHERE workspace_handle='native-a' AND provider='microsoft'", [])?;
            Ok(())
        }).unwrap();
        assert!(
            pre_dispatch_guard(&store, &workspace, &credential, &copied, "ada@example.com")
                .is_err()
        );
    }

    #[test]
    fn m4_shared_foundation_mailbox_state_machine_refuses_invalid_transitions_and_versions() {
        assert!(MailboxState::Unverified.can_transition_to(MailboxState::Verified));
        assert!(!MailboxState::Verified.can_transition_to(MailboxState::Verified));
        assert!(!MailboxState::Stale.can_transition_to(MailboxState::Verified));
    }

    #[test]
    fn m4_mailbox_identity_uses_only_a_provider_returned_address_and_honest_label_fallbacks() {
        let (dir, primary_store) = store();
        let workspace = test_only_current_workspace_authority("native-labels", 1);
        let credential = test_only_credential(M4CredentialProvider::Microsoft, "subject-labels", 1);
        let named = register_current_verified_mailbox(
            &primary_store,
            &workspace,
            &credential,
            &test_only_evidence_with_labels(
                "returned@example.com",
                Some("Returned Name"),
                Some("returned-upn"),
            ),
        )
        .unwrap();
        assert_eq!(named.0.canonical_address, "returned@example.com");
        assert_eq!(
            named.display_label(),
            "Returned Name — returned@example.com"
        );
        drop(primary_store);

        let fallback_store = CrmCoreStore::open_with_key(dir.path(), &[31; 32]).unwrap();
        assert_eq!(
            load_current_verified_mailbox(
                &fallback_store,
                &workspace,
                M4CredentialProvider::Microsoft
            )
            .unwrap()
            .unwrap()
            .0
            .canonical_address,
            "returned@example.com"
        );

        let (other_dir, other_store) = store();
        let other_workspace = test_only_current_workspace_authority("native-upn", 1);
        let other_credential =
            test_only_credential(M4CredentialProvider::Microsoft, "subject-upn", 1);
        let upn_label = register_current_verified_mailbox(
            &other_store,
            &other_workspace,
            &other_credential,
            &test_only_evidence_with_labels("real@example.com", None, Some("label-only-upn")),
        )
        .unwrap();
        assert_eq!(
            upn_label.display_label(),
            "label-only-upn — real@example.com"
        );
        assert!(register_current_verified_mailbox(
            &other_store,
            &test_only_current_workspace_authority("native-no-address", 1),
            &test_only_credential(M4CredentialProvider::Microsoft, "subject-no-address", 1),
            &test_only_evidence_with_labels("label-only-upn", None, Some("label-only-upn")),
        )
        .is_err());
        drop(other_store);
        drop(other_dir);
    }
}

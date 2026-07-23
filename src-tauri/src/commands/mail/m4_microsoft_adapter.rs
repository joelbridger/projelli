//! Private Microsoft adapter slot for the later sealed M4 draft handoff.
//!
//! This precursor contains a fixed contract only. It does not resolve an
//! identity, load credentials, contact Microsoft, create a draft, or send.

#![allow(dead_code)] // Deliberately dark until a separately reviewed provider packet.

#[cfg(test)]
use anyhow::Context;
use anyhow::{bail, Result};
use rusqlite::{params, OptionalExtension};

use super::{
    verified_draft_claim::ApprovedDraftPayloadView,
    verified_m4_credentials::M4CredentialProvider,
    verified_mailbox::{M4AdapterAuthorization, M4ProviderDraftResult},
};

/// This flag is intentionally constant and false. There is no production
/// caller or transport implementation in this packet.
const M4_MICROSOFT_DRAFT_SAVE_ENABLED: bool = false;

/// Fixed Microsoft contract. The provider-specific writer may replace only
/// this unavailable body while preserving the sealed input and result shape.
pub(super) fn create_draft(
    authorization: &M4AdapterAuthorization<'_>,
    draft: &ApprovedDraftPayloadView,
) -> Result<M4ProviderDraftResult> {
    let _credential = authorization.credential_for(M4CredentialProvider::Microsoft)?;
    let _workspace = authorization.workspace();
    let _recipients = draft.recipients_json();
    let _draft_subject = draft.draft_subject();
    let _body = draft.body();
    bail!("Microsoft M4 adapter is unavailable")
}

/// A reservation from the encrypted state machine. The private fields keep
/// copied claim or mailbox values from becoming draft-save authority.
#[derive(Debug)]
pub(super) struct WinningDraftSaveAttempt {
    claim_handle: String,
    claim_version: u64,
    mailbox_handle: String,
    mailbox_version: u64,
    workspace_handle: String,
    content_hash: String,
    idempotency_key: String,
}

/// The test-only transport receives this opaque token, never caller-owned
/// strings or a constructed identity.
#[derive(Debug)]
pub(super) struct SealedMicrosoftDraftCapability {
    attempt: WinningDraftSaveAttempt,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProviderDraftReceipt {
    provider_draft_id: String,
    safe_metadata: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DraftSaveRefusal {
    Disabled,
    ClaimOrHistory,
    LocalRefusal,
    Unknown,
    ReceiptFailure,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DraftSaveResult {
    Refused(DraftSaveRefusal),
    Saved { provider_draft_id: String },
}

/// Production remains a closed door. It cannot receive authority or a
/// transport, so it cannot cross a provider boundary.
fn m4_production_draft_save_boundary() -> DraftSaveResult {
    if !M4_MICROSOFT_DRAFT_SAVE_ENABLED {
        return DraftSaveResult::Refused(DraftSaveRefusal::Disabled);
    }
    DraftSaveResult::Refused(DraftSaveRefusal::Disabled)
}

fn claim_columns() -> &'static str {
    "claim_handle,mailbox_handle,mailbox_version,workspace_handle,provider,workspace_generation,credential_generation,client_context,meeting_context,recipients_json,draft_subject,body,content_hash,approval_receipt,idempotency_key,version,status"
}

fn decode_claim(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<crate::commands::crm::core_model::ApprovedDraftClaimRecord> {
    Ok(crate::commands::crm::core_model::ApprovedDraftClaimRecord {
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

fn recover_saving_attempts(
    store: &crate::commands::crm::core_store::CrmCoreStore,
    workspace: &super::verified_workspace_lifecycle::VerifiedWorkspaceAuthority,
    credential: &super::verified_m4_credentials::VerifiedCredentialBinding,
) -> Result<()> {
    store.m4_shared_foundation_transaction(|transaction| {
        transaction.execute(
            "UPDATE verified_draft_claims SET status='unknown',version=version+1 WHERE workspace_handle=?1 AND provider=?2 AND status='saving'",
            params![workspace.native_handle(), credential.provider().as_db()],
        )?;
        Ok(())
    })
}

fn reserve_one_winner(
    store: &crate::commands::crm::core_store::CrmCoreStore,
    workspace: &super::verified_workspace_lifecycle::VerifiedWorkspaceAuthority,
    credential_lease: &super::verified_m4_credentials::VerifiedCredentialLease,
    expected_mailbox: &super::verified_mailbox::VerifiedMailboxRecord,
    expected_claim: &crate::commands::crm::core_model::ApprovedDraftClaimRecord,
) -> Result<WinningDraftSaveAttempt> {
    use super::{
        verified_draft_claim::{
            approved_draft_payload_view, reload_dark_handoff_claim_history, DarkClaimHistory,
        },
        verified_mailbox::reload_exact_current_mailbox_for_expected,
    };

    if !workspace.is_well_formed() {
        bail!("current workspace lease is invalid")
    }
    let credential = credential_lease.binding_for(M4CredentialProvider::Microsoft)?;
    store.m4_shared_foundation_transaction(|transaction| {
        let mailbox = reload_exact_current_mailbox_for_expected(
            transaction,
            workspace,
            credential,
            expected_mailbox,
        )?;
        let claim = match reload_dark_handoff_claim_history(
            transaction,
            workspace,
            credential,
            &mailbox,
            expected_claim,
        )? {
            DarkClaimHistory::CurrentApproved(claim) => claim,
            _ => bail!("draft claim is not exact current approved truth"),
        };
        let _payload = approved_draft_payload_view(&claim)?;
        let receipts: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM m4_provider_draft_receipts WHERE workspace_handle=?1 AND provider='microsoft' AND idempotency_key=?2",
            params![workspace.native_handle(), claim.idempotency_key],
            |row| row.get(0),
        )?;
        if receipts != 0 {
            bail!("idempotency history already has a receipt")
        }
        if transaction.execute(
            "UPDATE verified_draft_claims SET status='claimed',version=version+1 WHERE claim_handle=?1 AND version=?2 AND status='approved'",
            params![claim.claim_handle, claim.version],
        )? != 1 {
            bail!("lost one-winner claim reservation")
        }
        if transaction.execute(
            "UPDATE verified_draft_claims SET status='saving',version=version+1 WHERE claim_handle=?1 AND version=?2 AND status='claimed'",
            params![claim.claim_handle, claim.version + 1],
        )? != 1 {
            bail!("could not durably enter saving")
        }
        Ok(WinningDraftSaveAttempt {
            claim_handle: claim.claim_handle,
            claim_version: claim.version + 2,
            mailbox_handle: mailbox.handle().to_string(),
            mailbox_version: mailbox.version(),
            workspace_handle: workspace.native_handle().to_string(),
            content_hash: claim.content_hash,
            idempotency_key: claim.idempotency_key,
        })
    })
}

fn terminalize_attempt(
    store: &crate::commands::crm::core_store::CrmCoreStore,
    attempt: &WinningDraftSaveAttempt,
    status: &str,
) -> Result<()> {
    store.m4_shared_foundation_transaction(|transaction| {
        if transaction.execute(
            "UPDATE verified_draft_claims SET status=?1,version=version+1 WHERE claim_handle=?2 AND version=?3 AND status='saving'",
            params![status, attempt.claim_handle, attempt.claim_version],
        )? != 1 {
            bail!("attempt is no longer the current saving reservation")
        }
        Ok(())
    })
}

fn persist_receipt(
    store: &crate::commands::crm::core_store::CrmCoreStore,
    attempt: &WinningDraftSaveAttempt,
    receipt: &ProviderDraftReceipt,
) -> Result<()> {
    if receipt.provider_draft_id.trim().is_empty() || receipt.safe_metadata.trim().is_empty() {
        bail!("provider receipt is incomplete")
    }
    store.m4_shared_foundation_transaction(|transaction| {
        let current = transaction
            .query_row(
                &format!("SELECT {} FROM verified_draft_claims WHERE claim_handle=?1", claim_columns()),
                [&attempt.claim_handle],
                decode_claim,
            )
            .optional()?
            .ok_or_else(|| anyhow::anyhow!("reserved claim disappeared"))?;
        if current.status != "saving"
            || current.version != attempt.claim_version
            || current.workspace_handle != attempt.workspace_handle
            || current.mailbox_handle != attempt.mailbox_handle
            || current.mailbox_version != attempt.mailbox_version
            || current.content_hash != attempt.content_hash
            || current.idempotency_key != attempt.idempotency_key
        {
            bail!("reserved claim no longer exactly binds the receipt")
        }
        transaction.execute(
            "INSERT INTO m4_provider_draft_receipts(claim_handle,mailbox_handle,mailbox_version,workspace_handle,provider,content_hash,idempotency_key,provider_draft_id,safe_metadata,saved_at) VALUES(?1,?2,?3,?4,'microsoft',?5,?6,?7,?8,?9)",
            params![attempt.claim_handle, attempt.mailbox_handle, attempt.mailbox_version, attempt.workspace_handle, attempt.content_hash, attempt.idempotency_key, receipt.provider_draft_id, receipt.safe_metadata, chrono::Utc::now().to_rfc3339()],
        )?;
        if transaction.execute(
            "UPDATE verified_draft_claims SET status='saved',version=version+1 WHERE claim_handle=?1 AND version=?2 AND status='saving'",
            params![attempt.claim_handle, attempt.claim_version],
        )? != 1 {
            bail!("receipt cannot finalize a non-current reservation")
        }
        Ok(())
    })
}

#[cfg(test)]
fn test_only_save_approved_draft(
    enabled: bool,
    store: &crate::commands::crm::core_store::CrmCoreStore,
    workspace_owner: &super::verified_workspace_lifecycle::NativeWorkspaceLifecycle,
    credential_owner: &super::verified_m4_credentials::NativeM4CredentialLifecycle,
    expected_mailbox: &super::verified_mailbox::VerifiedMailboxRecord,
    expected_claim: &crate::commands::crm::core_model::ApprovedDraftClaimRecord,
    transport: &dyn super::m4_microsoft_sealed_transport::TestOnlySealedMicrosoftDraftTransport,
    force_receipt_failure: bool,
) -> Result<DraftSaveResult> {
    use super::{
        m4_microsoft_sealed_transport::SealedDraftSaveOutcome,
        verified_m4_credentials::load_current_credential_from_native_owner,
        verified_workspace_lifecycle::load_current_workspace_from_native_owner,
    };
    if !enabled {
        return Ok(DraftSaveResult::Refused(DraftSaveRefusal::Disabled));
    }
    let workspace = load_current_workspace_from_native_owner(workspace_owner)
        .map_err(|_| anyhow::anyhow!("current workspace unavailable"))?;
    let lease = load_current_credential_from_native_owner(credential_owner)
        .map_err(|_| anyhow::anyhow!("current credential unavailable"))?;
    lease
        .binding_for(M4CredentialProvider::Microsoft)
        .map_err(|_| anyhow::anyhow!("current credential is not Microsoft"))?;
    let attempt =
        match reserve_one_winner(store, &workspace, lease, expected_mailbox, expected_claim) {
            Ok(attempt) => attempt,
            Err(_) => return Ok(DraftSaveResult::Refused(DraftSaveRefusal::ClaimOrHistory)),
        };
    let capability = SealedMicrosoftDraftCapability { attempt };
    match transport
        .save(&capability)
        .context("local sealed draft-save seam")?
    {
        SealedDraftSaveOutcome::RefusedBeforeProvider => {
            terminalize_attempt(store, &capability.attempt, "failed")?;
            Ok(DraftSaveResult::Refused(DraftSaveRefusal::LocalRefusal))
        }
        SealedDraftSaveOutcome::UnknownAfterProviderBoundary => {
            terminalize_attempt(store, &capability.attempt, "unknown")?;
            Ok(DraftSaveResult::Refused(DraftSaveRefusal::Unknown))
        }
        SealedDraftSaveOutcome::Saved {
            provider_draft_id,
            safe_metadata,
        } => {
            let receipt = ProviderDraftReceipt {
                provider_draft_id,
                safe_metadata,
            };
            if force_receipt_failure
                || persist_receipt(store, &capability.attempt, &receipt).is_err()
            {
                terminalize_attempt(store, &capability.attempt, "unknown")?;
                return Ok(DraftSaveResult::Refused(DraftSaveRefusal::ReceiptFailure));
            }
            Ok(DraftSaveResult::Saved {
                provider_draft_id: receipt.provider_draft_id,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{
        crm::core_store::CrmCoreStore,
        mail::{
            m4_create_provider_draft,
            verified_draft_claim::test_only_approved_draft_payload,
            verified_m4_credentials::{test_only_credential_lease, M4CredentialProvider},
            verified_mailbox::{
                authorize_adapter_dispatch, register_current_verified_mailbox, test_only_evidence,
                transition_mailbox, MailboxState,
            },
            verified_workspace_lifecycle::test_only_current_workspace_authority,
        },
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::TempDir;

    fn setup(
        provider: M4CredentialProvider,
        subject: &str,
        generation: u64,
    ) -> (
        TempDir,
        CrmCoreStore,
        super::super::verified_workspace_lifecycle::VerifiedWorkspaceAuthority,
        super::super::verified_m4_credentials::VerifiedCredentialLease,
        super::super::verified_mailbox::VerifiedMailboxRecord,
    ) {
        let dir = TempDir::new().unwrap();
        let store = CrmCoreStore::open_with_key(dir.path(), &[93; 32]).unwrap();
        let workspace = test_only_current_workspace_authority("native-slot-workspace", 1);
        let lease = test_only_credential_lease(provider, subject, generation).unwrap();
        let binding = lease.binding_for(provider).unwrap();
        let mailbox = register_current_verified_mailbox(
            &store,
            &workspace,
            binding,
            &test_only_evidence("advisor@example.com"),
        )
        .unwrap();
        (dir, store, workspace, lease, mailbox)
    }

    struct CountingFake {
        calls: AtomicUsize,
        outcome: super::super::m4_microsoft_sealed_transport::SealedDraftSaveOutcome,
    }

    impl CountingFake {
        fn saved() -> Self {
            Self {
                calls: AtomicUsize::new(0),
                outcome:
                    super::super::m4_microsoft_sealed_transport::SealedDraftSaveOutcome::Saved {
                        provider_draft_id: "draft-42".into(),
                        safe_metadata: "local-test-receipt".into(),
                    },
            }
        }

        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl super::super::m4_microsoft_sealed_transport::TestOnlySealedMicrosoftDraftTransport
        for CountingFake
    {
        fn save(
            &self,
            _: &super::SealedMicrosoftDraftCapability,
        ) -> Result<super::super::m4_microsoft_sealed_transport::SealedDraftSaveOutcome> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.outcome.clone())
        }
    }

    struct DurableFixture {
        dir: TempDir,
        store: CrmCoreStore,
        workspace_owner: super::super::verified_workspace_lifecycle::NativeWorkspaceLifecycle,
        credential_owner: super::super::verified_m4_credentials::NativeM4CredentialLifecycle,
        mailbox: super::super::verified_mailbox::VerifiedMailboxRecord,
        claim: crate::commands::crm::core_model::ApprovedDraftClaimRecord,
    }

    fn durable_fixture() -> DurableFixture {
        use super::super::{
            verified_draft_claim::test_only_create_approved_claim,
            verified_m4_credentials::{
                load_current_credential_from_native_owner, test_only_native_credential_lifecycle,
            },
            verified_workspace_lifecycle::{
                load_current_workspace_from_native_owner, test_only_native_workspace_lifecycle,
            },
        };
        let dir = TempDir::new().unwrap();
        let store = CrmCoreStore::open_with_key(dir.path(), &[94; 32]).unwrap();
        let workspace_owner = test_only_native_workspace_lifecycle("native-durable", 1);
        let credential_owner = test_only_native_credential_lifecycle(
            M4CredentialProvider::Microsoft,
            "durable-subject",
            1,
        )
        .unwrap();
        let workspace = load_current_workspace_from_native_owner(&workspace_owner).unwrap();
        let lease = load_current_credential_from_native_owner(&credential_owner).unwrap();
        let credential = lease.binding_for(M4CredentialProvider::Microsoft).unwrap();
        let mailbox = register_current_verified_mailbox(
            &store,
            &workspace,
            credential,
            &test_only_evidence("ada@example.com"),
        )
        .unwrap();
        let claim = test_only_create_approved_claim(
            &store,
            &workspace,
            credential,
            &mailbox,
            "durable-key",
        )
        .unwrap();
        DurableFixture {
            dir,
            store,
            workspace_owner,
            credential_owner,
            mailbox,
            claim,
        }
    }

    fn durable_run(
        fixture: &DurableFixture,
        enabled: bool,
        fake: &CountingFake,
        force_receipt_failure: bool,
    ) -> DraftSaveResult {
        test_only_save_approved_draft(
            enabled,
            &fixture.store,
            &fixture.workspace_owner,
            &fixture.credential_owner,
            &fixture.mailbox,
            &fixture.claim,
            fake,
            force_receipt_failure,
        )
        .unwrap()
    }

    #[test]
    fn durable_authority_flag_off_never_calls_the_sealed_seam() {
        let fixture = durable_fixture();
        let fake = CountingFake::saved();
        assert_eq!(
            durable_run(&fixture, false, &fake, false),
            DraftSaveResult::Refused(DraftSaveRefusal::Disabled)
        );
        assert_eq!(fake.calls(), 0);
        assert_eq!(
            m4_production_draft_save_boundary(),
            DraftSaveResult::Refused(DraftSaveRefusal::Disabled)
        );
    }

    #[test]
    fn durable_authority_has_exactly_one_concurrent_winner_and_one_receipt() {
        let fixture = durable_fixture();
        let fake = CountingFake::saved();
        std::thread::scope(|scope| {
            let first = scope.spawn(|| durable_run(&fixture, true, &fake, false));
            let second = scope.spawn(|| durable_run(&fixture, true, &fake, false));
            let results = [first.join().unwrap(), second.join().unwrap()];
            assert_eq!(
                results
                    .iter()
                    .filter(|result| matches!(result, DraftSaveResult::Saved { .. }))
                    .count(),
                1
            );
        });
        assert_eq!(fake.calls(), 1);
        let (status, receipts): (String, i64) = fixture
            .store
            .m4_shared_foundation_transaction(|transaction| {
                Ok((
                    transaction.query_row(
                        "SELECT status FROM verified_draft_claims WHERE claim_handle=?1",
                        [&fixture.claim.claim_handle],
                        |row| row.get(0),
                    )?,
                    transaction.query_row(
                        "SELECT COUNT(*) FROM m4_provider_draft_receipts WHERE claim_handle=?1",
                        [&fixture.claim.claim_handle],
                        |row| row.get(0),
                    )?,
                ))
            })
            .unwrap();
        assert_eq!(status, "saved");
        assert_eq!(receipts, 1);
    }

    #[test]
    fn durable_authority_refuses_stale_bindings_before_a_call() {
        let fixture = durable_fixture();
        let stale_workspace =
            super::super::verified_workspace_lifecycle::test_only_native_workspace_lifecycle(
                "other", 1,
            );
        let fake = CountingFake::saved();
        assert!(matches!(
            test_only_save_approved_draft(
                true,
                &fixture.store,
                &stale_workspace,
                &fixture.credential_owner,
                &fixture.mailbox,
                &fixture.claim,
                &fake,
                false
            )
            .unwrap(),
            DraftSaveResult::Refused(_)
        ));
        assert_eq!(fake.calls(), 0);

        let changed = durable_fixture();
        changed
            .store
            .m4_shared_foundation_transaction(|transaction| {
                transaction.execute(
                    "UPDATE verified_draft_claims SET body='changed' WHERE claim_handle=?1",
                    [&changed.claim.claim_handle],
                )?;
                Ok(())
            })
            .unwrap();
        let fake = CountingFake::saved();
        assert!(matches!(
            durable_run(&changed, true, &fake, false),
            DraftSaveResult::Refused(_)
        ));
        assert_eq!(fake.calls(), 0);
    }

    #[test]
    fn durable_authority_recovers_saving_as_unknown_after_restart_without_retry() {
        use super::super::{
            verified_m4_credentials::load_current_credential_from_native_owner,
            verified_workspace_lifecycle::load_current_workspace_from_native_owner,
        };
        let fixture = durable_fixture();
        let workspace = load_current_workspace_from_native_owner(&fixture.workspace_owner).unwrap();
        let lease = load_current_credential_from_native_owner(&fixture.credential_owner).unwrap();
        reserve_one_winner(
            &fixture.store,
            &workspace,
            lease,
            &fixture.mailbox,
            &fixture.claim,
        )
        .unwrap();
        let reopened = CrmCoreStore::open_with_key(fixture.dir.path(), &[94; 32]).unwrap();
        recover_saving_attempts(
            &reopened,
            &workspace,
            lease.binding_for(M4CredentialProvider::Microsoft).unwrap(),
        )
        .unwrap();
        drop(reopened);
        let fake = CountingFake::saved();
        assert!(matches!(
            durable_run(&fixture, true, &fake, false),
            DraftSaveResult::Refused(_)
        ));
        assert_eq!(fake.calls(), 0);
        let status: String = fixture
            .store
            .m4_shared_foundation_transaction(|transaction| {
                Ok(transaction.query_row(
                    "SELECT status FROM verified_draft_claims WHERE claim_handle=?1",
                    [&fixture.claim.claim_handle],
                    |row| row.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(status, "unknown");
    }

    #[test]
    fn durable_authority_marks_ambiguous_or_unreceipted_results_unknown_without_retry() {
        use super::super::m4_microsoft_sealed_transport::SealedDraftSaveOutcome;
        let ambiguous = durable_fixture();
        let fake = CountingFake {
            calls: AtomicUsize::new(0),
            outcome: SealedDraftSaveOutcome::UnknownAfterProviderBoundary,
        };
        assert_eq!(
            durable_run(&ambiguous, true, &fake, false),
            DraftSaveResult::Refused(DraftSaveRefusal::Unknown)
        );
        assert!(matches!(
            durable_run(&ambiguous, true, &fake, false),
            DraftSaveResult::Refused(_)
        ));
        assert_eq!(fake.calls(), 1);

        let no_receipt = durable_fixture();
        let fake = CountingFake::saved();
        assert_eq!(
            durable_run(&no_receipt, true, &fake, true),
            DraftSaveResult::Refused(DraftSaveRefusal::ReceiptFailure)
        );
        assert!(matches!(
            durable_run(&no_receipt, true, &fake, false),
            DraftSaveResult::Refused(_)
        ));
        assert_eq!(fake.calls(), 1);
    }

    #[test]
    fn durable_authority_local_refusal_requires_a_new_approved_claim() {
        use super::super::{
            m4_microsoft_sealed_transport::SealedDraftSaveOutcome,
            verified_m4_credentials::load_current_credential_from_native_owner,
            verified_workspace_lifecycle::load_current_workspace_from_native_owner,
        };
        let fixture = durable_fixture();
        let refusal = CountingFake {
            calls: AtomicUsize::new(0),
            outcome: SealedDraftSaveOutcome::RefusedBeforeProvider,
        };
        assert_eq!(
            durable_run(&fixture, true, &refusal, false),
            DraftSaveResult::Refused(DraftSaveRefusal::LocalRefusal)
        );
        assert!(matches!(
            durable_run(&fixture, true, &refusal, false),
            DraftSaveResult::Refused(_)
        ));
        assert_eq!(refusal.calls(), 1);

        let workspace = load_current_workspace_from_native_owner(&fixture.workspace_owner).unwrap();
        let lease = load_current_credential_from_native_owner(&fixture.credential_owner).unwrap();
        let new_claim = super::super::verified_draft_claim::test_only_create_approved_claim(
            &fixture.store,
            &workspace,
            lease.binding_for(M4CredentialProvider::Microsoft).unwrap(),
            &fixture.mailbox,
            "new-approved-key",
        )
        .unwrap();
        let success = CountingFake::saved();
        assert!(matches!(
            test_only_save_approved_draft(
                true,
                &fixture.store,
                &fixture.workspace_owner,
                &fixture.credential_owner,
                &fixture.mailbox,
                &new_claim,
                &success,
                false,
            )
            .unwrap(),
            DraftSaveResult::Saved { .. }
        ));
        assert_eq!(success.calls(), 1);
    }

    #[test]
    fn m4_adapter_slots_require_sealed_authorization_and_credential_context() {
        let (_dir, store, workspace, lease, mailbox) =
            setup(M4CredentialProvider::Microsoft, "microsoft-subject", 1);
        let authorization =
            authorize_adapter_dispatch(&store, &workspace, &lease, &mailbox, "advisor@example.com")
                .unwrap();
        let payload = test_only_approved_draft_payload();
        assert!(create_draft(&authorization, &payload).is_err());
        assert!(m4_create_provider_draft(&authorization, &payload).is_err());
    }

    #[test]
    fn m4_adapter_slots_refuse_generic_zero_and_stale_generations() {
        for subject in ["", "default", "generic", "account", "unknown"] {
            assert!(
                test_only_credential_lease(M4CredentialProvider::Microsoft, subject, 1).is_err()
            );
        }
        assert!(
            test_only_credential_lease(M4CredentialProvider::Microsoft, "real-subject", 0).is_err()
        );

        let (_dir, store, workspace, lease, mailbox) =
            setup(M4CredentialProvider::Microsoft, "microsoft-subject", 1);
        let stale_lease =
            test_only_credential_lease(M4CredentialProvider::Microsoft, "microsoft-subject", 2)
                .unwrap();
        assert!(authorize_adapter_dispatch(
            &store,
            &workspace,
            &stale_lease,
            &mailbox,
            "advisor@example.com",
        )
        .is_err());
        assert!(authorize_adapter_dispatch(
            &store,
            &workspace,
            &lease,
            &mailbox,
            "advisor@example.com",
        )
        .is_ok());
    }

    #[test]
    fn m4_adapter_slots_refuse_old_mailbox_after_current_row_changes() {
        let (_dir, store, workspace, lease, mailbox) =
            setup(M4CredentialProvider::Microsoft, "microsoft-subject", 1);
        let binding = lease.binding_for(M4CredentialProvider::Microsoft).unwrap();
        let copied_mailbox = mailbox.clone();
        let changed = transition_mailbox(
            &store,
            &workspace,
            M4CredentialProvider::Microsoft,
            mailbox.version(),
            MailboxState::Stale,
        )
        .unwrap();
        assert!(authorize_adapter_dispatch(
            &store,
            &workspace,
            &lease,
            &copied_mailbox,
            "advisor@example.com",
        )
        .is_err());
        assert!(authorize_adapter_dispatch(
            &store,
            &workspace,
            &lease,
            &changed,
            "advisor@example.com",
        )
        .is_err());
        assert_eq!(binding.provider(), M4CredentialProvider::Microsoft);
    }

    #[test]
    fn m4_adapter_slots_placeholders_are_unavailable_and_result_is_draft_only() {
        let (_dir, store, workspace, lease, mailbox) =
            setup(M4CredentialProvider::Microsoft, "microsoft-subject", 1);
        let authorization =
            authorize_adapter_dispatch(&store, &workspace, &lease, &mailbox, "advisor@example.com")
                .unwrap();
        let payload = test_only_approved_draft_payload();
        assert!(create_draft(&authorization, &payload).is_err());
        assert_eq!(payload.draft_subject(), "Advisor follow-up");
        assert_ne!(payload.draft_subject(), "microsoft-subject");
        let result = authorization
            .saved_draft_result("provider-draft-7")
            .unwrap();
        assert_eq!(result.draft_id(), "provider-draft-7");
        assert_eq!(
            result.verified_mailbox_label(),
            "Ada Advisor — advisor@example.com"
        );
    }
}

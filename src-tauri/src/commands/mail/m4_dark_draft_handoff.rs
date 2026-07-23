//! A private M4 handoff boundary that remains dark until later sealed work.

#![allow(dead_code)]

/// This is intentionally immutable and disabled in every production build.
const M4_DARK_DRAFT_HANDOFF_ENABLED: bool = false;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum M4DarkDraftHandoffRefusal {
    Disabled,
    CurrentMailbox,
    DuplicateKey,
    ConflictingKey,
    IndeterminateKey,
    MissingClaim,
    MalformedClaim,
    NonApprovedClaim,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum M4DarkDraftHandoffResult {
    Refused(M4DarkDraftHandoffRefusal),
    WaitingForFutureSealedWork,
}

/// The production boundary has no loader, adapter, or transport input. Its
/// immutable gate returns before any dependency can be reached.
fn m4_dark_draft_handoff() -> M4DarkDraftHandoffResult {
    if !M4_DARK_DRAFT_HANDOFF_ENABLED {
        return M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::Disabled);
    }
    M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::Disabled)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use anyhow::Result;
    use tempfile::TempDir;

    use super::{M4DarkDraftHandoffRefusal, M4DarkDraftHandoffResult};
    use crate::commands::{
        crm::{core_model::ApprovedDraftClaimRecord, core_store::CrmCoreStore},
        mail::{
            verified_draft_claim::{
                reload_dark_handoff_claim_history, test_only_create_approved_claim,
                DarkClaimHistory,
            },
            verified_m4_credentials::{
                load_current_credential_from_native_owner, test_only_native_credential_lifecycle,
                M4CredentialProvider, NativeM4CredentialLifecycle,
            },
            verified_mailbox::{
                register_current_verified_mailbox, reload_exact_current_mailbox_for_expected,
                test_only_evidence, VerifiedMailboxRecord,
            },
            verified_workspace_lifecycle::{
                load_current_workspace_from_native_owner, test_only_native_workspace_lifecycle,
                NativeWorkspaceLifecycle,
            },
        },
    };

    struct TestOnlyLoaders<'a> {
        workspace_owner: &'a NativeWorkspaceLifecycle,
        credential_owner: &'a NativeM4CredentialLifecycle,
        store: &'a CrmCoreStore,
        expected_mailbox: &'a VerifiedMailboxRecord,
        expected_claim: &'a ApprovedDraftClaimRecord,
        workspace_count: AtomicUsize,
        credential_count: AtomicUsize,
        mailbox_count: AtomicUsize,
        claim_count: AtomicUsize,
    }

    impl<'a> TestOnlyLoaders<'a> {
        fn load_workspace(
            &self,
        ) -> Result<crate::commands::mail::verified_workspace_lifecycle::VerifiedWorkspaceAuthority>
        {
            self.workspace_count.fetch_add(1, Ordering::SeqCst);
            load_current_workspace_from_native_owner(self.workspace_owner)
        }

        fn load_credential(
            &self,
        ) -> Result<&crate::commands::mail::verified_m4_credentials::VerifiedCredentialLease>
        {
            self.credential_count.fetch_add(1, Ordering::SeqCst);
            load_current_credential_from_native_owner(self.credential_owner)
        }
    }

    fn test_only_enabled_handoff(
        enabled: bool,
        loaders: &TestOnlyLoaders<'_>,
    ) -> Result<M4DarkDraftHandoffResult> {
        if !enabled {
            return Ok(M4DarkDraftHandoffResult::Refused(
                M4DarkDraftHandoffRefusal::Disabled,
            ));
        }

        let workspace = loaders.load_workspace()?;
        let credential_lease = loaders.load_credential()?;
        let credential = credential_lease.binding_for(credential_lease.provider())?;
        loaders
            .store
            .m4_shared_foundation_transaction(|transaction| {
                loaders.mailbox_count.fetch_add(1, Ordering::SeqCst);
                let current_mailbox = match reload_exact_current_mailbox_for_expected(
                    transaction,
                    &workspace,
                    credential,
                    loaders.expected_mailbox,
                ) {
                    Ok(current) => current,
                    Err(_) => {
                        return Ok(M4DarkDraftHandoffResult::Refused(
                            M4DarkDraftHandoffRefusal::CurrentMailbox,
                        ));
                    }
                };
                loaders.claim_count.fetch_add(1, Ordering::SeqCst);
                let result = match reload_dark_handoff_claim_history(
                    transaction,
                    &workspace,
                    credential,
                    &current_mailbox,
                    loaders.expected_claim,
                )? {
                    DarkClaimHistory::CurrentApproved(_) => {
                        M4DarkDraftHandoffResult::WaitingForFutureSealedWork
                    }
                    DarkClaimHistory::DuplicateKey => {
                        M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::DuplicateKey)
                    }
                    DarkClaimHistory::ConflictingKey => {
                        M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::ConflictingKey)
                    }
                    DarkClaimHistory::IndeterminateKey => M4DarkDraftHandoffResult::Refused(
                        M4DarkDraftHandoffRefusal::IndeterminateKey,
                    ),
                    DarkClaimHistory::Missing => {
                        M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::MissingClaim)
                    }
                    DarkClaimHistory::Malformed => {
                        M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::MalformedClaim)
                    }
                    DarkClaimHistory::NotApproved => M4DarkDraftHandoffResult::Refused(
                        M4DarkDraftHandoffRefusal::NonApprovedClaim,
                    ),
                };
                Ok(result)
            })
    }

    struct Fixture {
        _dir: TempDir,
        store: CrmCoreStore,
        workspace_owner: NativeWorkspaceLifecycle,
        credential_owner: NativeM4CredentialLifecycle,
        mailbox: VerifiedMailboxRecord,
        claim: ApprovedDraftClaimRecord,
    }

    fn fixture() -> Fixture {
        let dir = TempDir::new().unwrap();
        let store = CrmCoreStore::open_with_key(dir.path(), &[77; 32]).unwrap();
        let workspace_owner = test_only_native_workspace_lifecycle("native-a", 1);
        let credential_owner =
            test_only_native_credential_lifecycle(M4CredentialProvider::Microsoft, "subject-a", 1)
                .unwrap();
        let workspace = load_current_workspace_from_native_owner(&workspace_owner).unwrap();
        let lease = load_current_credential_from_native_owner(&credential_owner).unwrap();
        let credential = lease.binding_for(lease.provider()).unwrap();
        let mailbox = register_current_verified_mailbox(
            &store,
            &workspace,
            credential,
            &test_only_evidence("ada@example.com"),
        )
        .unwrap();
        let claim =
            test_only_create_approved_claim(&store, &workspace, credential, &mailbox, "key-a")
                .unwrap();
        Fixture {
            _dir: dir,
            store,
            workspace_owner,
            credential_owner,
            mailbox,
            claim,
        }
    }

    fn run(fixture: &Fixture) -> M4DarkDraftHandoffResult {
        let loaders = TestOnlyLoaders {
            workspace_owner: &fixture.workspace_owner,
            credential_owner: &fixture.credential_owner,
            store: &fixture.store,
            expected_mailbox: &fixture.mailbox,
            expected_claim: &fixture.claim,
            workspace_count: AtomicUsize::new(0),
            credential_count: AtomicUsize::new(0),
            mailbox_count: AtomicUsize::new(0),
            claim_count: AtomicUsize::new(0),
        };
        test_only_enabled_handoff(true, &loaders).unwrap()
    }

    #[test]
    fn m4_dark_draft_handoff_off_gate_calls_no_loader() {
        let fixture = fixture();
        let loaders = TestOnlyLoaders {
            workspace_owner: &fixture.workspace_owner,
            credential_owner: &fixture.credential_owner,
            store: &fixture.store,
            expected_mailbox: &fixture.mailbox,
            expected_claim: &fixture.claim,
            workspace_count: AtomicUsize::new(0),
            credential_count: AtomicUsize::new(0),
            mailbox_count: AtomicUsize::new(0),
            claim_count: AtomicUsize::new(0),
        };
        assert_eq!(
            test_only_enabled_handoff(false, &loaders).unwrap(),
            M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::Disabled)
        );
        assert_eq!(loaders.workspace_count.load(Ordering::SeqCst), 0);
        assert_eq!(loaders.credential_count.load(Ordering::SeqCst), 0);
        assert_eq!(loaders.mailbox_count.load(Ordering::SeqCst), 0);
        assert_eq!(loaders.claim_count.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn m4_dark_draft_handoff_current_encrypted_truth_only_waits() {
        assert_eq!(
            run(&fixture()),
            M4DarkDraftHandoffResult::WaitingForFutureSealedWork
        );
    }

    #[test]
    fn m4_dark_draft_handoff_refuses_stale_mailbox_and_claim_truth() {
        let first = fixture();
        first
            .store
            .m4_shared_foundation_transaction(|transaction| {
                transaction.execute(
                    "UPDATE verified_mailboxes SET canonical_address='other@example.com', version=2 WHERE workspace_handle='native-a' AND provider='microsoft'",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        assert_eq!(
            run(&first),
            M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::CurrentMailbox)
        );

        let second = fixture();
        second
            .store
            .m4_shared_foundation_transaction(|transaction| {
                transaction.execute(
                    "UPDATE verified_draft_claims SET body='changed' WHERE claim_handle=?1",
                    [&second.claim.claim_handle],
                )?;
                Ok(())
            })
            .unwrap();
        assert_eq!(
            run(&second),
            M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::ConflictingKey)
        );
    }

    #[test]
    fn m4_dark_draft_handoff_refuses_changed_workspace_provider_subject_address_and_generation() {
        let fixture = fixture();
        let changed_workspace = test_only_native_workspace_lifecycle("native-b", 1);
        let loaders = TestOnlyLoaders {
            workspace_owner: &changed_workspace,
            credential_owner: &fixture.credential_owner,
            store: &fixture.store,
            expected_mailbox: &fixture.mailbox,
            expected_claim: &fixture.claim,
            workspace_count: AtomicUsize::new(0),
            credential_count: AtomicUsize::new(0),
            mailbox_count: AtomicUsize::new(0),
            claim_count: AtomicUsize::new(0),
        };
        assert_eq!(
            test_only_enabled_handoff(true, &loaders).unwrap(),
            M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::CurrentMailbox)
        );

        for (provider, subject, generation) in [
            (M4CredentialProvider::Gmail, "subject-a", 1),
            (M4CredentialProvider::Microsoft, "subject-b", 1),
            (M4CredentialProvider::Microsoft, "subject-a", 2),
        ] {
            let credential_owner =
                test_only_native_credential_lifecycle(provider, subject, generation).unwrap();
            let loaders = TestOnlyLoaders {
                workspace_owner: &fixture.workspace_owner,
                credential_owner: &credential_owner,
                store: &fixture.store,
                expected_mailbox: &fixture.mailbox,
                expected_claim: &fixture.claim,
                workspace_count: AtomicUsize::new(0),
                credential_count: AtomicUsize::new(0),
                mailbox_count: AtomicUsize::new(0),
                claim_count: AtomicUsize::new(0),
            };
            assert_eq!(
                test_only_enabled_handoff(true, &loaders).unwrap(),
                M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::CurrentMailbox)
            );
        }
    }

    #[test]
    fn m4_dark_draft_handoff_derives_all_key_refusals_from_rows() {
        let duplicate = fixture();
        duplicate.store.m4_shared_foundation_transaction(|transaction| {
            transaction.execute("UPDATE verified_draft_claims SET status='claimed', version=2 WHERE claim_handle=?1", [&duplicate.claim.claim_handle])?;
            Ok(())
        }).unwrap();
        assert_eq!(
            run(&duplicate),
            M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::DuplicateKey)
        );

        let unknown = fixture();
        unknown.store.m4_shared_foundation_transaction(|transaction| {
            transaction.execute("UPDATE verified_draft_claims SET status='unknown', version=2 WHERE claim_handle=?1", [&unknown.claim.claim_handle])?;
            Ok(())
        }).unwrap();
        assert_eq!(
            run(&unknown),
            M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::IndeterminateKey)
        );

        let missing = fixture();
        missing
            .store
            .m4_shared_foundation_transaction(|transaction| {
                transaction.execute(
                    "DELETE FROM verified_draft_claims WHERE claim_handle=?1",
                    [&missing.claim.claim_handle],
                )?;
                Ok(())
            })
            .unwrap();
        assert_eq!(
            run(&missing),
            M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::MissingClaim)
        );

        let malformed = fixture();
        malformed
            .store
            .m4_shared_foundation_transaction(|transaction| {
                transaction.execute(
                    "UPDATE verified_draft_claims SET body='' WHERE claim_handle=?1",
                    [&malformed.claim.claim_handle],
                )?;
                Ok(())
            })
            .unwrap();
        assert_eq!(
            run(&malformed),
            M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::MalformedClaim)
        );

        let nonapproved = fixture();
        nonapproved.store.m4_shared_foundation_transaction(|transaction| {
            transaction.execute("UPDATE verified_draft_claims SET status='prepared', version=2 WHERE claim_handle=?1", [&nonapproved.claim.claim_handle])?;
            Ok(())
        }).unwrap();
        assert_eq!(
            run(&nonapproved),
            M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::NonApprovedClaim)
        );
    }

    #[test]
    fn m4_dark_draft_handoff_source_stays_private_and_dark() {
        assert_eq!(
            super::m4_dark_draft_handoff(),
            M4DarkDraftHandoffResult::Refused(M4DarkDraftHandoffRefusal::Disabled)
        );
    }
}

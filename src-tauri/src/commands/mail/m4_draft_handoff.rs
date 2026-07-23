//! Default-off native M4 draft-handoff lifecycle.
//!
//! This is deliberately a state-and-denial packet. It does not load a
//! credential, resolve identity, contact a provider, create a provider draft,
//! finalize a durable receipt, or open anything outside the native process.

#![allow(dead_code)]

use crate::commands::{
    crm::core_model::ApprovedDraftClaimRecord,
    mail::{
        verified_m4_credentials::VerifiedCredentialBinding,
        verified_mailbox::{MailboxState, VerifiedMailboxRecord},
        verified_workspace_authority::VerifiedWorkspaceAuthority,
    },
};

/// The lifecycle is private and stays off until a later, separately reviewed
/// native packet supplies every sealed dependency.
const M4_DRAFT_HANDOFF_ENABLED_BY_DEFAULT: bool = false;

/// Private runtime gate. There is intentionally no production setter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct M4DraftHandoffGate {
    enabled: bool,
}

impl Default for M4DraftHandoffGate {
    fn default() -> Self {
        Self {
            enabled: M4_DRAFT_HANDOFF_ENABLED_BY_DEFAULT,
        }
    }
}

impl M4DraftHandoffGate {
    fn is_enabled(self) -> bool {
        self.enabled
    }

    #[cfg(test)]
    fn enabled_for_test() -> Self {
        Self { enabled: true }
    }
}

/// The claim-to-dispatch state model. This packet may only reach the final
/// waiting state; a later sealed packet owns any provider-side transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum M4DraftHandoffState {
    ClaimPresented,
    ClaimBound,
    AwaitingSealedDispatch,
    Refused,
}

impl M4DraftHandoffState {
    fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::ClaimPresented, Self::ClaimBound | Self::Refused)
                | (
                    Self::ClaimBound,
                    Self::AwaitingSealedDispatch | Self::Refused
                )
        )
    }
}

/// A receipt has only dark, draft-only outcomes. It cannot represent a message
/// delivery result because this lifecycle has no delivery capability.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum M4DraftReceiptState {
    NoProviderAction,
    AwaitingSealedDispatch,
    Refused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum M4DraftHandoffRefusal {
    FeatureDisabled,
    InvalidWorkspaceAuthority,
    ChangedWorkspaceAuthority,
    StaleMailbox,
    ExactAccountMismatch,
    CredentialGenerationMismatch,
    ChangedApprovedClaim,
    DuplicateIdempotencyKey,
    ConflictingIdempotencyKey,
    UnknownPriorOutcome,
}

/// The idempotency verdict must come from a future encrypted claim-history
/// reader. This dark packet accepts only an explicit fresh verdict.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum M4DraftIdempotencyVerdict {
    Fresh,
    Duplicate,
    Conflict,
    Unknown,
}

/// All native values are borrowed. This module does not mint identity,
/// credentials, mailboxes, claims, or provider authority.
struct M4DraftHandoffAttempt<'a> {
    workspace: &'a VerifiedWorkspaceAuthority,
    credential: &'a VerifiedCredentialBinding,
    mailbox: &'a VerifiedMailboxRecord,
    expected_claim: &'a ApprovedDraftClaimRecord,
    current_claim: &'a ApprovedDraftClaimRecord,
    idempotency: M4DraftIdempotencyVerdict,
}

/// The lifecycle result deliberately stops before provider work. `receipt` is
/// an in-memory description, never a receipt-finalization operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct M4DraftHandoffResult {
    state: M4DraftHandoffState,
    receipt: M4DraftReceiptState,
    refusal: Option<M4DraftHandoffRefusal>,
}

impl M4DraftHandoffResult {
    fn refused(reason: M4DraftHandoffRefusal) -> Self {
        Self {
            state: M4DraftHandoffState::Refused,
            receipt: M4DraftReceiptState::Refused,
            refusal: Some(reason),
        }
    }

    fn awaiting_sealed_dispatch() -> Self {
        Self {
            state: M4DraftHandoffState::AwaitingSealedDispatch,
            receipt: M4DraftReceiptState::AwaitingSealedDispatch,
            refusal: None,
        }
    }
}

/// Evaluates only local, already-carried state. The feature gate is the first
/// branch so the default path cannot inspect a workspace, credential, mailbox,
/// claim, idempotency history, or any external boundary.
fn evaluate_handoff(
    gate: M4DraftHandoffGate,
    attempt: &M4DraftHandoffAttempt<'_>,
) -> M4DraftHandoffResult {
    if !gate.is_enabled() {
        return M4DraftHandoffResult::refused(M4DraftHandoffRefusal::FeatureDisabled);
    }

    if !attempt.workspace.is_well_formed() {
        return M4DraftHandoffResult::refused(M4DraftHandoffRefusal::InvalidWorkspaceAuthority);
    }
    if attempt.current_claim.workspace_handle != attempt.workspace.native_handle()
        || attempt.current_claim.workspace_generation != attempt.workspace.generation()
    {
        return M4DraftHandoffResult::refused(M4DraftHandoffRefusal::ChangedWorkspaceAuthority);
    }
    if !matches!(attempt.mailbox.state(), Ok(MailboxState::Verified)) {
        return M4DraftHandoffResult::refused(M4DraftHandoffRefusal::StaleMailbox);
    }
    if attempt.current_claim.mailbox_handle != attempt.mailbox.handle()
        || attempt.current_claim.mailbox_version != attempt.mailbox.version()
    {
        return M4DraftHandoffResult::refused(M4DraftHandoffRefusal::StaleMailbox);
    }
    if attempt.current_claim.mailbox_handle
        != attempt
            .credential
            .expected_mailbox_handle(attempt.workspace)
    {
        return M4DraftHandoffResult::refused(M4DraftHandoffRefusal::ExactAccountMismatch);
    }
    if attempt.current_claim.provider != attempt.credential.provider().as_db()
        || attempt.current_claim.credential_generation != attempt.credential.generation().value()
    {
        return M4DraftHandoffResult::refused(M4DraftHandoffRefusal::CredentialGenerationMismatch);
    }
    if attempt.current_claim.status == "unknown" {
        return M4DraftHandoffResult::refused(M4DraftHandoffRefusal::UnknownPriorOutcome);
    }
    if attempt.current_claim != attempt.expected_claim
        || attempt.current_claim.status != "approved"
        || attempt.current_claim.version == 0
    {
        return M4DraftHandoffResult::refused(M4DraftHandoffRefusal::ChangedApprovedClaim);
    }
    match attempt.idempotency {
        M4DraftIdempotencyVerdict::Fresh => M4DraftHandoffResult::awaiting_sealed_dispatch(),
        M4DraftIdempotencyVerdict::Duplicate => {
            M4DraftHandoffResult::refused(M4DraftHandoffRefusal::DuplicateIdempotencyKey)
        }
        M4DraftIdempotencyVerdict::Conflict => {
            M4DraftHandoffResult::refused(M4DraftHandoffRefusal::ConflictingIdempotencyKey)
        }
        M4DraftIdempotencyVerdict::Unknown => {
            M4DraftHandoffResult::refused(M4DraftHandoffRefusal::UnknownPriorOutcome)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{
        crm::core_store::CrmCoreStore,
        mail::{
            verified_draft_claim::test_only_approved_draft_claim,
            verified_m4_credentials::{test_only_credential, M4CredentialProvider},
            verified_mailbox::{
                register_current_verified_mailbox, test_only_evidence, transition_mailbox,
            },
            verified_workspace_lifecycle::test_only_current_workspace_authority,
        },
    };
    use tempfile::TempDir;

    fn setup() -> (
        TempDir,
        CrmCoreStore,
        VerifiedWorkspaceAuthority,
        VerifiedCredentialBinding,
        VerifiedMailboxRecord,
        ApprovedDraftClaimRecord,
    ) {
        let dir = TempDir::new().unwrap();
        let store = CrmCoreStore::open_with_key(dir.path(), &[85; 32]).unwrap();
        let workspace = test_only_current_workspace_authority("native-workspace", 1);
        let credential =
            test_only_credential(M4CredentialProvider::Microsoft, "provider-subject", 1);
        let mailbox = register_current_verified_mailbox(
            &store,
            &workspace,
            &credential,
            &test_only_evidence("advisor@example.com"),
        )
        .unwrap();
        let claim = test_only_approved_draft_claim(&workspace, &credential, &mailbox, "claim-key");
        (dir, store, workspace, credential, mailbox, claim)
    }

    fn attempt<'a>(
        workspace: &'a VerifiedWorkspaceAuthority,
        credential: &'a VerifiedCredentialBinding,
        mailbox: &'a VerifiedMailboxRecord,
        expected_claim: &'a ApprovedDraftClaimRecord,
        current_claim: &'a ApprovedDraftClaimRecord,
        idempotency: M4DraftIdempotencyVerdict,
    ) -> M4DraftHandoffAttempt<'a> {
        M4DraftHandoffAttempt {
            workspace,
            credential,
            mailbox,
            expected_claim,
            current_claim,
            idempotency,
        }
    }

    #[test]
    fn m4_draft_handoff_is_default_off_and_refuses_without_reading_attempt_state() {
        let (_dir, _store, workspace, credential, mailbox, claim) = setup();
        let result = evaluate_handoff(
            M4DraftHandoffGate::default(),
            &attempt(
                &workspace,
                &credential,
                &mailbox,
                &claim,
                &claim,
                M4DraftIdempotencyVerdict::Fresh,
            ),
        );
        assert!(!M4DraftHandoffGate::default().is_enabled());
        assert_eq!(result.state, M4DraftHandoffState::Refused);
        assert_eq!(result.receipt, M4DraftReceiptState::Refused);
        assert_eq!(result.refusal, Some(M4DraftHandoffRefusal::FeatureDisabled));
    }

    #[test]
    fn m4_draft_handoff_state_machine_is_one_way_and_receipts_are_draft_only() {
        assert!(
            M4DraftHandoffState::ClaimPresented.can_transition_to(M4DraftHandoffState::ClaimBound)
        );
        assert!(M4DraftHandoffState::ClaimBound
            .can_transition_to(M4DraftHandoffState::AwaitingSealedDispatch));
        assert!(!M4DraftHandoffState::AwaitingSealedDispatch
            .can_transition_to(M4DraftHandoffState::ClaimPresented));
        assert_eq!(
            M4DraftHandoffResult::awaiting_sealed_dispatch().receipt,
            M4DraftReceiptState::AwaitingSealedDispatch
        );
    }

    #[test]
    fn m4_draft_handoff_refuses_stale_generation_account_workspace_and_claim_changes() {
        let (_dir, store, workspace, credential, mailbox, claim) = setup();
        let gate = M4DraftHandoffGate::enabled_for_test();

        let stale_mailbox = transition_mailbox(
            &store,
            &workspace,
            M4CredentialProvider::Microsoft,
            mailbox.version(),
            MailboxState::Stale,
        )
        .unwrap();
        assert_eq!(
            evaluate_handoff(
                gate,
                &attempt(
                    &workspace,
                    &credential,
                    &stale_mailbox,
                    &claim,
                    &claim,
                    M4DraftIdempotencyVerdict::Fresh,
                ),
            )
            .refusal,
            Some(M4DraftHandoffRefusal::StaleMailbox)
        );

        let (_dir, _store, workspace, credential, mailbox, claim) = setup();
        let changed_workspace = test_only_current_workspace_authority("other-workspace", 1);
        assert_eq!(
            evaluate_handoff(
                gate,
                &attempt(
                    &changed_workspace,
                    &credential,
                    &mailbox,
                    &claim,
                    &claim,
                    M4DraftIdempotencyVerdict::Fresh,
                ),
            )
            .refusal,
            Some(M4DraftHandoffRefusal::ChangedWorkspaceAuthority)
        );

        let changed_generation =
            test_only_credential(M4CredentialProvider::Microsoft, "provider-subject", 2);
        assert_eq!(
            evaluate_handoff(
                gate,
                &attempt(
                    &workspace,
                    &changed_generation,
                    &mailbox,
                    &claim,
                    &claim,
                    M4DraftIdempotencyVerdict::Fresh,
                ),
            )
            .refusal,
            Some(M4DraftHandoffRefusal::CredentialGenerationMismatch)
        );

        let other_account =
            test_only_credential(M4CredentialProvider::Microsoft, "other-subject", 1);
        assert_eq!(
            evaluate_handoff(
                gate,
                &attempt(
                    &workspace,
                    &other_account,
                    &mailbox,
                    &claim,
                    &claim,
                    M4DraftIdempotencyVerdict::Fresh,
                ),
            )
            .refusal,
            Some(M4DraftHandoffRefusal::ExactAccountMismatch)
        );

        let mut changed_claim = claim.clone();
        changed_claim.content_hash = "changed-content".into();
        assert_eq!(
            evaluate_handoff(
                gate,
                &attempt(
                    &workspace,
                    &credential,
                    &mailbox,
                    &claim,
                    &changed_claim,
                    M4DraftIdempotencyVerdict::Fresh,
                ),
            )
            .refusal,
            Some(M4DraftHandoffRefusal::ChangedApprovedClaim)
        );
    }

    #[test]
    fn m4_draft_handoff_refuses_duplicate_conflict_and_unknown_history() {
        let (_dir, _store, workspace, credential, mailbox, claim) = setup();
        let gate = M4DraftHandoffGate::enabled_for_test();
        for (idempotency, refusal) in [
            (
                M4DraftIdempotencyVerdict::Duplicate,
                M4DraftHandoffRefusal::DuplicateIdempotencyKey,
            ),
            (
                M4DraftIdempotencyVerdict::Conflict,
                M4DraftHandoffRefusal::ConflictingIdempotencyKey,
            ),
            (
                M4DraftIdempotencyVerdict::Unknown,
                M4DraftHandoffRefusal::UnknownPriorOutcome,
            ),
        ] {
            assert_eq!(
                evaluate_handoff(
                    gate,
                    &attempt(
                        &workspace,
                        &credential,
                        &mailbox,
                        &claim,
                        &claim,
                        idempotency,
                    ),
                )
                .refusal,
                Some(refusal)
            );
        }

        let mut unknown_claim = claim.clone();
        unknown_claim.status = "unknown".into();
        assert_eq!(
            evaluate_handoff(
                gate,
                &attempt(
                    &workspace,
                    &credential,
                    &mailbox,
                    &claim,
                    &unknown_claim,
                    M4DraftIdempotencyVerdict::Fresh,
                ),
            )
            .refusal,
            Some(M4DraftHandoffRefusal::UnknownPriorOutcome)
        );
    }

    #[test]
    fn m4_draft_handoff_source_cannot_reach_legacy_or_provider_surfaces() {
        let source = include_str!("m4_draft_handoff.rs").to_ascii_lowercase();
        for forbidden in [
            ["mail", "_send"].concat(),
            ["mail_save", "_draft"].concat(),
            ["m4_microsoft", "_adapter"].concat(),
            ["m4_gmail", "_adapter"].concat(),
            ["m4_create_provider", "_draft"].concat(),
            ["o", "auth"].concat(),
            ["req", "west"].concat(),
            ["keyring", "::entry"].concat(),
            ["open", "::that"].concat(),
            ["tauri", "::command"].concat(),
        ] {
            assert!(
                !source.contains(&forbidden),
                "lifecycle must not reach {forbidden}"
            );
        }
    }
}

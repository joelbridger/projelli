//! Private Microsoft adapter slot for the later sealed M4 draft handoff.
//!
//! This precursor contains a fixed contract only. It does not resolve an
//! identity, load credentials, contact Microsoft, create a draft, or send.

use anyhow::{bail, Result};

use super::{
    verified_draft_claim::ApprovedDraftPayloadView,
    verified_m4_credentials::M4CredentialProvider,
    verified_mailbox::{M4AdapterAuthorization, M4ProviderDraftResult},
};

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
    fn m4_adapter_slots_reject_cross_provider_context() {
        let (_dir, store, workspace, lease, mailbox) =
            setup(M4CredentialProvider::Gmail, "gmail-subject", 1);
        let authorization =
            authorize_adapter_dispatch(&store, &workspace, &lease, &mailbox, "advisor@example.com")
                .unwrap();
        let payload = test_only_approved_draft_payload();
        assert!(create_draft(&authorization, &payload).is_err());
        assert!(super::super::m4_gmail_adapter::create_draft(&authorization, &payload).is_err());
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

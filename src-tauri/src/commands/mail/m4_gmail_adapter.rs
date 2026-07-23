//! Private Gmail adapter slot for the later sealed M4 draft handoff.
//!
//! This precursor contains a fixed contract only. It does not resolve an
//! identity, load credentials, contact Gmail, create a draft, or send.

use anyhow::{bail, Result};

use super::{
    verified_draft_claim::ApprovedDraftPayloadView,
    verified_m4_credentials::M4CredentialProvider,
    verified_mailbox::{M4AdapterAuthorization, M4ProviderDraftResult},
};

/// Fixed Gmail contract. The provider-specific writer may replace only this
/// unavailable body while preserving the sealed input and result shape.
pub(super) fn create_draft(
    authorization: &M4AdapterAuthorization<'_>,
    draft: &ApprovedDraftPayloadView,
) -> Result<M4ProviderDraftResult> {
    let _credential = authorization.credential_for(M4CredentialProvider::Gmail)?;
    let _workspace = authorization.workspace();
    let _recipients = draft.recipients_json();
    let _draft_subject = draft.draft_subject();
    let _body = draft.body();
    bail!("Gmail M4 adapter is unavailable")
}

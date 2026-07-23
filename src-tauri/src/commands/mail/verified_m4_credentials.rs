//! Closed provider and credential-generation values for the M4 foundation.
//!
//! These types name a future native credential slot but never open a keychain,
//! contact a provider, or accept a renderer-selected account.

#![allow(dead_code)] // Deliberately dark until sealed adapters are connected.

use anyhow::{bail, Result};

use super::verified_workspace_authority::VerifiedWorkspaceAuthority;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum M4CredentialProvider {
    Microsoft,
    Gmail,
}

impl M4CredentialProvider {
    pub(super) fn as_db(self) -> &'static str {
        match self {
            Self::Microsoft => "microsoft",
            Self::Gmail => "gmail",
        }
    }

    pub(super) fn from_db(value: &str) -> Result<Self> {
        match value {
            "microsoft" => Ok(Self::Microsoft),
            "gmail" => Ok(Self::Gmail),
            _ => bail!("unrecognized verified-mailbox provider"),
        }
    }
}

/// Provider-issued account subject. There is deliberately no `From<String>`,
/// `Default`, or public constructor. Generic placeholders are refused before a
/// provider surface could ever be considered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderSubject(String);

impl ProviderSubject {
    pub(super) fn as_str(&self) -> &str {
        &self.0
    }
}

/// Opaque generation issued by the native credential lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct CredentialGeneration(u64);

impl CredentialGeneration {
    pub(super) fn value(self) -> u64 {
        self.0
    }
}

/// Closed proof that one provider subject owns the current credential
/// generation. It is not a token, and it cannot be reconstructed from a
/// service name or arbitrary account id.
#[derive(Debug, Clone)]
pub(super) struct VerifiedCredentialBinding {
    provider: M4CredentialProvider,
    subject: ProviderSubject,
    generation: CredentialGeneration,
}

impl VerifiedCredentialBinding {
    pub(super) fn provider(&self) -> M4CredentialProvider {
        self.provider
    }

    pub(super) fn subject(&self) -> &ProviderSubject {
        &self.subject
    }

    pub(super) fn generation(&self) -> CredentialGeneration {
        self.generation
    }
}

/// Build the native-owned credential service name without touching a keychain.
pub(super) fn m4_keychain_service_name(
    workspace: &VerifiedWorkspaceAuthority,
    credential: &VerifiedCredentialBinding,
) -> String {
    format!(
        "{}{}-{}-generation-{}",
        crate::identity::M4_MAIL_KEYCHAIN_SERVICE_PREFIX,
        credential.provider.as_db(),
        workspace.native_handle(),
        credential.generation.value(),
    )
}

fn is_generic_account_id(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "" | "default" | "generic" | "account" | "unknown" | "none" | "null"
    )
}

/// The future native credential lifecycle is the one production minting point.
/// Its input stays private to this module until a sealed provider adapter owns
/// resolution of a real provider subject.
fn mint_from_native_credential_state(
    provider: M4CredentialProvider,
    provider_subject: String,
    generation: u64,
) -> Result<VerifiedCredentialBinding> {
    if is_generic_account_id(&provider_subject) {
        bail!("generic provider account ids are not valid verified credentials")
    }
    if generation == 0 {
        bail!("credential generation must be nonzero")
    }
    Ok(VerifiedCredentialBinding {
        provider,
        subject: ProviderSubject(provider_subject),
        generation: CredentialGeneration(generation),
    })
}

#[cfg(test)]
pub(super) fn test_only_credential(
    provider: M4CredentialProvider,
    subject: &str,
    generation: u64,
) -> VerifiedCredentialBinding {
    mint_from_native_credential_state(provider, subject.to_string(), generation).unwrap()
}

#[cfg(test)]
pub(crate) fn test_only_service_name() -> String {
    let workspace =
        crate::commands::mail::verified_workspace_lifecycle::test_only_current_workspace_authority(
            "test-workspace",
            1,
        );
    let credential = test_only_credential(M4CredentialProvider::Microsoft, "test-subject", 1);
    m4_keychain_service_name(&workspace, &credential)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::mail::verified_workspace_lifecycle::test_only_current_workspace_authority;

    #[test]
    fn m4_shared_foundation_credential_inputs_are_closed_and_generic_accounts_refuse() {
        for generic in [
            "", "default", "generic", "account", "unknown", "none", "null",
        ] {
            assert!(mint_from_native_credential_state(
                M4CredentialProvider::Microsoft,
                generic.to_string(),
                1
            )
            .is_err());
        }
        assert!(mint_from_native_credential_state(
            M4CredentialProvider::Gmail,
            "real-subject".into(),
            0
        )
        .is_err());
        let credential =
            test_only_credential(M4CredentialProvider::Microsoft, "provider-subject-7", 3);
        let workspace = test_only_current_workspace_authority("native-workspace-a", 2);
        assert_eq!(
            m4_keychain_service_name(&workspace, &credential),
            "lantern-m4-mail-microsoft-native-workspace-a-generation-3"
        );
        assert_eq!(
            M4CredentialProvider::from_db("gmail").unwrap(),
            M4CredentialProvider::Gmail
        );
        assert!(M4CredentialProvider::from_db("imap").is_err());
    }
}

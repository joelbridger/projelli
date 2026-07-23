//! Closed M4 credential inputs and a pure keychain service-name builder.
//!
//! This is deliberately dark code: it names a future native credential slot,
//! but never opens the OS keychain or contacts a provider.

use super::verified_workspace_authority::VerifiedWorkspaceAuthority;

/// The only M4 mailbox providers. There is no string conversion or fallback.
pub(super) enum M4CredentialProvider {
    Microsoft,
    Gmail,
}

impl M4CredentialProvider {
    fn service_segment(self) -> &'static str {
        match self {
            Self::Microsoft => "microsoft",
            Self::Gmail => "gmail",
        }
    }
}

/// An opaque credential generation issued by the native lifecycle.
pub(super) struct CredentialGeneration(u64);

impl CredentialGeneration {
    fn service_segment(&self) -> u64 {
        self.0
    }
}

/// Build the native-owned M4 credential service name without touching a keychain.
pub(super) fn m4_keychain_service_name(
    workspace: VerifiedWorkspaceAuthority,
    provider: M4CredentialProvider,
    generation: CredentialGeneration,
) -> String {
    format!(
        "{}{}-{}-generation-{}",
        crate::identity::M4_MAIL_KEYCHAIN_SERVICE_PREFIX,
        provider.service_segment(),
        workspace.service_segment(),
        generation.service_segment(),
    )
}

#[cfg(test)]
fn test_only_credential_generation() -> CredentialGeneration {
    CredentialGeneration(1)
}

#[cfg(test)]
pub(crate) fn test_only_service_name() -> String {
    m4_keychain_service_name(
        super::verified_workspace_authority::test_only_verified_workspace_authority(),
        M4CredentialProvider::Microsoft,
        test_only_credential_generation(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn m4_foundation_builder_accepts_only_closed_native_inputs() {
        let service = test_only_service_name();
        assert_eq!(
            service,
            "lantern-m4-mail-microsoft-test-workspace-generation-1"
        );
    }

    #[test]
    fn m4_foundation_provider_is_closed_to_the_two_supported_values() {
        assert_eq!(
            M4CredentialProvider::Microsoft.service_segment(),
            "microsoft"
        );
        assert_eq!(M4CredentialProvider::Gmail.service_segment(), "gmail");
    }
}

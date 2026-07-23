//! Opaque native workspace authority for the M4 draft-handoff foundation.
//!
//! This module deliberately has no renderer conversion, path parser, or public
//! constructor. The future native lifecycle is the sole place allowed to mint
//! this capability after it has verified the selected workspace.

/// A workspace capability that ordinary mail code can carry but cannot mint.
pub(super) struct VerifiedWorkspaceAuthority(WorkspaceBinding);

/// The trusted lifecycle's private, already-verified workspace binding.
struct WorkspaceBinding(String);

impl VerifiedWorkspaceAuthority {
    pub(super) fn service_segment(&self) -> &str {
        &self.0 .0
    }
}

/// This is intentionally the only production constructor for the authority.
/// It remains private until the native lifecycle that verifies workspaces is
/// implemented in a later M4 step.
mod native_lifecycle {
    use super::{VerifiedWorkspaceAuthority, WorkspaceBinding};

    fn verified_workspace_authority(
        workspace_binding: WorkspaceBinding,
    ) -> VerifiedWorkspaceAuthority {
        VerifiedWorkspaceAuthority(workspace_binding)
    }

    #[cfg(test)]
    pub(super) fn test_only_verified_workspace_authority() -> VerifiedWorkspaceAuthority {
        verified_workspace_authority(WorkspaceBinding("test-workspace".to_string()))
    }
}

#[cfg(test)]
pub(super) fn test_only_verified_workspace_authority() -> VerifiedWorkspaceAuthority {
    native_lifecycle::test_only_verified_workspace_authority()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn m4_foundation_authority_has_no_renderer_string_constructor() {
        let authority = native_lifecycle::test_only_verified_workspace_authority();
        assert_eq!(authority.service_segment(), "test-workspace");
    }
}

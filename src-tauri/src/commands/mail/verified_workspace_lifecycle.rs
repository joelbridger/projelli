//! Native-only lifecycle state for a workspace selected by the desktop host.

#![allow(dead_code)] // Deliberately dark until the desktop host owns this lifecycle.

use anyhow::{bail, Result};

use super::verified_workspace_authority::{
    mint_from_current_native_workspace, VerifiedWorkspaceAuthority, WorkspaceBinding,
};

/// This state is intentionally not serializable and is never populated from a
/// renderer value, a filesystem path, or an arbitrary account id. The future
/// desktop host owns the one production update point below.
#[derive(Debug)]
pub(super) struct CurrentNativeWorkspaceState {
    native_handle: String,
    generation: u64,
}

#[derive(Debug, Default)]
pub(super) struct NativeWorkspaceLifecycle {
    current: Option<CurrentNativeWorkspaceState>,
}

impl NativeWorkspaceLifecycle {
    /// The desktop host calls this only after it has resolved the active native
    /// workspace. Keeping the state type private prevents ordinary callers from
    /// substituting renderer strings, paths, or copied identifiers.
    fn replace_current_from_native_host(&mut self, current: CurrentNativeWorkspaceState) {
        self.current = Some(current);
    }

    pub(super) fn authority_for_current_workspace(&self) -> Result<VerifiedWorkspaceAuthority> {
        let current = self
            .current
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("no current native workspace"))?;
        if current.native_handle.trim().is_empty() || current.generation == 0 {
            bail!("current native workspace state is invalid")
        }
        Ok(mint_from_current_native_workspace(
            WorkspaceBinding::from_current_native_state(
                current.native_handle.clone(),
                current.generation,
            ),
        ))
    }
}

#[cfg(test)]
pub(crate) fn test_only_current_workspace_authority(
    native_handle: &str,
    generation: u64,
) -> VerifiedWorkspaceAuthority {
    let mut lifecycle = NativeWorkspaceLifecycle::default();
    lifecycle.replace_current_from_native_host(CurrentNativeWorkspaceState {
        native_handle: native_handle.to_string(),
        generation,
    });
    lifecycle.authority_for_current_workspace().unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn m4_shared_foundation_mints_authority_only_from_current_native_state() {
        let lifecycle = NativeWorkspaceLifecycle::default();
        assert!(lifecycle.authority_for_current_workspace().is_err());
        let authority = test_only_current_workspace_authority("native-workspace-a", 7);
        assert_eq!(authority.native_handle(), "native-workspace-a");
        assert_eq!(authority.generation(), 7);
    }
}

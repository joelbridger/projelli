//! Native-only lifecycle state for the current workspace.
//!
//! This module owns both the opaque authority and every production constructor.
//! No mail sibling can manufacture it from a string, path, copied identifier,
//! arbitrary handle, or generation.

#![allow(dead_code)] // Deliberately dark until the desktop host owns this lifecycle.

use anyhow::{bail, Result};

/// A native capability, not an identifier. Its fields are private to this
/// lifecycle implementation; ordinary mail code may only carry/read it.
#[derive(Debug)]
pub(super) struct VerifiedWorkspaceAuthority {
    native_handle: String,
    generation: u64,
}

impl VerifiedWorkspaceAuthority {
    pub(super) fn native_handle(&self) -> &str {
        &self.native_handle
    }

    pub(super) fn generation(&self) -> u64 {
        self.generation
    }

    /// Lets sealed native consumers reject malformed carried authority without
    /// offering any constructor or renderer-derived replacement path.
    pub(super) fn is_well_formed(&self) -> bool {
        !self.native_handle.trim().is_empty() && self.generation != 0
    }
}

/// State held by the native workspace lifecycle, never renderer or path input.
#[derive(Debug)]
struct CurrentNativeWorkspaceState {
    native_handle: String,
    generation: u64,
}

#[derive(Debug, Default)]
pub(super) struct NativeWorkspaceLifecycle {
    current: Option<CurrentNativeWorkspaceState>,
}

impl NativeWorkspaceLifecycle {
    fn authority_for_current_workspace(&self) -> Result<VerifiedWorkspaceAuthority> {
        let current = self
            .current
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("no current native workspace"))?;
        if current.native_handle.trim().is_empty() || current.generation == 0 {
            bail!("current native workspace state is invalid")
        }
        Ok(VerifiedWorkspaceAuthority {
            native_handle: current.native_handle.clone(),
            generation: current.generation,
        })
    }
}

#[cfg(test)]
pub(super) fn test_only_native_workspace_lifecycle(
    native_handle: &str,
    generation: u64,
) -> NativeWorkspaceLifecycle {
    NativeWorkspaceLifecycle {
        current: Some(CurrentNativeWorkspaceState {
            native_handle: native_handle.to_string(),
            generation,
        }),
    }
}

#[cfg(test)]
pub(super) fn load_current_workspace_from_native_owner(
    lifecycle: &NativeWorkspaceLifecycle,
) -> Result<VerifiedWorkspaceAuthority> {
    lifecycle.authority_for_current_workspace()
}

#[cfg(test)]
pub(crate) fn test_only_current_workspace_authority(
    native_handle: &str,
    generation: u64,
) -> VerifiedWorkspaceAuthority {
    let lifecycle = test_only_native_workspace_lifecycle(native_handle, generation);
    load_current_workspace_from_native_owner(&lifecycle).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn m4_shared_foundation_only_native_lifecycle_can_mint_workspace_authority() {
        assert!(NativeWorkspaceLifecycle::default()
            .authority_for_current_workspace()
            .is_err());
        let authority = test_only_current_workspace_authority("native-workspace-a", 7);
        assert_eq!(authority.native_handle(), "native-workspace-a");
        assert_eq!(authority.generation(), 7);
    }
}

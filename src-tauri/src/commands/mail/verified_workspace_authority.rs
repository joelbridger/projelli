//! Opaque authority minted only by the native workspace lifecycle.

#![allow(dead_code)] // Deliberately dark until sealed adapters are connected.

/// A native capability, not an identifier. It has no public constructor,
/// deserializer, string conversion, or path-based conversion.
#[derive(Debug)]
pub(super) struct VerifiedWorkspaceAuthority(WorkspaceBinding);

#[derive(Debug)]
pub(super) struct WorkspaceBinding {
    native_handle: String,
    generation: u64,
}

impl WorkspaceBinding {
    pub(super) fn from_current_native_state(native_handle: String, generation: u64) -> Self {
        Self {
            native_handle,
            generation,
        }
    }
}

impl VerifiedWorkspaceAuthority {
    pub(super) fn native_handle(&self) -> &str {
        &self.0.native_handle
    }

    pub(super) fn generation(&self) -> u64 {
        self.0.generation
    }
}

// The lifecycle module is the only sibling allowed to call this constructor.
pub(super) fn mint_from_current_native_workspace(
    binding: WorkspaceBinding,
) -> VerifiedWorkspaceAuthority {
    VerifiedWorkspaceAuthority(binding)
}

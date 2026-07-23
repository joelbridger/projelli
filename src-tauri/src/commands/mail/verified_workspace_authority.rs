//! Opaque authority carried by the M4 mailbox foundation.
//!
//! The authority is defined in the native workspace lifecycle module so its
//! fields and only constructor remain private to that implementation. Mail
//! siblings can name and read the capability narrowly, but cannot mint it.

pub(super) use super::verified_workspace_lifecycle::VerifiedWorkspaceAuthority;

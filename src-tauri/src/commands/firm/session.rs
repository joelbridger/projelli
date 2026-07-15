//! Native firm-session identity — the trust anchor for CRM own-clients
//! enforcement.
//!
//! The authenticated firm member is established ONLY by the Rust-driven SSO
//! exchange (`firm_sso_authenticate`), which talks directly to the relay over
//! TLS and receives the member's `user_id`/`org_id`/`role`. That identity is
//! held here in process memory that the renderer cannot reach: there is no
//! Tauri command that sets it. The renderer therefore cannot assume another
//! member's identity — the class of bypass that the old renderer-supplied
//! `set_current_member(member_id)` allowed.
//!
//! `member_id` (CRM ownership identity) IS the firm `user_id` (org-scoped).

use std::sync::{Mutex, OnceLock};

/// The authenticated firm member, as proven by the relay during SSO.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FirmIdentity {
    /// The firm `user_id` — this is the CRM `member_id`.
    pub user_id: String,
    /// The org the member belongs to (from the access-token claims).
    pub org_id: String,
    /// True when the relay marked this user an org admin (`role == "admin"`).
    /// Used only as a firm:manage bootstrap for teams-and-roles administration.
    pub org_admin: bool,
}

fn cell() -> &'static Mutex<Option<FirmIdentity>> {
    static SESSION: OnceLock<Mutex<Option<FirmIdentity>>> = OnceLock::new();
    SESSION.get_or_init(|| Mutex::new(None))
}

fn lock() -> std::sync::MutexGuard<'static, Option<FirmIdentity>> {
    cell().lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Establish the authenticated identity. Called ONLY from the native SSO
/// exchange. Never exposed as a Tauri command.
pub fn set_identity(identity: FirmIdentity) {
    *lock() = Some(identity);
}

/// Drop the identity on sign-out. Clearing only ever deny-closes enforcement,
/// so it is safe to expose to the renderer.
pub fn clear_identity() {
    *lock() = None;
}

/// The current authenticated firm identity, or `None` when signed out.
pub fn current_identity() -> Option<FirmIdentity> {
    lock().clone()
}

// The set/clear/current round-trip is exercised by the single global-touching
// test `native_current_member_reads_only_the_firm_session` in the CRM
// permissions module. Keeping exactly one test on this process-global avoids
// cross-test races on shared state.

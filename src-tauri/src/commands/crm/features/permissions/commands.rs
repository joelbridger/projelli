//! Permission-enforced CRM record commands.
//!
//! These commands are the authority boundary for own-clients-only behavior.
//! They never accept a caller/member id as a request argument: the member is
//! loaded from native workspace state. The local-device threat-model boundary
//! is documented in the feature registry SKILL.md.

use anyhow::{bail, Result};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::commands::crm::{
    commands::CrmState, core_store::CrmCoreStore, features::teams_roles::RoleDefinition,
};

const CURRENT_MEMBER_STATE_KIND: &str = "permissions-current-member-state";
const LEGACY_TEAMS_ROLES_STATE_KIND: &str = "teams-roles-state";
const OWN_CLIENTS_FLAG_ENV: &str = "LANTERN_FLAG_OWN_CLIENTS_PERMISSIONS";
const NO_MEMBER_IDENTITY_ERROR: &str = "No member identity configured for own-clients permissions.";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CurrentMember {
    pub member_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PermissionOperation {
    Read,
    Write,
}

/// A native command that returns or mutates client data, and whether it carries
/// an own-clients authority guard. This is the single inventory the interlock
/// (item 4) and the machine-checkable test (item 7) both read: every registered
/// client-returning CRM command must appear here, and enforcement cannot turn on
/// while any entry is unguarded.
pub(crate) struct ClientDoorway {
    pub command: &'static str,
    pub guarded: bool,
}

/// Every doorway that can return or mutate client PII. Keep this exhaustive: the
/// item-7 test fails if a registered client-returning command is missing, and
/// the interlock keeps enforcement OFF if any entry is `guarded: false`.
pub(crate) const CLIENT_DATA_DOORWAYS: &[ClientDoorway] = &[
    ClientDoorway { command: "crm_live_list", guarded: true },
    ClientDoorway { command: "crm_live_upsert", guarded: true },
    ClientDoorway { command: "crm_live_upsert_many", guarded: true },
    ClientDoorway { command: "crm_search", guarded: true },
    // Direct remote-write compatibility commands. These forward a
    // renderer-supplied matter to a remote CRM write helper; each now guards
    // that matter against the member's scope before writing (re-review B
    // Finding 3).
    ClientDoorway { command: "crm_create_note", guarded: true },
    ClientDoorway { command: "crm_create_task", guarded: true },
    ClientDoorway { command: "crm_update_field", guarded: true },
    ClientDoorway { command: "crm_permissions_list", guarded: true },
    ClientDoorway { command: "crm_permissions_get_record", guarded: true },
    ClientDoorway { command: "crm_permissions_upsert", guarded: true },
    ClientDoorway { command: "crm_trash_list", guarded: true },
    ClientDoorway { command: "crm_trash_restore", guarded: true },
    ClientDoorway { command: "crm_trash_soft_delete", guarded: true },
    ClientDoorway { command: "crm_trash_purge", guarded: true },
    ClientDoorway { command: "crm_trash_is_tombstoned", guarded: true },
    ClientDoorway { command: "crm_migration_export", guarded: true },
    ClientDoorway { command: "crm_migration_import", guarded: true },
    ClientDoorway { command: "crm_list_households", guarded: true },
    ClientDoorway { command: "crm_list_write_proposals", guarded: true },
    ClientDoorway { command: "crm_save_write_proposal", guarded: true },
    ClientDoorway { command: "crm_prepare_write_proposal", guarded: true },
    ClientDoorway { command: "crm_delete_write_proposal", guarded: true },
    ClientDoorway { command: "crm_approve_write_proposal", guarded: true },
    ClientDoorway { command: "crm_teams_roles_get", guarded: true },
    ClientDoorway { command: "external_write_list_proposals", guarded: true },
    ClientDoorway { command: "external_write_save_proposal", guarded: true },
    ClientDoorway { command: "external_write_prepare_proposal", guarded: true },
    ClientDoorway { command: "external_write_delete_proposal", guarded: true },
    ClientDoorway { command: "external_write_approve_proposal", guarded: true },
    ClientDoorway { command: "rag_retrieve", guarded: true },
    ClientDoorway { command: "rag_verify_citation", guarded: true },
    ClientDoorway { command: "rag_verify_citations_batch", guarded: true },
];

fn all_doorways_guarded() -> bool {
    CLIENT_DATA_DOORWAYS.iter().all(|doorway| doorway.guarded)
}

/// The interlock, as a pure function so it can be tested with a synthetic
/// unguarded doorway: enforcement is active only when the flag is on AND every
/// doorway is guarded.
fn resolve_enforcement(flag_on: bool, doorways: &[ClientDoorway]) -> bool {
    flag_on && doorways.iter().all(|doorway| doorway.guarded)
}

fn flag_env_on() -> bool {
    matches!(
        std::env::var(OWN_CLIENTS_FLAG_ENV)
            .ok()
            .as_deref()
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("1" | "true" | "on")
    )
}

/// The SINGLE native source of truth for whether own-clients enforcement is
/// active. Interlock (item 4): even with the flag env on, enforcement stays OFF
/// while any registered client-returning doorway is unguarded, so a future flag
/// flip cannot silently reintroduce a leak — the feature is all-doorways-on or
/// honestly off, never partially enforced. The renderer reads this resolved
/// state via `crm_permissions_enforcement_active`, so the UI can never believe
/// protection is on while native has it off (item 6).
pub(crate) fn own_clients_permissions_enabled() -> bool {
    resolve_enforcement(flag_env_on(), CLIENT_DATA_DOORWAYS)
}

async fn workspace(state: &CrmState) -> Result<std::path::PathBuf, String> {
    state.service().workspace().await
}

/// The authenticated CRM member, derived ONLY from the native firm session that
/// the SSO exchange established (`crate::commands::firm::session`). The renderer
/// has no command that can set or overwrite it, so it cannot assume another
/// member's identity. `member_id` IS the firm `user_id` (org-scoped).
///
/// A record the renderer may have written into the CRM store (e.g. a forged
/// `permissions-current-member-state`) has NO bearing here — identity never
/// comes from the store.
pub(crate) fn native_current_member() -> Option<CurrentMember> {
    crate::commands::firm::session::current_identity().map(|identity| CurrentMember {
        member_id: identity.user_id,
    })
}

/// The identity used to authorize firm administration (teams & roles). Carries
/// the org-admin bit from the relay session so the first firm:manage role can be
/// bootstrapped by the org owner.
#[derive(Clone, Debug)]
pub(crate) struct ManageAuthority {
    pub member_id: String,
    pub org_admin: bool,
}

/// The firm-administration authority of the current native session, or `None`
/// when signed out.
pub(crate) fn native_manage_authority() -> Option<ManageAuthority> {
    crate::commands::firm::session::current_identity().map(|identity| ManageAuthority {
        member_id: identity.user_id,
        org_admin: identity.org_admin,
    })
}

/// Refuse a firm-administration mutation (role/team/assignment change) unless
/// the caller holds firm:manage authority. An org admin (per the relay session)
/// always qualifies — the bootstrap that lets the first firm:manage role be
/// assigned; otherwise the caller's CRM role must carry `firm:manage`. This is
/// the interlock that stops an ordinary member self-assigning a privileged role
/// (e.g. compliance) to widen their own client access. Deny-closed when signed
/// out.
pub(crate) fn require_firm_manage_authority(
    store: &CrmCoreStore,
    authority: Option<&ManageAuthority>,
) -> Result<()> {
    let authority = authority.ok_or_else(|| anyhow::anyhow!(NO_MEMBER_IDENTITY_ERROR))?;
    if authority.org_admin {
        return Ok(());
    }
    let role = role_for_member(store, &authority.member_id)?
        .ok_or_else(|| anyhow::anyhow!("Current member has no role assignment."))?;
    if role.capabilities.iter().any(|cap| cap == "firm:manage") {
        return Ok(());
    }
    bail!("Teams & Roles changes require firm-manage authority.");
}

fn role_for_member(store: &CrmCoreStore, member_id: &str) -> Result<Option<RoleDefinition>> {
    store.with_immediate_transaction(|transaction| {
        transaction
            .query_row(
                "SELECT role.role_id,role.name,role.description,role.client_access,role.capabilities_json,role.system
                 FROM crm_member_roles AS member
                 JOIN crm_roles AS role ON role.role_id=member.role_id
                 WHERE member.member_id=?1",
                [member_id],
                |row| {
                    let capabilities_json: String = row.get(4)?;
                    Ok(RoleDefinition {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        description: row.get(2)?,
                        client_access: row.get(3)?,
                        capabilities: serde_json::from_str(&capabilities_json).map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                4,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        })?,
                        system: row.get::<_, i64>(5)? != 0,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    })
}

fn member_id_list(record: &Value) -> Vec<&str> {
    record
        .get("assignedMemberIds")
        .and_then(Value::as_array)
        .map(|values| values.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

fn record_owner_member_id(record: &Value) -> Option<&str> {
    record.get("ownerMemberId").and_then(Value::as_str)
}

fn is_internal_authority_record(record: &Value) -> bool {
    matches!(
        record.get("kind").and_then(Value::as_str),
        Some(CURRENT_MEMBER_STATE_KIND | LEGACY_TEAMS_ROLES_STATE_KIND)
    )
}

fn has_client_capability(role: &RoleDefinition, operation: PermissionOperation) -> bool {
    let needed = match operation {
        PermissionOperation::Read => "clients:read",
        PermissionOperation::Write => "clients:write",
    };
    role.capabilities
        .iter()
        .any(|capability| capability == needed)
}

fn role_permits_record(role: &RoleDefinition, member_id: &str, record: &Value) -> bool {
    match role.client_access.as_str() {
        "firm-read" => true,
        "assigned" => {
            record_owner_member_id(record) == Some(member_id)
                || member_id_list(record).contains(&member_id)
        }
        "shared" => member_id_list(record).contains(&member_id),
        "none" | _ => false,
    }
}

fn current_authority(
    store: &CrmCoreStore,
    current: Option<&CurrentMember>,
    operation: PermissionOperation,
) -> Result<(CurrentMember, RoleDefinition)> {
    let current_member = current
        .cloned()
        .ok_or_else(|| anyhow::anyhow!(NO_MEMBER_IDENTITY_ERROR))?;
    let role = role_for_member(store, &current_member.member_id)?
        .ok_or_else(|| anyhow::anyhow!("Current member has no role assignment."))?;
    if !has_client_capability(&role, operation) {
        bail!(
            "Current member role does not grant CRM {} access.",
            match operation {
                PermissionOperation::Read => "read",
                PermissionOperation::Write => "write",
            }
        );
    }
    Ok((current_member, role))
}

fn authorize(
    store: &CrmCoreStore,
    enforce: bool,
    current: Option<&CurrentMember>,
    operation: PermissionOperation,
    record: &Value,
) -> Result<()> {
    if !enforce {
        return Ok(());
    }
    if is_internal_authority_record(record) {
        bail!("CRM authority state is not available through record commands.");
    }
    let (current_member, role) = current_authority(store, current, operation)?;
    if !role_permits_record(&role, &current_member.member_id, record) {
        bail!("CRM record is outside the current member's client scope.");
    }
    Ok(())
}

pub(crate) fn protected_records(
    store: &CrmCoreStore,
    enforce: bool,
    current: Option<&CurrentMember>,
) -> Result<Vec<Value>> {
    let records = store.list_live_records()?;
    if !enforce {
        return Ok(records);
    }
    let (current_member, role) = current_authority(store, current, PermissionOperation::Read)?;
    records
        .into_iter()
        .filter(|record| !is_internal_authority_record(record))
        .filter(|record| role_permits_record(&role, &current_member.member_id, record))
        .map(Ok)
        .collect()
}

/// Matters that are never grantable to a scoped member through record ownership:
/// the firm buckets hold non-household records (templates, tags, firm docs) plus
/// anything the store defaulted here for a missing `matterId`. Only a firm-wide
/// reader may search across them.
const RESERVED_FIRM_MATTERS: &[&str] = &["firm", "firm_home"];

/// Native matter scoping for search-style commands that read across matters.
///
/// Returns `None` when enforcement is off, meaning "do not scope"; the caller
/// keeps its existing firm-wide behavior. A firm-wide reader also gets `None`,
/// because that role is entitled to every matter. Otherwise this resolves the
/// bound member — deny-closed, so it errors when no member is bound or the role
/// lacks `clients:read` — and returns the matter ids the member may read.
///
/// A matter is entitled through its household: the set is the `matterId` of the
/// household records the member owns or is assigned — the same rule the write
/// guard (`authorize_matter_claim`) enforces. Keying on households, rather than
/// any owned record, means a stray record — e.g. one written before enforcement
/// was enabled — cannot promote a matter the member does not actually hold. The
/// reserved firm buckets are never client matters, so they never enter the set.
/// A `requested` matter outside the set yields an empty list, so a forged matter
/// id returns nothing.
/// The set of matters a member may READ, the one authority every client-data
/// doorway shares (live list/search, trash, migration export, RAG retrieval).
pub(crate) enum MatterReadScope {
    /// Firm-wide: enforcement is off, or the role has firm-read. Every matter.
    All,
    /// Exactly these matters — the member's own or assigned households.
    Only(std::collections::BTreeSet<String>),
}

impl MatterReadScope {
    /// Whether a record in `matter_id` may be returned to this member.
    pub(crate) fn allows(&self, matter_id: &str) -> bool {
        match self {
            MatterReadScope::All => true,
            MatterReadScope::Only(matters) => matters.contains(matter_id),
        }
    }

    /// True only for a firm-wide reader (or enforcement off). Doorways that
    /// expose the WHOLE book (migration export, all-matter RAG) require this.
    pub(crate) fn is_firm_wide(&self) -> bool {
        matches!(self, MatterReadScope::All)
    }
}

/// Resolve the current member's matter read scope. Deny-closed: with enforcement
/// on it errors when no member is bound or the role lacks `clients:read`. A
/// matter is entitled through a household the member owns or is assigned; the
/// reserved firm buckets are never client matters and never enter the set.
pub(crate) fn matter_read_scope(
    store: &CrmCoreStore,
    enforce: bool,
    current: Option<&CurrentMember>,
) -> Result<MatterReadScope> {
    if !enforce {
        return Ok(MatterReadScope::All);
    }
    let (current_member, role) = current_authority(store, current, PermissionOperation::Read)?;
    if role.client_access.as_str() == "firm-read" {
        return Ok(MatterReadScope::All);
    }
    // A matter is in scope only if the member is entitled to EVERY household in
    // it. A matter that also holds a household the member is not entitled to is
    // ambiguous — two differently-owned households sharing one matter — and must
    // deny-close rather than leak the co-located household's PII (item 5). The
    // reserved firm buckets are never client matters.
    let mut entitled = std::collections::BTreeSet::new();
    let mut foreign = std::collections::BTreeSet::new();
    for household in store
        .list_live_records()?
        .iter()
        .filter(|record| record.get("kind").and_then(Value::as_str) == Some("household"))
    {
        let matter = record_matter_id(household).to_owned();
        if RESERVED_FIRM_MATTERS.contains(&matter.as_str()) {
            continue;
        }
        if role_permits_record(&role, &current_member.member_id, household) {
            entitled.insert(matter);
        } else {
            foreign.insert(matter);
        }
    }
    let permitted = entitled.difference(&foreign).cloned().collect();
    Ok(MatterReadScope::Only(permitted))
}

/// Native matter scoping for search-style commands. Delegates to
/// `matter_read_scope`: `None` means "do not scope" (firm-wide reader or off);
/// otherwise the requested matter is intersected with the permitted set, so a
/// forged matter id returns nothing.
pub(crate) fn permitted_search_scopes(
    store: &CrmCoreStore,
    enforce: bool,
    current: Option<&CurrentMember>,
    requested: Option<&str>,
) -> Result<Option<Vec<String>>> {
    match matter_read_scope(store, enforce, current)? {
        MatterReadScope::All => Ok(None),
        MatterReadScope::Only(permitted) => {
            let scopes = match requested.map(str::trim).filter(|scope| !scope.is_empty()) {
                Some(scope) if permitted.contains(scope) => vec![scope.to_owned()],
                Some(_) => Vec::new(),
                None => permitted.into_iter().collect(),
            };
            Ok(Some(scopes))
        }
    }
}

fn get_protected_record(
    store: &CrmCoreStore,
    enforce: bool,
    current: Option<&CurrentMember>,
    record_id: &str,
    operation: PermissionOperation,
) -> Result<Value> {
    let record = store
        .list_live_records()?
        .into_iter()
        .find(|record| record.get("id").and_then(Value::as_str) == Some(record_id))
        .ok_or_else(|| anyhow::anyhow!("CRM record not found."))?;
    authorize(store, enforce, current, operation, &record)?;
    Ok(record)
}

/// Refuse a scoped write whose target matter belongs to another member.
///
/// A matter is claimed by whoever owns or is assigned its household record(s) —
/// the client root that carries `ownerMemberId`/`assignedMemberIds`. A member
/// may write into a matter they already share (they own or are assigned a
/// household in it) or a brand-new matter that has no household yet (onboarding
/// a client). Writing into a matter whose households are all another member's is
/// refused. This is the doorway that makes `matterId`-derived search scope
/// trustworthy: without it, a scoped member could park a record they "own" in a
/// foreign matter and promote that matter into their own search range — and
/// `matterId` is a renderer-supplied field, distinct from a household's `id` for
/// imported clients, so it cannot be trusted on its own. Firm buckets are not
/// client matters and are left to the capability check.
fn record_matter_id(record: &Value) -> &str {
    record
        .get("matterId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("firm")
}

fn authorize_matter_claim(
    store: &CrmCoreStore,
    current: Option<&CurrentMember>,
    record: &Value,
) -> Result<()> {
    let matter = record_matter_id(record);
    if RESERVED_FIRM_MATTERS.contains(&matter) {
        return Ok(());
    }
    let (current_member, role) = current_authority(store, current, PermissionOperation::Write)?;
    // A matter's entitlement is established by its household record(s). Scan the
    // whole matter, not just households: a matter that holds any live record but
    // no household the member owns is either another member's matter or an
    // orphan (e.g. a household soft-deleted without its notes/facts, which have
    // no per-record owner) — either way it is not the caller's to write into.
    // Only a matter with no live records at all is a fresh matter the caller may
    // open by onboarding a new client.
    let mut matter_has_records = false;
    let mut member_owns_household = false;
    for existing in store
        .list_live_records()?
        .iter()
        .filter(|candidate| !is_internal_authority_record(candidate))
        .filter(|candidate| record_matter_id(candidate) == matter)
    {
        matter_has_records = true;
        if existing.get("kind").and_then(Value::as_str) == Some("household")
            && role_permits_record(&role, &current_member.member_id, existing)
        {
            member_owns_household = true;
            break;
        }
    }
    if matter_has_records && !member_owns_household {
        bail!("CRM matter belongs to another member.");
    }
    Ok(())
}

pub(crate) fn authorize_record_save(
    store: &CrmCoreStore,
    enforce: bool,
    current: Option<&CurrentMember>,
    record: &Value,
) -> Result<()> {
    let record_id = record
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("CRM live record requires id"))?
        .to_owned();
    let existing = store
        .list_live_records()?
        .into_iter()
        .find(|existing| existing.get("id").and_then(Value::as_str) == Some(record_id.as_str()));
    if let Some(existing) = existing {
        // Authorize against the stored record before accepting a replacement.
        // Otherwise a forged payload could relabel another member's record as
        // owned by the caller and turn a denied write into a takeover.
        authorize(store, enforce, current, PermissionOperation::Write, &existing)?;
    } else if enforce {
        // New records must already be within the caller's scope. This prevents
        // a caller from creating an inaccessible record for another member.
        authorize(store, true, current, PermissionOperation::Write, record)?;
    }
    if enforce {
        // Guard the record's TARGET matter (its `matterId`), for both new and
        // replaced records, so a member cannot place — or move — a record into a
        // matter another member owns.
        authorize_matter_claim(store, current, record)?;
    }
    Ok(())
}

fn save_protected_record(
    store: &CrmCoreStore,
    enforce: bool,
    current: Option<&CurrentMember>,
    record: Value,
) -> Result<Value> {
    authorize_record_save(store, enforce, current, &record)?;
    store.upsert_live_record(&record)?;
    Ok(record)
}

#[tauri::command]
pub async fn crm_permissions_get_current_member() -> Result<Option<CurrentMember>, String> {
    // Identity is the native firm session — never the renderer, never the store.
    Ok(native_current_member())
}

/// The resolved native enforcement state (item 6): the renderer reads THIS, the
/// single source of truth, rather than assuming from its own flag — so the UI
/// can never show "protected" while native enforcement is actually off (e.g. the
/// interlock disabled it because a doorway is unguarded).
#[tauri::command]
pub async fn crm_permissions_enforcement_active() -> Result<bool, String> {
    Ok(own_clients_permissions_enabled())
}

#[tauri::command]
pub async fn crm_permissions_list(state: State<'_, CrmState>) -> Result<Vec<Value>, String> {
    let workspace = workspace(&state).await?;
    let current = native_current_member();
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        protected_records(&store, own_clients_permissions_enabled(), current.as_ref())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn crm_permissions_get_record(
    state: State<'_, CrmState>,
    record_id: String,
) -> Result<Value, String> {
    let workspace = workspace(&state).await?;
    let current = native_current_member();
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        get_protected_record(
            &store,
            own_clients_permissions_enabled(),
            current.as_ref(),
            &record_id,
            PermissionOperation::Read,
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn crm_permissions_upsert(
    state: State<'_, CrmState>,
    record: Value,
) -> Result<Value, String> {
    let workspace = workspace(&state).await?;
    let current = native_current_member();
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        save_protected_record(
            &store,
            own_clients_permissions_enabled(),
            current.as_ref(),
            record,
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(store: &CrmCoreStore) {
        store
            .with_immediate_transaction(|transaction| {
                transaction.execute(
                    "INSERT INTO crm_member_roles(member_id,role_id,updated_at) VALUES(?1,?2,?3)",
                    ("maya", "advisor", "2026-07-15T00:00:00Z"),
                )?;
                transaction.execute(
                    "INSERT INTO crm_member_roles(member_id,role_id,updated_at) VALUES(?1,?2,?3)",
                    ("casey", "compliance-admin", "2026-07-15T00:00:00Z"),
                )?;
                Ok(())
            })
            .unwrap();
        store
            .upsert_live_record(&serde_json::json!({
                "id": "maya-household", "kind": "household", "matterId": "maya-household",
                "ownerMemberId": "maya", "updatedAt": "2026-07-15T00:00:00Z"
            }))
            .unwrap();
        store
            .upsert_live_record(&serde_json::json!({
                "id": "noah-household", "kind": "household", "matterId": "noah-household",
                "ownerMemberId": "noah", "updatedAt": "2026-07-15T00:00:00Z"
            }))
            .unwrap();
    }

    /// The current member is now an explicit, native-session-derived identity
    /// passed into the authority functions — never read from the store. Tests
    /// construct it directly, standing in for the SSO-bound firm `user_id`.
    fn member(member_id: &str) -> CurrentMember {
        CurrentMember {
            member_id: member_id.to_string(),
        }
    }

    /// A record the renderer could write into the store to try to declare an
    /// identity. Under the identity-binding fix it must have no effect.
    fn write_forged_current_member_record(store: &CrmCoreStore, member_id: &str) {
        store
            .upsert_live_record(&serde_json::json!({
                "id": "firm:current-member", "kind": CURRENT_MEMBER_STATE_KIND,
                "matterId": "firm", "memberId": member_id, "updatedAt": "2026-07-15T00:00:00Z"
            }))
            .unwrap();
    }

    fn insert_legacy_teams_roles_record(store: &CrmCoreStore) {
        let record = serde_json::json!({
            "id": "firm-teams-roles", "kind": LEGACY_TEAMS_ROLES_STATE_KIND,
            "matterId": "firm", "memberships": [{"memberId": "maya", "roleId": "advisor"}],
            "updatedAt": "2026-07-14T00:00:00Z"
        });
        let encoded = serde_json::to_vec(&record).unwrap();
        store
            .with_immediate_transaction(|transaction| {
                transaction.execute(
                    "INSERT INTO crm_docs(doc_key,matter_id,doc_id,yjs_state,state_vector,updated_at,deleted)
                     VALUES(?1,?2,?3,?4,?5,?6,0)",
                    rusqlite::params![
                        "firm/live:firm-teams-roles",
                        "firm",
                        "live:firm-teams-roles",
                        encoded,
                        Vec::<u8>::new(),
                        "2026-07-14T00:00:00Z"
                    ],
                )?;
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn flag_on_without_a_bound_member_refuses_protected_calls() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[17; 32]).unwrap();
        seed(&store);
        assert_eq!(
            get_protected_record(&store, true, None, "maya-household", PermissionOperation::Read)
                .unwrap_err()
                .to_string(),
            NO_MEMBER_IDENTITY_ERROR
        );
        assert_eq!(
            protected_records(&store, true, None).unwrap_err().to_string(),
            NO_MEMBER_IDENTITY_ERROR
        );
    }

    #[test]
    fn flag_on_filters_to_the_bound_members_owned_or_assigned_households() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[18; 32]).unwrap();
        seed(&store);
        let maya = member("maya");
        assert_eq!(
            protected_records(&store, true, Some(&maya))
                .unwrap()
                .into_iter()
                .map(|record| record["id"].as_str().unwrap().to_owned())
                .collect::<Vec<_>>(),
            vec!["maya-household"]
        );
    }

    #[test]
    fn flag_on_refuses_a_native_cross_owner_read_and_write() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[19; 32]).unwrap();
        seed(&store);
        let maya = member("maya");
        assert!(
            get_protected_record(&store, true, Some(&maya), "noah-household", PermissionOperation::Read)
                .unwrap_err()
                .to_string()
                .contains("outside the current member's client scope")
        );
        assert!(save_protected_record(&store, true, Some(&maya), serde_json::json!({
            "id": "noah-household", "kind": "household", "matterId": "noah-household", "ownerMemberId": "noah"
        })).unwrap_err().to_string().contains("outside the current member's client scope"));
    }

    #[test]
    fn firm_wide_reader_lists_all_clients_but_cannot_write_without_capability() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[20; 32]).unwrap();
        seed(&store);
        let casey = member("casey");
        assert_eq!(protected_records(&store, true, Some(&casey)).unwrap().len(), 2);
        assert!(
            get_protected_record(&store, true, Some(&casey), "maya-household", PermissionOperation::Write)
                .unwrap_err()
                .to_string()
                .contains("does not grant CRM write access")
        );
    }

    #[test]
    fn flag_on_keeps_legacy_authority_state_out_of_record_reads() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[22; 32]).unwrap();
        seed(&store);
        insert_legacy_teams_roles_record(&store);
        let casey = member("casey");

        assert_eq!(protected_records(&store, true, Some(&casey)).unwrap().len(), 2);
        assert!(
            get_protected_record(&store, true, Some(&casey), "firm-teams-roles", PermissionOperation::Read)
                .unwrap_err()
                .to_string()
                .contains("authority state")
        );
    }

    #[test]
    fn flag_off_preserves_unfiltered_legacy_behavior() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[21; 32]).unwrap();
        seed(&store);
        assert_eq!(protected_records(&store, false, None).unwrap().len(), 2);
    }

    #[test]
    fn identity_never_comes_from_a_renderer_written_store_record() {
        // The decisive item-1 property: a forged current-member record in the
        // store (the shape the old renderer setter wrote) does NOT determine who
        // the current member is. Enforcement uses ONLY the identity passed in
        // from the native firm session. Here the store claims "casey"
        // (firm-wide), but the bound identity is maya (assigned) — and maya's
        // scope is enforced, so the forged record has no effect.
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[30; 32]).unwrap();
        seed(&store);
        write_forged_current_member_record(&store, "casey");
        let maya = member("maya");
        assert_eq!(
            protected_records(&store, true, Some(&maya))
                .unwrap()
                .into_iter()
                .map(|record| record["id"].as_str().unwrap().to_owned())
                .collect::<Vec<_>>(),
            vec!["maya-household"],
            "a forged current-member store record must not widen scope to casey's firm-wide view"
        );
    }

    fn manage(member_id: &str, org_admin: bool) -> ManageAuthority {
        ManageAuthority {
            member_id: member_id.to_string(),
            org_admin,
        }
    }

    #[test]
    fn firm_manage_authority_gates_role_administration() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[31; 32]).unwrap();
        seed(&store); // maya -> advisor (no firm:manage), casey -> compliance-admin

        // An ordinary member cannot administer roles — the self-assign bypass.
        let maya = manage("maya", false);
        assert!(require_firm_manage_authority(&store, Some(&maya))
            .unwrap_err()
            .to_string()
            .contains("firm-manage authority"));

        // A compliance-admin (role carries firm:manage) may.
        let casey = manage("casey", false);
        assert!(require_firm_manage_authority(&store, Some(&casey)).is_ok());

        // The org admin may, even before any CRM role is assigned (bootstrap).
        let owner = manage("brand-new-owner", true);
        assert!(require_firm_manage_authority(&store, Some(&owner)).is_ok());

        // Deny-closed when signed out.
        assert!(require_firm_manage_authority(&store, None)
            .unwrap_err()
            .to_string()
            .contains(NO_MEMBER_IDENTITY_ERROR));
    }

    #[test]
    fn native_current_member_reads_only_the_firm_session() {
        // The ONLY test that touches the process-global firm session, so it
        // cannot race another test. Proves current_member comes from the
        // SSO-established session and nowhere else.
        use crate::commands::firm::session::{clear_identity, set_identity, FirmIdentity};
        clear_identity();
        assert_eq!(native_current_member(), None, "signed out is deny-closed");
        set_identity(FirmIdentity {
            user_id: "user-maya".into(),
            org_id: "org-1".into(),
            org_admin: false,
        });
        assert_eq!(native_current_member().unwrap().member_id, "user-maya");
        clear_identity();
        assert_eq!(native_current_member(), None);
    }

    /// Imported clients (Wealthbox/Salesforce/Redtail) give a household an `id`
    /// distinct from its `matterId`, and several households can share one matter.
    /// The scope + write-claim logic must key on household ownership, never on
    /// `id == matterId`, so these fixtures deliberately use distinct ids.
    fn seed_imported(store: &CrmCoreStore) {
        store
            .with_immediate_transaction(|transaction| {
                transaction.execute(
                    "INSERT INTO crm_member_roles(member_id,role_id,updated_at) VALUES(?1,?2,?3)",
                    ("maya", "advisor", "2026-07-15T00:00:00Z"),
                )?;
                transaction.execute(
                    "INSERT INTO crm_member_roles(member_id,role_id,updated_at) VALUES(?1,?2,?3)",
                    ("casey", "compliance-admin", "2026-07-15T00:00:00Z"),
                )?;
                Ok(())
            })
            .unwrap();
        store
            .upsert_live_record(&serde_json::json!({
                "id": "household:maya", "kind": "household", "matterId": "matter:maya",
                "ownerMemberId": "maya", "name": "Galleon Family",
                "updatedAt": "2026-07-15T00:00:00Z"
            }))
            .unwrap();
        store
            .upsert_live_record(&serde_json::json!({
                "id": "household:noah", "kind": "household", "matterId": "matter:noah",
                "ownerMemberId": "noah", "name": "Zephyr Family",
                "updatedAt": "2026-07-15T00:00:00Z"
            }))
            .unwrap();
    }

    #[test]
    fn search_scope_covers_owned_matters_including_imported_ids() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[23; 32]).unwrap();
        seed_imported(&store);
        let maya = member("maya");
        // Maya's own imported client (id != matterId) is searchable; noah's is not.
        assert_eq!(
            permitted_search_scopes(&store, true, Some(&maya), None).unwrap(),
            Some(vec!["matter:maya".to_string()])
        );
    }

    #[test]
    fn write_refuses_parking_a_record_in_another_members_matter() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[24; 32]).unwrap();
        seed_imported(&store);
        let maya = member("maya");
        // The Finding-1 bypass for imported clients: no live record has id
        // "matter:noah", so the id-existence check cannot catch it — the matter
        // claim guard must. Maya may "own" the payload, but the matter is noah's.
        let injected = serde_json::json!({
            "id": "matter:noah", "kind": "note", "matterId": "matter:noah",
            "ownerMemberId": "maya", "body": "x", "updatedAt": "2026-07-15T00:00:00Z"
        });
        assert!(authorize_record_save(&store, true, Some(&maya), &injected)
            .unwrap_err()
            .to_string()
            .contains("belongs to another member"));
        // A fresh child id in noah's matter is refused too.
        let child = serde_json::json!({
            "id": "note:probe", "kind": "note", "matterId": "matter:noah",
            "ownerMemberId": "maya", "body": "x", "updatedAt": "2026-07-15T00:00:00Z"
        });
        assert!(authorize_record_save(&store, true, Some(&maya), &child).is_err());
        // And a forged household claiming noah's matter is refused.
        let forged_household = serde_json::json!({
            "id": "household:fake", "kind": "household", "matterId": "matter:noah",
            "ownerMemberId": "maya", "updatedAt": "2026-07-15T00:00:00Z"
        });
        assert!(authorize_record_save(&store, true, Some(&maya), &forged_household).is_err());
    }

    #[test]
    fn write_allows_onboarding_a_new_matter_and_writing_own_matter() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[25; 32]).unwrap();
        seed_imported(&store);
        let maya = member("maya");
        // Onboarding a brand-new client: a household in a matter with none yet.
        let new_household = serde_json::json!({
            "id": "household:new", "kind": "household", "matterId": "matter:new",
            "ownerMemberId": "maya", "updatedAt": "2026-07-15T00:00:00Z"
        });
        assert!(authorize_record_save(&store, true, Some(&maya), &new_household).is_ok());
        // A record inside maya's own matter is allowed.
        let own_note = serde_json::json!({
            "id": "note:1", "kind": "note", "matterId": "matter:maya",
            "ownerMemberId": "maya", "body": "x", "updatedAt": "2026-07-15T00:00:00Z"
        });
        assert!(authorize_record_save(&store, true, Some(&maya), &own_note).is_ok());
    }

    #[test]
    fn write_refuses_claiming_an_orphan_matter() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[29; 32]).unwrap();
        // maya's role only; matter:noah holds a surviving PII note but NO live
        // household — the state left when a household is soft-deleted (no cascade)
        // while its notes/facts remain, or a partial import.
        store
            .with_immediate_transaction(|transaction| {
                transaction.execute(
                    "INSERT INTO crm_member_roles(member_id,role_id,updated_at) VALUES(?1,?2,?3)",
                    ("maya", "advisor", "2026-07-15T00:00:00Z"),
                )?;
                Ok(())
            })
            .unwrap();
        store
            .upsert_live_record(&serde_json::json!({
                "id": "note:noah-secret", "kind": "note", "matterId": "matter:noah",
                "body": "Zephyr trust details", "updatedAt": "2026-07-15T00:00:00Z"
            }))
            .unwrap();
        let maya = member("maya");
        // Maya cannot park a record into the orphan matter to promote it.
        let claim = serde_json::json!({
            "id": "note:probe", "kind": "note", "matterId": "matter:noah",
            "ownerMemberId": "maya", "body": "x", "updatedAt": "2026-07-15T00:00:00Z"
        });
        assert!(authorize_record_save(&store, true, Some(&maya), &claim)
            .unwrap_err()
            .to_string()
            .contains("belongs to another member"));
        // And the orphan matter is not in her search scope to begin with.
        assert_eq!(
            permitted_search_scopes(&store, true, Some(&maya), None).unwrap(),
            Some(Vec::new())
        );
    }

    #[test]
    fn search_scope_never_grants_a_reserved_firm_bucket() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[26; 32]).unwrap();
        seed_imported(&store);
        let maya = member("maya");
        // A firm-bucket record maya owns must not enter her client search scope,
        // and the write guard leaves the firm bucket to the capability check.
        store
            .upsert_live_record(&serde_json::json!({
                "id": "firm", "kind": "note", "matterId": "firm",
                "ownerMemberId": "maya", "body": "x", "updatedAt": "2026-07-15T00:00:00Z"
            }))
            .unwrap();
        assert_eq!(
            permitted_search_scopes(&store, true, Some(&maya), None).unwrap(),
            Some(vec!["matter:maya".to_string()])
        );
    }

    #[test]
    fn search_scope_is_unrestricted_for_a_firm_wide_reader() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[27; 32]).unwrap();
        seed_imported(&store);
        let casey = member("casey"); // compliance-admin: firm-read
        assert_eq!(
            permitted_search_scopes(&store, true, Some(&casey), None).unwrap(),
            None
        );
    }

    #[test]
    fn search_scope_is_deny_closed_without_a_bound_member() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[28; 32]).unwrap();
        seed_imported(&store);
        assert!(permitted_search_scopes(&store, true, None, None).is_err());
    }

    #[test]
    fn multi_owner_matter_denies_closed() {
        // Item 5: two differently-owned households sharing one matterId must not
        // leak each other's PII. The shared matter is ambiguous, so it drops out
        // of BOTH members' read scope entirely.
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[32; 32]).unwrap();
        store
            .with_immediate_transaction(|transaction| {
                transaction.execute(
                    "INSERT INTO crm_member_roles(member_id,role_id,updated_at) VALUES(?1,?2,?3)",
                    ("maya", "advisor", "2026-07-15T00:00:00Z"),
                )?;
                Ok(())
            })
            .unwrap();
        store
            .upsert_live_record(&serde_json::json!({
                "id": "household:maya", "kind": "household", "matterId": "matter:shared",
                "ownerMemberId": "maya", "updatedAt": "2026-07-15T00:00:00Z"
            }))
            .unwrap();
        store
            .upsert_live_record(&serde_json::json!({
                "id": "household:noah", "kind": "household", "matterId": "matter:shared",
                "ownerMemberId": "noah", "updatedAt": "2026-07-15T00:00:00Z"
            }))
            .unwrap();
        let maya = member("maya");
        let scope = matter_read_scope(&store, true, Some(&maya)).unwrap();
        assert!(
            !scope.allows("matter:shared"),
            "an ambiguous multi-owner matter must deny-close, not leak"
        );
        // And it is absent from the concrete search scope set.
        assert_eq!(
            permitted_search_scopes(&store, true, Some(&maya), None).unwrap(),
            Some(Vec::new())
        );
    }

    #[test]
    fn interlock_keeps_enforcement_off_when_a_doorway_is_unguarded() {
        // Item 4: a future flag flip cannot silently reintroduce a leak. Even
        // with the flag on, one unguarded doorway keeps enforcement OFF.
        let all_guarded = &[ClientDoorway { command: "a", guarded: true }];
        let one_unguarded = &[
            ClientDoorway { command: "a", guarded: true },
            ClientDoorway { command: "b", guarded: false },
        ];
        assert!(resolve_enforcement(true, all_guarded));
        assert!(
            !resolve_enforcement(true, one_unguarded),
            "an unguarded doorway must keep enforcement OFF"
        );
        assert!(!resolve_enforcement(false, all_guarded), "flag off is off");
        // And the shipped registry is fully guarded (so the flag can enable).
        assert!(all_doorways_guarded());
    }

    #[test]
    fn every_client_doorway_is_registered_and_invokes_native_authority() {
        // Item 7: machine-checkable — each client-returning command in the
        // registry (1) is a real registered native command and (2) its source
        // function actually invokes a native authorization symbol. A doorway
        // marked guarded but calling no guard, or missing from the manifests,
        // fails here.
        use std::fs;
        use std::path::{Path, PathBuf};

        // A guarded doorway's function body must reference one of these.
        const GUARD_SYMBOLS: &[&str] = &[
            "matter_read_scope",
            "protected_records",
            "permitted_search_scopes",
            "authorize_record_save",
            "save_protected_record",
            "get_protected_record",
            "require_firm_manage_authority",
            "require_proposal_matter_in_scope",
            "require_external_matter_in_scope",
            "native_current_member",
        ];
        // Low-level client-data access primitives. ANY command whose body calls
        // one directly returns/mutates client PII and MUST be a registered
        // doorway — this is the exhaustiveness half of the check, so a new
        // client-returning command cannot be added without registration.
        const CLIENT_DATA_PRIMITIVES: &[&str] = &[
            "list_live_records",
            "search_fts",
            "list_trashed_records",
            "proposal_list_pending",
            "proposal_get",
            "proposal_upsert",
            "proposal_delete",
            "soft_delete_record",
            "permanently_purge_record",
            "restore_record",
            "is_tombstoned_record",
            // RAG store client-data reads. Without these the exhaustiveness half
            // could not see the citation-verification doorways, which is exactly
            // how `rag_verify_citations_batch` slipped through unregistered
            // (re-review A Findings 1-2 / re-review B Finding 5). `lookup_by_id`
            // (single verify), `fetch_records_by_ids` (batch verify), and
            // `fetch_by_ids_scoped` (retrieval id-fetch) are specific symbols; the
            // semantic-search primitive `store::nearest` is deliberately NOT
            // listed because the bare token `nearest` also appears in connector
            // engines/tests and would misattribute — that path is covered by
            // `rag_retrieve`'s registration.
            "lookup_by_id",
            "fetch_records_by_ids",
            "fetch_by_ids_scoped",
            // Direct remote-write helpers the compatibility commands forward to.
            // Any command whose body reaches one of these mutates a remote client
            // record and must be a registered, guarded doorway (re-review B
            // Findings 3 & 5).
            "crm_create_write",
            "crm_update_field_from_proposal",
        ];

        fn walk(dir: &Path, manifests: &mut Vec<String>, sources: &mut Vec<(PathBuf, String)>) {
            for entry in fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    walk(&path, manifests, sources);
                } else if path.file_name().and_then(|n| n.to_str()) == Some("command-manifest.txt") {
                    for line in fs::read_to_string(&path).unwrap().lines() {
                        if let Some(rest) = line.trim().strip_prefix("command ") {
                            if let Some(fq) = rest.split_whitespace().nth(1) {
                                if let Some(name) = fq.rsplit("::").next() {
                                    manifests.push(name.to_string());
                                }
                            }
                        }
                    }
                } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
                    sources.push((path.clone(), fs::read_to_string(&path).unwrap()));
                }
            }
        }

        // The body of a command function, bounded at the next top-level fn so a
        // primitive in a neighbouring function is not misattributed.
        fn command_body<'a>(sources: &'a [(PathBuf, String)], name: &str) -> Option<&'a str> {
            let declaration = format!("fn {name}(");
            let text = sources
                .iter()
                .find(|(_, text)| text.contains(&declaration))
                .map(|(_, text)| text.as_str())?;
            let start = text.find(&declaration)?;
            let rest = &text[start + declaration.len()..];
            let end = rest
                .find("\npub async fn ")
                .into_iter()
                .chain(rest.find("\npub fn "))
                .chain(rest.find("\nasync fn "))
                .min()
                .unwrap_or(rest.len());
            Some(&rest[..end])
        }

        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut manifest_commands = Vec::new();
        let mut sources = Vec::new();
        walk(&src, &mut manifest_commands, &mut sources);

        // Part A — every registered doorway is a real command that invokes a
        // native authority symbol.
        for doorway in CLIENT_DATA_DOORWAYS {
            assert!(
                manifest_commands.iter().any(|name| name == doorway.command),
                "doorway {} is not a registered native command",
                doorway.command
            );
            if !doorway.guarded {
                continue;
            }
            let body = command_body(&sources, doorway.command)
                .unwrap_or_else(|| panic!("no source declares {}", doorway.command));
            assert!(
                GUARD_SYMBOLS.iter().any(|symbol| body.contains(symbol)),
                "doorway {} is marked guarded but its function invokes no native authority symbol",
                doorway.command
            );
        }

        // Part B — exhaustiveness: every registered command whose body calls a
        // client-data primitive directly is registered as a doorway. A new
        // client-returning command added without registration fails here, so the
        // interlock's inventory cannot silently miss a leak.
        let registered: std::collections::BTreeSet<&str> =
            CLIENT_DATA_DOORWAYS.iter().map(|d| d.command).collect();
        for command in &manifest_commands {
            let Some(body) = command_body(&sources, command) else {
                continue;
            };
            if CLIENT_DATA_PRIMITIVES
                .iter()
                .any(|primitive| body.contains(primitive))
                && !registered.contains(command.as_str())
            {
                panic!(
                    "command {command} reads/mutates client data (calls a client-data primitive) \
                     but is not in CLIENT_DATA_DOORWAYS — register + guard it",
                );
            }
        }
    }

    #[test]
    fn matter_read_scope_is_firm_wide_for_reader_and_off() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[33; 32]).unwrap();
        seed_imported(&store);
        // Flag off → firm-wide (no scoping).
        assert!(matter_read_scope(&store, false, None).unwrap().is_firm_wide());
        // Firm-read role → firm-wide.
        let casey = member("casey");
        assert!(matter_read_scope(&store, true, Some(&casey))
            .unwrap()
            .is_firm_wide());
        // Scoped member → only their matter, not firm-wide.
        let maya = member("maya");
        let scope = matter_read_scope(&store, true, Some(&maya)).unwrap();
        assert!(!scope.is_firm_wide());
        assert!(scope.allows("matter:maya"));
        assert!(!scope.allows("matter:noah"));
    }
}

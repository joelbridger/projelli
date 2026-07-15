//! Permission-enforced CRM record commands.
//!
//! These commands are the authority boundary for own-clients-only behavior.
//! They never accept a caller/member id as a request argument: the member is
//! loaded from native workspace state. The local-device threat-model boundary
//! is documented in the feature registry SKILL.md.

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::commands::crm::{
    commands::CrmState,
    core_store::CrmCoreStore,
    features::teams_roles::{MemberAssignment, RoleDefinition, TeamsRolesState},
};

const CURRENT_MEMBER_STATE_ID: &str = "firm:current-member";
const CURRENT_MEMBER_STATE_KIND: &str = "permissions-current-member-state";
const TEAMS_ROLES_STATE_ID: &str = "firm:teams-roles";
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

fn flag_enabled_from_environment() -> bool {
    matches!(
        std::env::var(OWN_CLIENTS_FLAG_ENV)
            .ok()
            .as_deref()
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("1" | "true" | "on")
    )
}

async fn workspace(state: &CrmState) -> Result<std::path::PathBuf, String> {
    state.service().workspace().await
}

fn find_state_record(store: &CrmCoreStore, id: &str) -> Result<Option<Value>> {
    Ok(store
        .list_live_records()?
        .into_iter()
        .find(|record| record.get("id").and_then(Value::as_str) == Some(id)))
}

fn load_current_member(store: &CrmCoreStore) -> Result<Option<CurrentMember>> {
    find_state_record(store, CURRENT_MEMBER_STATE_ID)
        .map(|record| record.and_then(|value| serde_json::from_value(value).ok()))
}

fn load_teams_roles(store: &CrmCoreStore) -> Result<Option<TeamsRolesState>> {
    find_state_record(store, TEAMS_ROLES_STATE_ID)
        .map(|record| record.and_then(|value| serde_json::from_value(value).ok()))
}

fn role_for_member<'a>(state: &'a TeamsRolesState, member_id: &str) -> Option<&'a RoleDefinition> {
    let membership = state
        .memberships
        .iter()
        .find(|assignment| assignment.member_id == member_id)?;
    state
        .roles
        .iter()
        .find(|role| role.id == membership.role_id)
}

fn member_is_configurable(state: &TeamsRolesState, member_id: &str) -> bool {
    state
        .memberships
        .iter()
        .any(|assignment: &MemberAssignment| assignment.member_id == member_id)
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
    operation: PermissionOperation,
) -> Result<(CurrentMember, RoleDefinition)> {
    let current_member =
        load_current_member(store)?.ok_or_else(|| anyhow::anyhow!(NO_MEMBER_IDENTITY_ERROR))?;
    let teams_roles = load_teams_roles(store)?
        .ok_or_else(|| anyhow::anyhow!("No teams-and-roles state is configured."))?;
    let role = role_for_member(&teams_roles, &current_member.member_id)
        .ok_or_else(|| anyhow::anyhow!("Current member has no role assignment."))?
        .clone();
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
    operation: PermissionOperation,
    record: &Value,
) -> Result<()> {
    if !enforce {
        return Ok(());
    }
    let (current_member, role) = current_authority(store, operation)?;
    if !role_permits_record(&role, &current_member.member_id, record) {
        bail!("CRM record is outside the current member's client scope.");
    }
    Ok(())
}

fn protected_records(store: &CrmCoreStore, enforce: bool) -> Result<Vec<Value>> {
    let records = store.list_live_records()?;
    if !enforce {
        return Ok(records);
    }
    let (current_member, role) = current_authority(store, PermissionOperation::Read)?;
    records
        .into_iter()
        .filter(|record| {
            !matches!(
                record.get("kind").and_then(Value::as_str),
                Some(CURRENT_MEMBER_STATE_KIND) | Some("teams-roles-state")
            )
        })
        .filter(|record| role_permits_record(&role, &current_member.member_id, record))
        .map(Ok)
        .collect()
}

fn get_protected_record(
    store: &CrmCoreStore,
    enforce: bool,
    record_id: &str,
    operation: PermissionOperation,
) -> Result<Value> {
    let record = store
        .list_live_records()?
        .into_iter()
        .find(|record| record.get("id").and_then(Value::as_str) == Some(record_id))
        .ok_or_else(|| anyhow::anyhow!("CRM record not found."))?;
    authorize(store, enforce, operation, &record)?;
    Ok(record)
}

fn save_protected_record(store: &CrmCoreStore, enforce: bool, record: Value) -> Result<Value> {
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
        authorize(store, enforce, PermissionOperation::Write, &existing)?;
    } else if enforce {
        // New records must already be within the caller's scope. This prevents
        // a caller from creating an inaccessible record for another member.
        authorize(store, true, PermissionOperation::Write, &record)?;
    }
    store.upsert_live_record(&record)?;
    Ok(record)
}

#[tauri::command]
pub async fn crm_permissions_get_current_member(
    state: State<'_, CrmState>,
) -> Result<Option<CurrentMember>, String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        load_current_member(&store)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn crm_permissions_set_current_member(
    state: State<'_, CrmState>,
    member_id: String,
) -> Result<CurrentMember, String> {
    if member_id.trim().is_empty() {
        return Err("Member id is required.".into());
    }
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        let teams_roles = load_teams_roles(&store)?
            .ok_or_else(|| anyhow::anyhow!("No teams-and-roles state is configured."))?;
        if !member_is_configurable(&teams_roles, &member_id) {
            bail!("Member does not have a teams-and-roles assignment.");
        }
        let current_member = CurrentMember { member_id };
        store.upsert_live_record(&serde_json::json!({
            "id": CURRENT_MEMBER_STATE_ID,
            "kind": CURRENT_MEMBER_STATE_KIND,
            "matterId": "firm",
            "memberId": current_member.member_id,
            "updatedAt": chrono::Utc::now().to_rfc3339(),
        }))?;
        Ok(current_member)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn crm_permissions_list(state: State<'_, CrmState>) -> Result<Vec<Value>, String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        protected_records(&store, flag_enabled_from_environment())
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
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        get_protected_record(
            &store,
            flag_enabled_from_environment(),
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
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        save_protected_record(&store, flag_enabled_from_environment(), record)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn teams_roles_state() -> TeamsRolesState {
        serde_json::from_value(serde_json::json!({
            "roles": [
                {"id":"advisor","name":"Advisor","description":"","clientAccess":"assigned","capabilities":["clients:read","clients:write"],"system":true},
                {"id":"compliance","name":"Compliance","description":"","clientAccess":"firm-read","capabilities":["clients:read"],"system":true}
            ],
            "teams": [],
            "memberships": [
                {"memberId":"maya","roleId":"advisor","teamIds":[]},
                {"memberId":"casey","roleId":"compliance","teamIds":[]}
            ],
            "updatedAt":"2026-07-15T00:00:00Z"
        })).unwrap()
    }

    fn seed(store: &CrmCoreStore) {
        let state = teams_roles_state();
        store
            .upsert_live_record(&serde_json::json!({
                "id": TEAMS_ROLES_STATE_ID,
                "kind": "teams-roles-state",
                "matterId": "firm",
                "roles": state.roles,
                "teams": state.teams,
                "memberships": state.memberships,
                "updatedAt": state.updated_at,
            }))
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

    fn bind(store: &CrmCoreStore, member_id: &str) {
        store
            .upsert_live_record(&serde_json::json!({
                "id": CURRENT_MEMBER_STATE_ID, "kind": CURRENT_MEMBER_STATE_KIND,
                "matterId": "firm", "memberId": member_id, "updatedAt": "2026-07-15T00:00:00Z"
            }))
            .unwrap();
    }

    #[test]
    fn flag_on_without_a_bound_member_refuses_protected_calls() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[17; 32]).unwrap();
        seed(&store);
        assert_eq!(
            get_protected_record(&store, true, "maya-household", PermissionOperation::Read)
                .unwrap_err()
                .to_string(),
            NO_MEMBER_IDENTITY_ERROR
        );
        assert_eq!(
            protected_records(&store, true).unwrap_err().to_string(),
            NO_MEMBER_IDENTITY_ERROR
        );
    }

    #[test]
    fn flag_on_filters_to_the_bound_members_owned_or_assigned_households() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[18; 32]).unwrap();
        seed(&store);
        bind(&store, "maya");
        assert_eq!(
            protected_records(&store, true)
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
        bind(&store, "maya");
        assert!(
            get_protected_record(&store, true, "noah-household", PermissionOperation::Read)
                .unwrap_err()
                .to_string()
                .contains("outside the current member's client scope")
        );
        assert!(save_protected_record(&store, true, serde_json::json!({
            "id": "noah-household", "kind": "household", "matterId": "noah-household", "ownerMemberId": "noah"
        })).unwrap_err().to_string().contains("outside the current member's client scope"));
    }

    #[test]
    fn firm_wide_reader_lists_all_clients_but_cannot_write_without_capability() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[20; 32]).unwrap();
        seed(&store);
        bind(&store, "casey");
        assert_eq!(protected_records(&store, true).unwrap().len(), 2);
        assert!(
            get_protected_record(&store, true, "maya-household", PermissionOperation::Write)
                .unwrap_err()
                .to_string()
                .contains("does not grant CRM write access")
        );
    }

    #[test]
    fn flag_off_preserves_unfiltered_legacy_behavior() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[21; 32]).unwrap();
        seed(&store);
        assert_eq!(protected_records(&store, false).unwrap().len(), 3);
    }
}

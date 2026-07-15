//! SQLCipher-backed, all-or-nothing teams-and-roles operations.
//!
//! Each mutation reads and writes one firm-scoped aggregate document through
//! `CrmCoreStore`; its document replacement is atomic, so a role/team/member
//! change never leaves a half-written membership visible to the renderer.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::crm::{commands::CrmState, core_store::CrmCoreStore};

const STATE_ID: &str = "firm:teams-roles";
const STATE_KIND: &str = "teams-roles-state";
const CAPABILITIES: &[&str] = &[
    "clients:read",
    "clients:write",
    "ask:use",
    "meetings:read",
    "meetings:write",
    "tasks:manage",
    "workflows:manage",
    "reports:read",
    "exports:run",
    "audit:read",
    "retention:manage",
    "firm:manage",
];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoleDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub client_access: String,
    pub capabilities: Vec<String>,
    pub system: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeamDefinition {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemberAssignment {
    pub member_id: String,
    pub role_id: String,
    pub team_ids: Vec<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeamsRolesState {
    pub roles: Vec<RoleDefinition>,
    pub teams: Vec<TeamDefinition>,
    pub memberships: Vec<MemberAssignment>,
    pub updated_at: String,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
fn system_roles() -> Vec<RoleDefinition> {
    vec![
        RoleDefinition {
            id: "advisor".into(),
            name: "Advisors".into(),
            description: "Assigned clients, Ask, meetings, and reports.".into(),
            client_access: "assigned".into(),
            capabilities: vec![
                "clients:read".into(),
                "clients:write".into(),
                "ask:use".into(),
                "meetings:read".into(),
                "meetings:write".into(),
                "reports:read".into(),
            ],
            system: true,
        },
        RoleDefinition {
            id: "client-service".into(),
            name: "Client service".into(),
            description: "Assigned households, tasks, workflows, and meetings.".into(),
            client_access: "assigned".into(),
            capabilities: vec![
                "clients:read".into(),
                "clients:write".into(),
                "tasks:manage".into(),
                "workflows:manage".into(),
                "meetings:read".into(),
                "meetings:write".into(),
            ],
            system: true,
        },
        RoleDefinition {
            id: "compliance-admin".into(),
            name: "Compliance admin".into(),
            description: "Firm-wide read access, exports, retention, and audit.".into(),
            client_access: "firm-read".into(),
            capabilities: vec![
                "clients:read".into(),
                "reports:read".into(),
                "exports:run".into(),
                "audit:read".into(),
                "retention:manage".into(),
                "firm:manage".into(),
            ],
            system: true,
        },
        RoleDefinition {
            id: "guest-planner".into(),
            name: "Guest planner".into(),
            description: "Only households shared directly with this planner. No exports.".into(),
            client_access: "shared".into(),
            capabilities: vec![
                "clients:read".into(),
                "ask:use".into(),
                "meetings:read".into(),
            ],
            system: true,
        },
    ]
}
fn default_state() -> TeamsRolesState {
    TeamsRolesState {
        roles: system_roles(),
        teams: vec![],
        memberships: vec![],
        updated_at: now(),
    }
}
fn nonempty(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{label} is required."))
    } else {
        Ok(())
    }
}
fn stable_id(value: &str, label: &str) -> Result<(), String> {
    nonempty(value, label)?;
    if value
        .chars()
        .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-')
    {
        Ok(())
    } else {
        Err(format!("{label} must use lowercase letters, numbers, and hyphens."))
    }
}
fn valid_client_access(value: &str) -> bool {
    matches!(value, "assigned" | "shared" | "firm-read" | "none")
}
fn validate_role(role: &RoleDefinition) -> Result<(), String> {
    stable_id(&role.id, "Role id")?;
    nonempty(&role.name, "Role name")?;
    if !valid_client_access(&role.client_access) {
        return Err("Role client access is invalid.".into());
    }
    if role
        .capabilities
        .iter()
        .any(|capability| !CAPABILITIES.contains(&capability.as_str()))
    {
        return Err("Role contains an unknown capability.".into());
    }
    let mut unique_capabilities = role.capabilities.clone();
    unique_capabilities.sort();
    unique_capabilities.dedup();
    if unique_capabilities.len() != role.capabilities.len() {
        return Err("Role contains a duplicate capability.".into());
    }
    Ok(())
}
fn validate_team(team: &TeamDefinition) -> Result<(), String> {
    stable_id(&team.id, "Team id")?;
    nonempty(&team.name, "Team name")
}

fn create_role(current: &mut TeamsRolesState, role: RoleDefinition) -> anyhow::Result<()> {
    if role.system {
        anyhow::bail!("Custom roles cannot be marked as system roles.");
    }
    if current.roles.iter().any(|item| item.id == role.id) {
        anyhow::bail!("A role with this id already exists.");
    }
    current.roles.push(role);
    Ok(())
}

fn update_role(current: &mut TeamsRolesState, role: RoleDefinition) -> anyhow::Result<()> {
    let Some(index) = current.roles.iter().position(|item| item.id == role.id) else {
        anyhow::bail!("Role not found.");
    };
    if current.roles[index].system {
        anyhow::bail!("System roles are frozen and cannot be edited.");
    }
    if role.system {
        anyhow::bail!("Custom roles cannot be converted into system roles.");
    }
    current.roles[index] = role;
    Ok(())
}

fn delete_role(current: &mut TeamsRolesState, role_id: &str) -> anyhow::Result<()> {
    let Some(index) = current.roles.iter().position(|item| item.id == role_id) else {
        anyhow::bail!("Role not found.");
    };
    if current.roles[index].system {
        anyhow::bail!("System roles cannot be deleted.");
    }
    if current
        .memberships
        .iter()
        .any(|member| member.role_id == role_id)
    {
        anyhow::bail!("Reassign members before deleting this role.");
    }
    current.roles.remove(index);
    Ok(())
}

fn create_team(current: &mut TeamsRolesState, team: TeamDefinition) -> anyhow::Result<()> {
    if current
        .teams
        .iter()
        .any(|item| item.id == team.id || item.name.eq_ignore_ascii_case(&team.name))
    {
        anyhow::bail!("A team with this name already exists.");
    }
    current.teams.push(team);
    Ok(())
}

fn update_team(current: &mut TeamsRolesState, team: TeamDefinition) -> anyhow::Result<()> {
    let Some(index) = current.teams.iter().position(|item| item.id == team.id) else {
        anyhow::bail!("Team not found.");
    };
    if current
        .teams
        .iter()
        .any(|item| item.id != team.id && item.name.eq_ignore_ascii_case(&team.name))
    {
        anyhow::bail!("A team with this name already exists.");
    }
    current.teams[index] = team;
    Ok(())
}

fn delete_team(current: &mut TeamsRolesState, team_id: &str) -> anyhow::Result<()> {
    let Some(index) = current.teams.iter().position(|item| item.id == team_id) else {
        anyhow::bail!("Team not found.");
    };
    current.teams.remove(index);
    for membership in &mut current.memberships {
        membership.team_ids.retain(|id| id != team_id);
    }
    Ok(())
}

fn assign_member(
    current: &mut TeamsRolesState,
    mut assignment: MemberAssignment,
) -> anyhow::Result<()> {
    if !current
        .roles
        .iter()
        .any(|role| role.id == assignment.role_id)
    {
        anyhow::bail!("Role not found.");
    }
    if assignment
        .team_ids
        .iter()
        .any(|team_id| !current.teams.iter().any(|team| team.id == *team_id))
    {
        anyhow::bail!("One or more teams were not found.");
    }
    assignment.team_ids.sort();
    assignment.team_ids.dedup();
    if let Some(index) = current
        .memberships
        .iter()
        .position(|item| item.member_id == assignment.member_id)
    {
        current.memberships[index] = assignment;
    } else {
        current.memberships.push(assignment);
    }
    Ok(())
}

async fn workspace(state: &CrmState) -> Result<std::path::PathBuf, String> {
    state.service().workspace().await
}
fn load(store: &CrmCoreStore) -> anyhow::Result<TeamsRolesState> {
    let records = store.list_live_records()?;
    Ok(records
        .into_iter()
        .find(|record| record.get("id").and_then(serde_json::Value::as_str) == Some(STATE_ID))
        .and_then(|record| serde_json::from_value(record).ok())
        .unwrap_or_else(default_state))
}
fn persist(store: &CrmCoreStore, mut state: TeamsRolesState) -> anyhow::Result<TeamsRolesState> {
    state.updated_at = now();
    let record = serde_json::json!({ "id": STATE_ID, "kind": STATE_KIND, "matterId": "firm", "roles": state.roles, "teams": state.teams, "memberships": state.memberships, "updatedAt": state.updated_at });
    store.upsert_live_record(&record)?;
    Ok(state)
}

#[tauri::command]
pub async fn crm_teams_roles_get(state: State<'_, CrmState>) -> Result<TeamsRolesState, String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        load(&store)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}
#[tauri::command]
pub async fn crm_teams_roles_create_role(
    state: State<'_, CrmState>,
    role: RoleDefinition,
) -> Result<TeamsRolesState, String> {
    validate_role(&role)?;
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        let mut current = load(&store)?;
        create_role(&mut current, role)?;
        persist(&store, current)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}
#[tauri::command]
pub async fn crm_teams_roles_update_role(
    state: State<'_, CrmState>,
    role: RoleDefinition,
) -> Result<TeamsRolesState, String> {
    validate_role(&role)?;
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        let mut current = load(&store)?;
        update_role(&mut current, role)?;
        persist(&store, current)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}
#[tauri::command]
pub async fn crm_teams_roles_delete_role(
    state: State<'_, CrmState>,
    role_id: String,
) -> Result<TeamsRolesState, String> {
    nonempty(&role_id, "Role id")?;
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        let mut current = load(&store)?;
        delete_role(&mut current, &role_id)?;
        persist(&store, current)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}
#[tauri::command]
pub async fn crm_teams_roles_create_team(
    state: State<'_, CrmState>,
    team: TeamDefinition,
) -> Result<TeamsRolesState, String> {
    validate_team(&team)?;
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        let mut current = load(&store)?;
        create_team(&mut current, team)?;
        persist(&store, current)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}
#[tauri::command]
pub async fn crm_teams_roles_update_team(
    state: State<'_, CrmState>,
    team: TeamDefinition,
) -> Result<TeamsRolesState, String> {
    validate_team(&team)?;
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        let mut current = load(&store)?;
        update_team(&mut current, team)?;
        persist(&store, current)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}
#[tauri::command]
pub async fn crm_teams_roles_delete_team(
    state: State<'_, CrmState>,
    team_id: String,
) -> Result<TeamsRolesState, String> {
    nonempty(&team_id, "Team id")?;
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        let mut current = load(&store)?;
        delete_team(&mut current, &team_id)?;
        persist(&store, current)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}
#[tauri::command]
pub async fn crm_teams_roles_assign_member(
    state: State<'_, CrmState>,
    assignment: MemberAssignment,
) -> Result<TeamsRolesState, String> {
    nonempty(&assignment.member_id, "Member id")?;
    nonempty(&assignment.role_id, "Role id")?;
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        let mut current = load(&store)?;
        assign_member(&mut current, assignment)?;
        persist(&store, current)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn system_roles_have_the_frozen_access_contract() {
        assert_eq!(
            system_roles()
                .iter()
                .map(|role| (&role.id, &role.client_access))
                .collect::<Vec<_>>(),
            vec![
                (&"advisor".into(), &"assigned".into()),
                (&"client-service".into(), &"assigned".into()),
                (&"compliance-admin".into(), &"firm-read".into()),
                (&"guest-planner".into(), &"shared".into())
            ]
        );
    }
    #[test]
    fn role_validation_rejects_unknown_client_scope() {
        let mut role = system_roles().remove(0);
        role.client_access = "guess".into();
        assert_eq!(
            validate_role(&role).unwrap_err(),
            "Role client access is invalid."
        );
    }
    #[test]
    fn custom_roles_cannot_claim_system_status_or_unknown_capabilities() {
        let mut state = default_state();
        let mut role = RoleDefinition {
            id: "analyst".into(),
            name: "Analyst".into(),
            description: "Read only".into(),
            client_access: "none".into(),
            capabilities: vec!["clients:read".into()],
            system: true,
        };
        assert!(create_role(&mut state, role.clone()).is_err());
        role.system = false;
        role.capabilities = vec!["not-real".into()];
        assert_eq!(validate_role(&role).unwrap_err(), "Role contains an unknown capability.");
    }
    #[test]
    fn roles_teams_and_memberships_survive_a_store_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[42; 32]).unwrap();
        let mut state = load(&store).unwrap();
        create_role(
            &mut state,
            RoleDefinition {
                id: "analyst".into(),
                name: "Analyst".into(),
                description: "Read-only support".into(),
                client_access: "none".into(),
                capabilities: vec!["reports:read".into()],
                system: false,
            },
        )
        .unwrap();
        create_team(
            &mut state,
            TeamDefinition {
                id: "planning".into(),
                name: "Planning".into(),
                description: None,
            },
        )
        .unwrap();
        assign_member(
            &mut state,
            MemberAssignment {
                member_id: "maya".into(),
                role_id: "analyst".into(),
                team_ids: vec!["planning".into()],
            },
        )
        .unwrap();
        persist(&store, state).unwrap();
        drop(store);

        let reopened = CrmCoreStore::open_with_key(directory.path(), &[42; 32]).unwrap();
        let restored = load(&reopened).unwrap();
        assert!(restored.roles.iter().any(|role| role.id == "analyst"));
        assert_eq!(restored.teams[0].id, "planning");
        assert_eq!(restored.memberships[0].team_ids, vec!["planning"]);
    }
    #[test]
    fn deleting_a_team_rewrites_assignments_without_dangling_references() {
        let mut state = default_state();
        create_team(
            &mut state,
            TeamDefinition {
                id: "planning".into(),
                name: "Planning".into(),
                description: None,
            },
        )
        .unwrap();
        assign_member(
            &mut state,
            MemberAssignment {
                member_id: "m-1".into(),
                role_id: "advisor".into(),
                team_ids: vec!["planning".into()],
            },
        )
        .unwrap();
        delete_team(&mut state, "planning").unwrap();
        assert!(state.teams.is_empty());
        assert!(state.memberships[0].team_ids.is_empty());
    }
    #[test]
    fn an_assigned_or_system_role_cannot_be_deleted() {
        let mut state = default_state();
        assert!(delete_role(&mut state, "advisor")
            .unwrap_err()
            .to_string()
            .contains("System"));
        create_role(
            &mut state,
            RoleDefinition {
                id: "analyst".into(),
                name: "Analyst".into(),
                description: "Read only".into(),
                client_access: "none".into(),
                capabilities: vec![],
                system: false,
            },
        )
        .unwrap();
        assign_member(
            &mut state,
            MemberAssignment {
                member_id: "m-1".into(),
                role_id: "analyst".into(),
                team_ids: vec![],
            },
        )
        .unwrap();
        assert!(delete_role(&mut state, "analyst")
            .unwrap_err()
            .to_string()
            .contains("Reassign"));
    }
}

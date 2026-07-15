//! SQLCipher-backed, all-or-nothing teams-and-roles operations.
//!
//! The normalized tables are the sole source of truth. Each mutation takes an
//! SQLite IMMEDIATE transaction before it reads, validates, and persists the
//! complete aggregate, so concurrent changes cannot lose one another.

use rusqlite::{Connection, Transaction};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::crm::{commands::CrmState, core_store::CrmCoreStore};

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
#[cfg(test)]
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
fn nonempty(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{label} is required."))
    } else {
        Ok(())
    }
}
fn stable_id(value: &str, label: &str) -> Result<(), String> {
    nonempty(value, label)?;
    if value.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        Ok(())
    } else {
        Err(format!(
            "{label} must use lowercase letters, numbers, and hyphens."
        ))
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

/// Generic CRM collection writes must never persist this protected aggregate.
/// The feature commands below are the only native mutation boundary.
pub(crate) fn reject_generic_state_write(_: &serde_json::Value) -> anyhow::Result<()> {
    anyhow::bail!("teams-roles-state is protected; use Teams & Roles commands.")
}

async fn workspace(state: &CrmState) -> Result<std::path::PathBuf, String> {
    state.service().workspace().await
}
fn load(conn: &Connection) -> anyhow::Result<TeamsRolesState> {
    let mut role_statement = conn.prepare(
        "SELECT role_id,name,description,client_access,capabilities_json,system
         FROM crm_roles
         ORDER BY system DESC, role_id ASC",
    )?;
    let roles = role_statement
        .query_map([], |row| {
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
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut team_statement = conn
        .prepare("SELECT team_id,name,description FROM crm_teams ORDER BY name COLLATE NOCASE")?;
    let teams = team_statement
        .query_map([], |row| {
            Ok(TeamDefinition {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut member_statement =
        conn.prepare("SELECT member_id,role_id FROM crm_member_roles ORDER BY member_id")?;
    let role_assignments = member_statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut memberships = Vec::with_capacity(role_assignments.len());
    for (member_id, role_id) in role_assignments {
        let mut team_ids = conn
            .prepare(
                "SELECT team_id FROM crm_team_memberships WHERE member_id=?1 ORDER BY team_id",
            )?
            .query_map([&member_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        team_ids.sort();
        memberships.push(MemberAssignment {
            member_id,
            role_id,
            team_ids,
        });
    }
    Ok(TeamsRolesState {
        roles,
        teams,
        memberships,
        updated_at: now(),
    })
}

fn persist(
    transaction: &Transaction<'_>,
    mut state: TeamsRolesState,
) -> anyhow::Result<TeamsRolesState> {
    state.updated_at = now();
    transaction.execute("DELETE FROM crm_team_memberships", [])?;
    transaction.execute("DELETE FROM crm_member_roles", [])?;
    transaction.execute("DELETE FROM crm_teams", [])?;
    transaction.execute("DELETE FROM crm_roles", [])?;
    for role in &state.roles {
        transaction.execute(
            "INSERT INTO crm_roles(role_id,name,description,client_access,capabilities_json,system,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7)",
            (&role.id, &role.name, &role.description, &role.client_access, serde_json::to_string(&role.capabilities)?, role.system as i64, &state.updated_at),
        )?;
    }
    for team in &state.teams {
        transaction.execute(
            "INSERT INTO crm_teams(team_id,name,description,updated_at) VALUES(?1,?2,?3,?4)",
            (&team.id, &team.name, &team.description, &state.updated_at),
        )?;
    }
    for membership in &state.memberships {
        transaction.execute(
            "INSERT INTO crm_member_roles(member_id,role_id,updated_at) VALUES(?1,?2,?3)",
            (
                &membership.member_id,
                &membership.role_id,
                &state.updated_at,
            ),
        )?;
        for team_id in &membership.team_ids {
            transaction.execute(
                "INSERT INTO crm_team_memberships(team_id,member_id,updated_at) VALUES(?1,?2,?3)",
                (team_id, &membership.member_id, &state.updated_at),
            )?;
        }
    }
    Ok(state)
}

fn mutate(
    store: &CrmCoreStore,
    operation: impl FnOnce(&mut TeamsRolesState) -> anyhow::Result<()>,
) -> anyhow::Result<TeamsRolesState> {
    store.with_immediate_transaction(|transaction| {
        let mut current = load(transaction)?;
        operation(&mut current)?;
        persist(transaction, current)
    })
}

#[tauri::command]
pub async fn crm_teams_roles_get(state: State<'_, CrmState>) -> Result<TeamsRolesState, String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        store.with_immediate_transaction(|transaction| load(transaction))
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
        mutate(&store, |current| create_role(current, role))
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
        mutate(&store, |current| update_role(current, role))
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
        mutate(&store, |current| delete_role(current, &role_id))
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
        mutate(&store, |current| create_team(current, team))
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
        mutate(&store, |current| update_team(current, team))
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
        mutate(&store, |current| delete_team(current, &team_id))
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
        mutate(&store, |current| assign_member(current, assignment))
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    fn state() -> TeamsRolesState {
        TeamsRolesState {
            roles: system_roles(),
            teams: vec![],
            memberships: vec![],
            updated_at: now(),
        }
    }
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
        let mut state = state();
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
        assert_eq!(
            validate_role(&role).unwrap_err(),
            "Role contains an unknown capability."
        );
    }
    #[test]
    fn roles_teams_and_memberships_survive_a_store_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[42; 32]).unwrap();
        mutate(&store, |state| {
            create_role(
                state,
                RoleDefinition {
                    id: "analyst".into(),
                    name: "Analyst".into(),
                    description: "Read-only support".into(),
                    client_access: "none".into(),
                    capabilities: vec!["reports:read".into()],
                    system: false,
                },
            )?;
            create_team(
                state,
                TeamDefinition {
                    id: "planning".into(),
                    name: "Planning".into(),
                    description: None,
                },
            )?;
            assign_member(
                state,
                MemberAssignment {
                    member_id: "maya".into(),
                    role_id: "analyst".into(),
                    team_ids: vec!["planning".into()],
                },
            )
        })
        .unwrap();
        drop(store);

        let reopened = CrmCoreStore::open_with_key(directory.path(), &[42; 32]).unwrap();
        let restored = reopened
            .with_immediate_transaction(|transaction| load(transaction))
            .unwrap();
        assert!(restored.roles.iter().any(|role| role.id == "analyst"));
        assert_eq!(restored.teams[0].id, "planning");
        assert_eq!(restored.memberships[0].team_ids, vec!["planning"]);
    }
    #[test]
    fn deleting_a_team_rewrites_assignments_without_dangling_references() {
        let mut state = state();
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
        let mut state = state();
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

    #[test]
    fn simultaneous_mutations_keep_both_changes() {
        let directory = tempfile::tempdir().unwrap();
        let seed = CrmCoreStore::open_with_key(directory.path(), &[9; 32]).unwrap();
        drop(seed);
        let barrier = Arc::new(Barrier::new(2));
        let path = directory.path().to_path_buf();
        let handles = ["analyst", "operations"].map(|id| {
            let barrier = Arc::clone(&barrier);
            let path = path.clone();
            std::thread::spawn(move || {
                let store = CrmCoreStore::open_with_key(&path, &[9; 32]).unwrap();
                barrier.wait();
                mutate(&store, |current| {
                    create_role(
                        current,
                        RoleDefinition {
                            id: id.into(),
                            name: id.into(),
                            description: "Concurrent test role".into(),
                            client_access: "none".into(),
                            capabilities: vec![],
                            system: false,
                        },
                    )
                })
                .unwrap();
            })
        });
        for handle in handles {
            handle.join().unwrap();
        }
        let reopened = CrmCoreStore::open_with_key(directory.path(), &[9; 32]).unwrap();
        let restored = reopened
            .with_immediate_transaction(|transaction| load(transaction))
            .unwrap();
        assert!(restored.roles.iter().any(|role| role.id == "analyst"));
        assert!(restored.roles.iter().any(|role| role.id == "operations"));
    }

    #[test]
    fn generic_live_upsert_cannot_bypass_protected_system_roles() {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[11; 32]).unwrap();
        let attempt = serde_json::json!({
            "id": "firm-teams-roles", "kind": "teams-roles-state", "matterId": "firm",
            "roles": [{"id": "advisor", "system": false}],
        });
        let error = format!("{:#}", store.upsert_live_record(&attempt).unwrap_err());
        assert!(error.contains("protected"), "{error}");
        let restored = store
            .with_immediate_transaction(|transaction| load(transaction))
            .unwrap();
        assert!(restored
            .roles
            .iter()
            .any(|role| role.id == "advisor" && role.system));
    }
}

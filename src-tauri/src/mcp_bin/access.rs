use std::collections::HashSet;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;

pub const SCOPE_STATE_REL_PATH: &str = ".keepance/mcp-session-scope.json";
pub const UNASSIGNED_MATTER_ID: &str = "unassigned";
const MAX_SCOPE_STATE_AGE_SECONDS: i64 = 30;
const MAX_SCOPE_STATE_FUTURE_SKEW_SECONDS: i64 = 5;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAccessState {
    pub version: u32,
    pub updated_at: String,
    #[serde(default)]
    pub active_matter_id: Option<String>,
    #[serde(default)]
    pub granted_matter_ids: Vec<String>,
    #[serde(default)]
    pub network_lockdown: bool,
    #[serde(default)]
    pub matters: Vec<McpMatter>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpMatter {
    pub id: String,
    #[serde(default)]
    pub folder_paths: Vec<String>,
    #[serde(default)]
    pub archived: bool,
}

#[derive(Debug, Clone)]
pub struct MatterDecision {
    pub matter_id: String,
    pub allowed: bool,
}

impl McpAccessState {
    pub fn load(workspace_root: &Path) -> Result<Self, String> {
        let path = workspace_root.join(SCOPE_STATE_REL_PATH);
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("MCP access state is unavailable: {e}"))?;
        let state: McpAccessState =
            serde_json::from_str(&raw).map_err(|e| format!("MCP access state is invalid: {e}"))?;
        state.validate()?;
        Ok(state)
    }

    fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err(format!(
                "unsupported MCP access state version: {}",
                self.version
            ));
        }
        let updated_at = DateTime::parse_from_rfc3339(&self.updated_at)
            .map_err(|e| format!("MCP access state timestamp is invalid: {e}"))?
            .with_timezone(&Utc);
        let now = Utc::now();
        if updated_at < now - Duration::seconds(MAX_SCOPE_STATE_AGE_SECONDS) {
            return Err("MCP access state is stale".to_string());
        }
        if updated_at > now + Duration::seconds(MAX_SCOPE_STATE_FUTURE_SKEW_SECONDS) {
            return Err("MCP access state timestamp is too far in the future".to_string());
        }
        let ids: HashSet<&str> = self.matters.iter().map(|m| m.id.as_str()).collect();
        if let Some(active) = self.active_matter_id.as_deref() {
            if !ids.contains(active) {
                return Err(format!("active matter is not known to MCP: {active}"));
            }
        }
        for id in &self.granted_matter_ids {
            if !ids.contains(id.as_str()) {
                return Err(format!("granted matter is not known to MCP: {id}"));
            }
        }
        Ok(())
    }

    pub fn allowed_matter_ids(&self) -> HashSet<&str> {
        let mut ids = HashSet::new();
        if self.granted_matter_ids.is_empty() {
            if let Some(id) = self.active_matter_id.as_deref() {
                ids.insert(id);
            }
        } else {
            for id in &self.granted_matter_ids {
                ids.insert(id.as_str());
            }
        }
        ids.retain(|id| {
            self.matters
                .iter()
                .any(|m| m.id == *id && !m.archived && !m.folder_paths.is_empty())
        });
        ids
    }

    pub fn allowed_matter_ids_owned(&self) -> Vec<String> {
        let mut ids: Vec<String> = self
            .allowed_matter_ids()
            .into_iter()
            .map(str::to_string)
            .collect();
        ids.sort();
        ids
    }

    pub fn resolve_matter_for_path(&self, abs_path: &Path) -> String {
        let path = normalize_path(abs_path);
        if path.is_empty() {
            return UNASSIGNED_MATTER_ID.to_string();
        }
        let mut best_id = UNASSIGNED_MATTER_ID.to_string();
        let mut best_len = 0usize;
        for matter in &self.matters {
            if matter.id == UNASSIGNED_MATTER_ID || matter.archived {
                continue;
            }
            for folder in &matter.folder_paths {
                if folder.trim().is_empty() {
                    continue;
                }
                let dir = normalize_str_path(folder);
                if is_path_in_folder(&path, &dir) && dir.len() > best_len {
                    best_len = dir.len();
                    best_id = matter.id.clone();
                }
            }
        }
        best_id
    }

    pub fn decide_path(&self, abs_path: &Path) -> MatterDecision {
        let matter_id = self.resolve_matter_for_path(abs_path);
        let allowed = self.allowed_matter_ids().contains(matter_id.as_str());
        MatterDecision { matter_id, allowed }
    }
}

pub fn nearest_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut cursor = path;
    loop {
        if cursor.exists() {
            return Some(cursor.to_path_buf());
        }
        cursor = cursor.parent()?;
    }
}

pub fn canonicalized_workspace_child(
    workspace: &Path,
    candidate: &Path,
) -> Result<PathBuf, String> {
    let workspace_canon = workspace
        .canonicalize()
        .map_err(|_| "workspace root cannot be canonicalised".to_string())?;
    let ancestor = nearest_existing_ancestor(candidate)
        .ok_or_else(|| "path has no existing ancestor inside workspace".to_string())?;
    let ancestor_canon = ancestor
        .canonicalize()
        .map_err(|e| format!("path ancestor cannot be canonicalised: {e}"))?;
    if !ancestor_canon.starts_with(&workspace_canon) {
        return Err("path escapes workspace root".to_string());
    }
    Ok(candidate.to_path_buf())
}

fn normalize_path(path: &Path) -> String {
    normalize_str_path(&path.to_string_lossy())
}

fn normalize_str_path(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
}

fn is_path_in_folder(path: &str, folder: &str) -> bool {
    if path.is_empty() || folder.is_empty() {
        return false;
    }
    path == folder || path.starts_with(&format!("{folder}/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn longest_matter_folder_wins() {
        let state = McpAccessState {
            version: 1,
            updated_at: Utc::now().to_rfc3339(),
            active_matter_id: Some("child".into()),
            granted_matter_ids: vec![],
            network_lockdown: false,
            matters: vec![
                McpMatter {
                    id: "parent".into(),
                    folder_paths: vec!["/ws/acme".into()],
                    archived: false,
                },
                McpMatter {
                    id: "child".into(),
                    folder_paths: vec!["/ws/acme/case".into()],
                    archived: false,
                },
            ],
        };
        assert_eq!(
            state.resolve_matter_for_path(Path::new("/ws/acme/case/memo.md")),
            "child"
        );
    }

    #[test]
    fn path_boundary_blocks_prefix_match() {
        let state = McpAccessState {
            version: 1,
            updated_at: Utc::now().to_rfc3339(),
            active_matter_id: Some("a".into()),
            granted_matter_ids: vec![],
            network_lockdown: false,
            matters: vec![McpMatter {
                id: "a".into(),
                folder_paths: vec!["/ws/Acme".into()],
                archived: false,
            }],
        };
        assert_eq!(
            state.resolve_matter_for_path(Path::new("/ws/Acme Corp/secret.md")),
            UNASSIGNED_MATTER_ID
        );
    }

    #[test]
    fn far_future_scope_timestamp_is_invalid() {
        let state = McpAccessState {
            version: 1,
            updated_at: (Utc::now() + Duration::seconds(60)).to_rfc3339(),
            active_matter_id: Some("a".into()),
            granted_matter_ids: vec![],
            network_lockdown: false,
            matters: vec![McpMatter {
                id: "a".into(),
                folder_paths: vec!["/ws/Acme".into()],
                archived: false,
            }],
        };

        assert_eq!(
            state.validate().unwrap_err(),
            "MCP access state timestamp is too far in the future"
        );
    }
}

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;

pub const SCOPE_STATE_REL_PATH: &str = lantern_lib::identity::MCP_SCOPE_STATE_PATH;
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
        let mut ids = self
            .granted_matter_ids
            .iter()
            .map(String::as_str)
            .collect::<HashSet<_>>();
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

/// Validate that an absolute `candidate` path resolves inside `workspace`
/// and return the canonical, symlink-free result.
///
/// Previously this walked UP from `candidate` to its nearest EXISTING
/// ancestor and canonicalized (i.e. FOLLOWED symlinks through) only that
/// ancestor — an in-workspace alias directory (`Clients/Alias` ->
/// `Clients/RealClient`) would pass the `starts_with` check since
/// RealClient also sits inside the workspace, and the function then
/// returned `candidate` VERBATIM (the non-canonical, alias-containing
/// path), so a caller resolving it further would walk straight through the
/// alias. Delegates to the shared no-follow walk instead — see
/// `crate::commands::pathguard` (also used by the vault and diarize
/// command sites) — which refuses the moment ANY component, not just the
/// nearest existing one, turns out to be a symlink, and returns the
/// genuinely resolved canonical path rather than the raw candidate.
pub fn canonicalized_workspace_child(
    workspace: &Path,
    candidate: &Path,
) -> Result<PathBuf, String> {
    let workspace_canon = workspace
        .canonicalize()
        .map_err(|_| "workspace root cannot be canonicalised".to_string())?;
    let relative = candidate
        .strip_prefix(workspace)
        .or_else(|_| candidate.strip_prefix(&workspace_canon))
        .map_err(|_| "path has no existing ancestor inside workspace".to_string())?;
    lantern_lib::commands::pathguard::resolve_creatable(
        &workspace_canon,
        &relative.to_string_lossy(),
        &workspace_canon,
    )
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
    fn canonicalized_workspace_child_accepts_plain_nested_absolute_path() {
        let ws = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(ws.path().join("Clients/A")).unwrap();
        std::fs::write(ws.path().join("Clients/A/notes.md"), b"hi").unwrap();
        let candidate = ws.path().join("Clients/A/notes.md");
        let result = canonicalized_workspace_child(ws.path(), &candidate);
        assert!(result.is_ok(), "plain nested absolute path must be accepted: {result:?}");
        assert!(result.unwrap().ends_with("Clients/A/notes.md"));
    }

    #[cfg(unix)]
    #[test]
    fn canonicalized_workspace_child_rejects_in_workspace_alias_symlink() {
        let ws = tempfile::tempdir().unwrap();
        let real = ws.path().join("Clients/RealClient");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(real.join("secret.docx"), b"secret").unwrap();
        let alias = ws.path().join("Clients/Alias");
        std::os::unix::fs::symlink(&real, &alias).unwrap();

        let candidate = ws.path().join("Clients/Alias/secret.docx");
        let err = canonicalized_workspace_child(ws.path(), &candidate).unwrap_err();
        assert!(err.contains("symlink"), "got: {err}");
    }

    #[cfg(unix)]
    #[test]
    fn canonicalized_workspace_child_rejects_out_of_workspace_symlink() {
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), b"secret").unwrap();
        std::os::unix::fs::symlink(outside.path(), ws.path().join("escape")).unwrap();

        let candidate = ws.path().join("escape/secret.txt");
        let err = canonicalized_workspace_child(ws.path(), &candidate).unwrap_err();
        assert!(err.contains("symlink"), "got: {err}");
    }

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
    fn active_matter_does_not_grant_access_without_explicit_mcp_grant() {
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

        assert!(state.allowed_matter_ids().is_empty());
        assert!(!state.decide_path(Path::new("/ws/Acme/secret.md")).allowed);
    }

    #[test]
    fn granted_matter_allows_access_even_when_a_different_matter_is_active() {
        let state = McpAccessState {
            version: 1,
            updated_at: Utc::now().to_rfc3339(),
            active_matter_id: Some("b".into()),
            granted_matter_ids: vec!["a".into()],
            network_lockdown: false,
            matters: vec![
                McpMatter {
                    id: "a".into(),
                    folder_paths: vec!["/ws/Acme".into()],
                    archived: false,
                },
                McpMatter {
                    id: "b".into(),
                    folder_paths: vec!["/ws/Beta".into()],
                    archived: false,
                },
            ],
        };

        assert_eq!(state.allowed_matter_ids_owned(), vec!["a".to_string()]);
        assert!(state.decide_path(Path::new("/ws/Acme/allowed.md")).allowed);
        assert!(!state.decide_path(Path::new("/ws/Beta/active-but-denied.md")).allowed);
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

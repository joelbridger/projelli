use serde::{Deserialize, Serialize};

pub const DEFAULT_ACCOUNT: &str = "default";

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Drive {
    pub id: String,
    pub name: String,
    pub web_url: Option<String>,
    pub drive_type: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Site {
    pub id: String,
    pub name: String,
    pub display_name: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct ParentReference {
    pub drive_id: String,
    pub id: Option<String>,
    pub path: Option<String>,
    pub site_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DriveItem {
    pub id: String,
    pub name: String,
    pub parent_reference: Option<ParentReference>,
    pub file: Option<serde_json::Value>,
    pub folder: Option<serde_json::Value>,
    pub deleted: Option<serde_json::Value>,
    pub size: Option<u64>,
    pub last_modified_date_time: Option<String>,
    #[serde(rename = "eTag")]
    pub e_tag: Option<String>,
    #[serde(rename = "cTag")]
    pub c_tag: Option<String>,
    pub web_url: Option<String>,
    pub remote_item: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct DeltaPage {
    pub value: Vec<DriveItem>,
    #[serde(rename = "@odata.nextLink")]
    pub next_link: Option<String>,
    #[serde(rename = "@odata.deltaLink")]
    pub delta_link: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveMatterMapEntry {
    pub folder_key: String,
    pub matter_id: String,
    /// Workspace-relative folder to MATERIALIZE this client's OneDrive files into
    /// on disk, so they appear in the client's Documents tab and are indexed by
    /// the normal local-file pipeline (the file watcher). An empty value keeps the
    /// legacy behaviour of indexing the downloaded bytes into the RAG store only
    /// (no on-disk copy), which is what unmapped files still do.
    #[serde(default)]
    pub dest_folder: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceKey {
    pub source_id: String,
    pub drive_id: String,
    pub site_id: Option<String>,
    pub item_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderKeyParts {
    pub account: String,
    pub site_id: Option<String>,
    pub drive_id: String,
    pub path: String,
}

impl DriveItem {
    pub fn is_file(&self) -> bool {
        self.file.is_some() && self.deleted.is_none()
    }

    pub fn is_folder(&self) -> bool {
        self.folder.is_some() && self.deleted.is_none()
    }

    pub fn drive_id(&self) -> String {
        self.parent_reference
            .as_ref()
            .map(|p| p.drive_id.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "me".to_string())
    }

    pub fn site_id(&self) -> Option<String> {
        self.parent_reference
            .as_ref()
            .and_then(|p| p.site_id.clone())
            .filter(|s| !s.is_empty())
    }

    pub fn source_key(&self) -> SourceKey {
        let drive_id = self.drive_id();
        let site_id = self.site_id();
        let source_id = match &site_id {
            Some(site) => format!("sharepoint:{site}:{drive_id}:{}", self.id),
            None => format!("onedrive:{drive_id}:{}", self.id),
        };
        SourceKey {
            source_id,
            drive_id,
            site_id,
            item_id: self.id.clone(),
        }
    }

    pub fn remote_signature(&self) -> String {
        format!(
            "{}|{}|{}|{}",
            self.e_tag.as_deref().unwrap_or(""),
            self.c_tag.as_deref().unwrap_or(""),
            self.last_modified_date_time.as_deref().unwrap_or(""),
            self.size.unwrap_or(0)
        )
    }

    pub fn extension(&self) -> String {
        self.name
            .rsplit_once('.')
            .map(|(_, ext)| ext.to_ascii_lowercase())
            .unwrap_or_default()
    }
}

pub fn is_supported_office_or_text(name: &str) -> bool {
    matches!(
        name.rsplit_once('.')
            .map(|(_, ext)| ext.to_ascii_lowercase())
            .as_deref(),
        Some("docx" | "xlsx" | "pptx" | "rtf" | "txt" | "text" | "md" | "markdown")
    )
}

pub fn is_pending_pdf(name: &str) -> bool {
    matches!(
        name.rsplit_once('.')
            .map(|(_, ext)| ext.to_ascii_lowercase())
            .as_deref(),
        Some("pdf")
    )
}

pub fn normalize_cloud_path(path: &str) -> String {
    let mut p = path.replace('\\', "/");
    if let Some(idx) = p.find("root:") {
        p = p[(idx + "root:".len())..].to_string();
    }
    while p.contains("//") {
        p = p.replace("//", "/");
    }
    p = p.trim().trim_end_matches('/').to_ascii_lowercase();
    if p.is_empty() {
        "/".to_string()
    } else if p.starts_with('/') {
        p
    } else {
        format!("/{p}")
    }
}

pub fn parent_folder_path(item: &DriveItem) -> String {
    item.parent_reference
        .as_ref()
        .and_then(|p| p.path.as_deref())
        .map(normalize_cloud_path)
        .unwrap_or_else(|| "/".to_string())
}

pub fn item_folder_path(item: &DriveItem) -> String {
    let parent = parent_folder_path(item);
    if item.is_folder() {
        normalize_cloud_path(&format!("{}/{}", parent.trim_end_matches('/'), item.name))
    } else {
        parent
    }
}

/// Sanitize a single path segment before joining it into an on-disk workspace
/// path. Rejects traversal (`.`/`..`), path separators, and control/null bytes so
/// a hostile OneDrive folder or file name can never escape the destination folder
/// (matter-isolation + path-traversal guard, per the security requirements).
pub fn sanitize_path_segment(seg: &str) -> Option<String> {
    let s = seg.trim();
    if s.is_empty() || s == "." || s == ".." {
        return None;
    }
    if s.contains('/') || s.contains('\\') || s.contains('\0') {
        return None;
    }
    // A bare drive letter or a leading colon would let a Windows path re-root.
    if s.contains(':') {
        return None;
    }
    Some(s.to_string())
}

/// The original-case path segments of `item`'s parent folder that lie BELOW the
/// matched OneDrive folder (whose normalized path is `matched_norm`). Returns an
/// empty vector when the file sits directly in the matched folder. Used to mirror
/// the client's OneDrive sub-folder structure into their workspace folder on disk.
pub fn subpath_below_matched(item: &DriveItem, matched_norm: &str) -> Vec<String> {
    let matched_depth = normalize_cloud_path(matched_norm)
        .split('/')
        .filter(|s| !s.is_empty())
        .count();
    let raw = item
        .parent_reference
        .as_ref()
        .and_then(|p| p.path.as_deref())
        .unwrap_or("")
        .replace('\\', "/");
    let after_root = match raw.find("root:") {
        Some(i) => &raw[(i + "root:".len())..],
        None => raw.as_str(),
    };
    after_root
        .split('/')
        .filter(|s| !s.is_empty())
        .skip(matched_depth)
        .map(|s| s.to_string())
        .collect()
}

pub fn folder_key(account: &str, site_id: Option<&str>, drive_id: &str, path: &str) -> String {
    let normalized = normalize_cloud_path(path);
    match site_id {
        Some(site) if !site.is_empty() => {
            format!("m365/{account}/{site}/{drive_id}:{normalized}")
        }
        _ => format!("m365/{account}/{drive_id}:{normalized}"),
    }
}

pub fn parse_folder_key(key: &str) -> Option<FolderKeyParts> {
    let (prefix, path) = key.rsplit_once(':')?;
    let parts: Vec<&str> = prefix.split('/').collect();
    let (account, site_id, drive_id) = match parts.as_slice() {
        ["m365", account, drive_id] if !account.is_empty() && !drive_id.is_empty() => {
            ((*account).to_string(), None, (*drive_id).to_string())
        }
        ["m365", account, site_id, drive_id]
            if !account.is_empty() && !site_id.is_empty() && !drive_id.is_empty() =>
        {
            (
                (*account).to_string(),
                Some((*site_id).to_string()),
                (*drive_id).to_string(),
            )
        }
        _ => return None,
    };
    Some(FolderKeyParts {
        account,
        site_id,
        drive_id,
        path: normalize_cloud_path(path),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_graph_parent_path() {
        assert_eq!(
            normalize_cloud_path("/drive/root:/Clients/Acme/"),
            "/clients/acme"
        );
        assert_eq!(normalize_cloud_path("Clients\\Acme"), "/clients/acme");
        assert_eq!(normalize_cloud_path("/drive/root:"), "/");
    }

    #[test]
    fn source_ids_disambiguate_sharepoint() {
        let item = DriveItem {
            id: "item-1".into(),
            parent_reference: Some(ParentReference {
                drive_id: "drive-1".into(),
                site_id: Some("site-1".into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert_eq!(
            item.source_key().source_id,
            "sharepoint:site-1:drive-1:item-1"
        );
    }

    #[test]
    fn parses_personal_and_sharepoint_folder_keys() {
        assert_eq!(
            parse_folder_key("m365/default/drive-a:/Clients/Acme"),
            Some(FolderKeyParts {
                account: "default".into(),
                site_id: None,
                drive_id: "drive-a".into(),
                path: "/clients/acme".into(),
            })
        );
        assert_eq!(
            parse_folder_key("m365/default/site-1/drive-b:/Shared/Docs"),
            Some(FolderKeyParts {
                account: "default".into(),
                site_id: Some("site-1".into()),
                drive_id: "drive-b".into(),
                path: "/shared/docs".into(),
            })
        );
        assert!(parse_folder_key("bad/default/drive:/x").is_none());
    }
}

use serde::{Deserialize, Serialize};

pub const DEFAULT_ACCOUNT: &str = "default";

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct SharefileItem {
    #[serde(rename = "Id")]
    pub id: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "FileName")]
    pub file_name: Option<String>,
    #[serde(rename = "FileSizeBytes")]
    pub file_size_bytes: Option<u64>,
    #[serde(rename = "FileSizeInKB")]
    pub file_size_in_kb: Option<u64>,
    #[serde(rename = "CreationDate")]
    pub creation_date: Option<String>,
    #[serde(rename = "ProgenyEditDate")]
    pub progeny_edit_date: Option<String>,
    #[serde(rename = "ClientModifiedDate")]
    pub client_modified_date: Option<String>,
    #[serde(rename = "FileCount")]
    pub file_count: Option<u64>,
    #[serde(rename = "Children")]
    pub children: Option<Vec<SharefileItem>>,
    #[serde(rename = "HasRemoteChildren")]
    pub has_remote_children: Option<bool>,
    #[serde(rename = "Path")]
    pub path: Option<String>,
    #[serde(rename = "SemanticPath")]
    pub semantic_path: Option<String>,
    #[serde(rename = "url")]
    pub url: Option<String>,
    #[serde(rename = "odata.metadata")]
    pub odata_metadata: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(default)]
pub struct SharefileFeed {
    pub value: Vec<SharefileItem>,
    #[serde(rename = "odata.nextLink")]
    pub next_link: Option<String>,
    #[serde(rename = "odata.nextlink")]
    pub nextlink: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharefileMatterMapEntry {
    pub folder_key: String,
    pub matter_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceKey {
    pub source_id: String,
    pub item_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderKeyParts {
    pub account: String,
    pub folder_id: String,
    pub path: String,
}

impl SharefileFeed {
    pub fn next_url(&self) -> Option<String> {
        self.next_link.clone().or_else(|| self.nextlink.clone())
    }
}

impl SharefileItem {
    pub fn is_file(&self) -> bool {
        if self.id.trim().is_empty() {
            return false;
        }
        if self
            .odata_metadata
            .as_deref()
            .map(|m| m.contains("ShareFile.Api.Models.File"))
            .unwrap_or(false)
        {
            return true;
        }
        self.file_name
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
    }

    pub fn is_folder(&self) -> bool {
        if self.id.trim().is_empty() || self.is_file() {
            return false;
        }
        self.file_count.is_some()
            || self.children.is_some()
            || self
                .odata_metadata
                .as_deref()
                .map(|m| m.contains("ShareFile.Api.Models.Folder"))
                .unwrap_or(false)
    }

    pub fn display_name(&self) -> String {
        self.file_name
            .as_deref()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or(&self.name)
            .trim()
            .to_string()
    }

    pub fn source_key(&self) -> SourceKey {
        SourceKey {
            source_id: format!("sharefile:{}", self.id),
            item_id: self.id.clone(),
        }
    }

    pub fn remote_signature(&self) -> String {
        format!(
            "{}|{}|{}|{}",
            self.client_modified_date.as_deref().unwrap_or(""),
            self.progeny_edit_date.as_deref().unwrap_or(""),
            self.creation_date.as_deref().unwrap_or(""),
            self.file_size_bytes
                .or_else(|| self.file_size_in_kb.map(|kb| kb.saturating_mul(1024)))
                .unwrap_or(0)
        )
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

pub fn normalize_sharefile_path(path: &str) -> String {
    let mut p = path.replace('\\', "/");
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

pub fn child_path(parent: &str, name: &str) -> String {
    normalize_sharefile_path(&format!(
        "{}/{}",
        parent.trim_end_matches('/'),
        name.trim_matches('/')
    ))
}

pub fn folder_key(account: &str, folder_id: &str, path: &str) -> String {
    let normalized = normalize_sharefile_path(path);
    format!("sharefile/{account}/{folder_id}:{normalized}")
}

pub fn parse_folder_key(key: &str) -> Option<FolderKeyParts> {
    let (prefix, path) = key.rsplit_once(':')?;
    let parts: Vec<&str> = prefix.split('/').collect();
    let [provider, account, folder_id] = parts.as_slice() else {
        return None;
    };
    if *provider != "sharefile" || account.is_empty() || folder_id.is_empty() {
        return None;
    }
    Some(FolderKeyParts {
        account: (*account).to_string(),
        folder_id: (*folder_id).to_string(),
        path: normalize_sharefile_path(path),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_sharefile_paths() {
        assert_eq!(normalize_sharefile_path("Clients\\Acme\\"), "/clients/acme");
        assert_eq!(normalize_sharefile_path("/Clients//Acme/"), "/clients/acme");
        assert_eq!(normalize_sharefile_path(""), "/");
    }

    #[test]
    fn parses_folder_keys() {
        let key = folder_key(DEFAULT_ACCOUNT, "fo123", "/Clients/Acme");
        assert_eq!(key, "sharefile/default/fo123:/clients/acme");
        assert_eq!(
            parse_folder_key(&key),
            Some(FolderKeyParts {
                account: DEFAULT_ACCOUNT.to_string(),
                folder_id: "fo123".to_string(),
                path: "/clients/acme".to_string(),
            })
        );
        assert_eq!(parse_folder_key("m365/default/drive:/clients/acme"), None);
    }
}

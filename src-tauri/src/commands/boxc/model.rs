use serde::{Deserialize, Serialize};

pub const DEFAULT_ACCOUNT: &str = "default";
pub const ROOT_FOLDER_ID: &str = "0";

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct BoxUser {
    pub id: String,
    pub name: String,
    pub login: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct BoxItem {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub etag: Option<String>,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub modified_at: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct BoxFolder {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub etag: Option<String>,
    pub modified_at: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct BoxFile {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub etag: Option<String>,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub modified_at: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct BoxCollection {
    pub entries: Vec<BoxItem>,
    pub limit: Option<u32>,
    pub next_marker: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BoxMatterMapEntry {
    pub folder_key: String,
    pub matter_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoxFolderKeyParts {
    pub account: String,
    pub folder_id: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoxFileItem {
    pub id: String,
    pub name: String,
    pub parent_folder_id: String,
    pub parent_path: String,
    pub ancestor_folder_ids: Vec<String>,
    pub etag: Option<String>,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub modified_at: Option<String>,
    pub web_url: Option<String>,
}

impl BoxItem {
    pub fn is_file(&self) -> bool {
        self.item_type == "file"
    }

    pub fn is_folder(&self) -> bool {
        self.item_type == "folder"
    }

    pub fn into_file_item(
        self,
        parent_folder_id: String,
        parent_path: String,
        ancestor_folder_ids: Vec<String>,
    ) -> BoxFileItem {
        BoxFileItem {
            id: self.id,
            name: self.name,
            parent_folder_id,
            parent_path,
            ancestor_folder_ids,
            etag: self.etag,
            sha1: self.sha1,
            size: self.size,
            modified_at: self.modified_at,
            web_url: self.web_url,
        }
    }
}

impl BoxFileItem {
    pub fn source_id(&self) -> String {
        format!("box:{}", self.id)
    }

    pub fn remote_signature(&self) -> String {
        format!(
            "{}|{}|{}|{}",
            self.etag.as_deref().unwrap_or(""),
            self.sha1.as_deref().unwrap_or(""),
            self.modified_at.as_deref().unwrap_or(""),
            self.size.unwrap_or(0)
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

pub fn normalize_box_path(path: &str) -> String {
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

pub fn child_path(parent_path: &str, child_name: &str) -> String {
    normalize_box_path(&format!(
        "{}/{}",
        normalize_box_path(parent_path).trim_end_matches('/'),
        child_name
    ))
}

pub fn folder_key(account: &str, folder_id: &str, path: &str) -> String {
    format!(
        "box/{account}/{}:{}",
        folder_id.trim(),
        normalize_box_path(path)
    )
}

pub fn parse_folder_key(key: &str) -> Option<BoxFolderKeyParts> {
    let (prefix, path) = key.rsplit_once(':')?;
    let parts: Vec<&str> = prefix.split('/').collect();
    let ["box", account, folder_id] = parts.as_slice() else {
        return None;
    };
    if account.is_empty() || folder_id.is_empty() {
        return None;
    }
    Some(BoxFolderKeyParts {
        account: (*account).to_string(),
        folder_id: (*folder_id).to_string(),
        path: normalize_box_path(path),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_box_paths() {
        assert_eq!(normalize_box_path("Clients\\Acme/"), "/clients/acme");
        assert_eq!(normalize_box_path("/"), "/");
        assert_eq!(child_path("/Clients", "Acme"), "/clients/acme");
    }

    #[test]
    fn folder_key_round_trips() {
        let key = folder_key(DEFAULT_ACCOUNT, "123", "/Clients/Acme");
        assert_eq!(key, "box/default/123:/clients/acme");
        let parsed = parse_folder_key(&key).expect("parse folder key");
        assert_eq!(parsed.account, DEFAULT_ACCOUNT);
        assert_eq!(parsed.folder_id, "123");
        assert_eq!(parsed.path, "/clients/acme");
    }

    #[test]
    fn source_ids_use_box_prefix() {
        let file = BoxFileItem {
            id: "file-1".into(),
            name: "memo.docx".into(),
            parent_folder_id: "folder-1".into(),
            parent_path: "/clients/acme".into(),
            ancestor_folder_ids: vec!["folder-1".into()],
            etag: None,
            sha1: None,
            size: None,
            modified_at: None,
            web_url: None,
        };
        assert_eq!(file.source_id(), "box:file-1");
    }
}

//! Read-only Microsoft Graph client helpers for OneDrive / SharePoint.
//!
//! Every method is a GET. This module must never add Graph write endpoints.

use crate::commands::mail::graph::{page_continuation, Continuation, GraphClient};
use crate::commands::onedrive::model::{DeltaPage, Drive, DriveItem, Site};

const SELECT_ITEM: &str =
    "id,name,parentReference,file,folder,size,lastModifiedDateTime,eTag,cTag,webUrl,remoteItem,deleted";

pub struct OneDriveClient {
    graph: GraphClient,
}

impl OneDriveClient {
    pub fn new(token: String) -> Self {
        Self {
            graph: GraphClient::new(token),
        }
    }

    pub fn new_with_base(token: String, base: String) -> Self {
        Self {
            graph: GraphClient::new_with_base(token, base),
        }
    }

    pub fn base(&self) -> &str {
        self.graph.base()
    }

    pub async fn list_drives(&self) -> anyhow::Result<Vec<Drive>> {
        let url = format!(
            "{}/v1.0/me/drives?$select=id,name,webUrl,driveType",
            self.base()
        );
        self.collect_array(&url).await
    }

    pub async fn default_drive(&self) -> anyhow::Result<Drive> {
        let url = format!("{}/v1.0/me/drive", self.base());
        Ok(serde_json::from_value(self.graph.get_json(&url).await?)?)
    }

    pub async fn list_root_children(
        &self,
        drive_id: Option<&str>,
        omit_select: bool,
    ) -> anyhow::Result<Vec<DriveItem>> {
        let query = children_query(omit_select);
        let url = match drive_id {
            Some(drive_id) => format!(
                "{}/v1.0/drives/{}/root/children{}",
                self.base(),
                enc_path_segment(drive_id),
                query
            ),
            None => format!("{}/v1.0/me/drive/root/children{}", self.base(), query),
        };
        self.collect_array(&url).await
    }

    pub async fn list_children(
        &self,
        drive_id: &str,
        item_id: &str,
        omit_select: bool,
    ) -> anyhow::Result<Vec<DriveItem>> {
        let query = children_query(omit_select);
        let url = format!(
            "{}/v1.0/drives/{}/items/{}/children{}",
            self.base(),
            enc_path_segment(drive_id),
            enc_path_segment(item_id),
            query
        );
        self.collect_array(&url).await
    }

    pub async fn delta_root(
        &self,
        drive_id: Option<&str>,
        cursor: Option<&str>,
        omit_select: bool,
    ) -> anyhow::Result<DeltaPage> {
        let mut url = cursor
            .map(str::to_string)
            .unwrap_or_else(|| match drive_id {
                Some(drive_id) if omit_select => format!(
                    "{}/v1.0/drives/{}/root/delta",
                    self.base(),
                    enc_path_segment(drive_id)
                ),
                Some(drive_id) => format!(
                    "{}/v1.0/drives/{}/root/delta?$select={}",
                    self.base(),
                    enc_path_segment(drive_id),
                    SELECT_ITEM
                ),
                None if omit_select => format!("{}/v1.0/me/drive/root/delta", self.base()),
                None => format!(
                    "{}/v1.0/me/drive/root/delta?$select={}",
                    self.base(),
                    SELECT_ITEM
                ),
            });
        let mut items = Vec::new();
        let mut delta_link = None;
        loop {
            let page = self.graph.get_json(&url).await?;
            if let Some(arr) = page.get("value").and_then(|v| v.as_array()) {
                for item in arr {
                    items.push(serde_json::from_value::<DriveItem>(item.clone())?);
                }
            }
            match page_continuation(&page) {
                Continuation::Next(next) => url = next,
                Continuation::Delta(delta) => {
                    delta_link = Some(delta);
                    break;
                }
                Continuation::End => break,
            }
        }
        Ok(DeltaPage {
            value: items,
            next_link: None,
            delta_link,
        })
    }

    pub async fn download_content(&self, drive_id: &str, item_id: &str) -> anyhow::Result<Vec<u8>> {
        let url = format!(
            "{}/v1.0/drives/{}/items/{}/content",
            self.base(),
            enc_path_segment(drive_id),
            enc_path_segment(item_id)
        );
        self.graph.get_bytes(&url).await
    }

    pub async fn search_sites(&self, query: &str) -> anyhow::Result<Vec<Site>> {
        let url = format!("{}/v1.0/sites?search={}", self.base(), enc_query(query));
        self.collect_array(&url).await
    }

    pub async fn list_site_drives(&self, site_id: &str) -> anyhow::Result<Vec<Drive>> {
        let url = format!(
            "{}/v1.0/sites/{}/drives?$select=id,name,webUrl,driveType",
            self.base(),
            enc_path_segment(site_id)
        );
        self.collect_array(&url).await
    }

    async fn collect_array<T>(&self, first_url: &str) -> anyhow::Result<Vec<T>>
    where
        T: serde::de::DeserializeOwned,
    {
        let mut out = Vec::new();
        let mut next = Some(first_url.to_string());
        while let Some(url) = next {
            let page = self.graph.get_json(&url).await?;
            if let Some(arr) = page.get("value").and_then(|v| v.as_array()) {
                for item in arr {
                    out.push(serde_json::from_value::<T>(item.clone())?);
                }
            }
            next = page
                .get("@odata.nextLink")
                .and_then(|v| v.as_str())
                .map(str::to_string);
        }
        Ok(out)
    }
}

fn enc_query(s: &str) -> String {
    crate::commands::mail::gmail::oauth::urlencoding_encode(s)
}

fn enc_path_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn children_query(omit_select: bool) -> String {
    if omit_select {
        "?$top=200".to_string()
    } else {
        format!("?$select={SELECT_ITEM}&$top=200")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn children_query_omits_select_for_personal_drive() {
        assert_eq!(children_query(true), "?$top=200");
    }

    #[test]
    fn children_query_keeps_select_for_business_drive() {
        assert_eq!(
            children_query(false),
            format!("?$select={SELECT_ITEM}&$top=200")
        );
    }
}

//! Read-only Box API client.
//!
//! Every public API call in this module is a GET. Do not add Box write methods
//! here; this connector imports documents only.

use anyhow::{Context, Result};
use reqwest::StatusCode;
use serde::de::DeserializeOwned;

use crate::commands::boxc::model::{BoxCollection, BoxFile, BoxFolder, BoxItem, BoxUser};

const BOX_API_BASE: &str = "https://api.box.com/2.0";
const LIST_FIELDS: &str = "id,type,name,etag,sha1,size,modified_at,web_url";

pub struct BoxClient {
    token: String,
    base: String,
    http: reqwest::Client,
}

impl BoxClient {
    pub fn new(token: String) -> Self {
        Self::new_with_base(token, BOX_API_BASE.to_string())
    }

    pub fn new_with_base(token: String, base: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("build reqwest client");
        Self { token, base, http }
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    pub async fn current_user(&self) -> Result<BoxUser> {
        self.get_json(&format!("{}/users/me", self.base())).await
    }

    pub async fn get_folder(&self, folder_id: &str) -> Result<BoxFolder> {
        self.get_json(&format!(
            "{}/folders/{}?fields=id,type,name,etag,modified_at,web_url",
            self.base(),
            enc_path_segment(folder_id)
        ))
        .await
    }

    pub async fn get_file(&self, file_id: &str) -> Result<BoxFile> {
        self.get_json(&format!(
            "{}/files/{}?fields={}",
            self.base(),
            enc_path_segment(file_id),
            LIST_FIELDS
        ))
        .await
    }

    pub async fn list_folder_items(&self, folder_id: &str) -> Result<Vec<BoxItem>> {
        let mut out = Vec::new();
        let mut marker: Option<String> = None;
        loop {
            let mut url = format!(
                "{}/folders/{}/items?usemarker=true&limit=1000&fields={}",
                self.base(),
                enc_path_segment(folder_id),
                LIST_FIELDS
            );
            if let Some(m) = marker.as_deref() {
                url.push_str("&marker=");
                url.push_str(&enc_query(m));
            }
            let page: BoxCollection = self.get_json(&url).await?;
            out.extend(page.entries);
            marker = page.next_marker.filter(|m| !m.is_empty());
            if marker.is_none() {
                break;
            }
        }
        Ok(out)
    }

    pub async fn download_content(&self, file_id: &str) -> Result<Vec<u8>> {
        let url = format!(
            "{}/files/{}/content",
            self.base(),
            enc_path_segment(file_id)
        );
        self.get_bytes(&url).await
    }

    async fn get_json<T: DeserializeOwned>(&self, url: &str) -> Result<T> {
        let bytes = self.get_bytes(url).await?;
        serde_json::from_slice(&bytes).context("decode Box JSON response")
    }

    async fn get_bytes(&self, url: &str) -> Result<Vec<u8>> {
        let mut delay = std::time::Duration::from_millis(500);
        for attempt in 0..5 {
            let resp = self
                .http
                .get(url)
                .bearer_auth(&self.token)
                .send()
                .await
                .with_context(|| format!("Box GET failed for {url}"))?;
            let status = resp.status();
            if status.is_success() {
                return Ok(resp.bytes().await?.to_vec());
            }
            if status == StatusCode::TOO_MANY_REQUESTS || status == StatusCode::SERVICE_UNAVAILABLE
            {
                let retry_after = resp
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .map(std::time::Duration::from_secs);
                if attempt < 4 {
                    tokio::time::sleep(retry_after.unwrap_or(delay)).await;
                    delay = delay.saturating_mul(2);
                    continue;
                }
            }
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Box GET {url} failed with HTTP {status}: {body}");
        }
        anyhow::bail!("Box GET {url} failed after retries")
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

#[cfg(test)]
mod tests {
    #[test]
    fn read_only_client_declares_no_write_calls() {
        let src = include_str!("client.rs");
        assert!(src.contains(".get("), "client should use GET requests");
        for verb in ["post", "put", "patch", "delete"] {
            let forbidden = format!(".{verb}(");
            assert!(
                !src.contains(forbidden),
                "Box client must stay read-only; found {}",
                forbidden
            );
        }
    }
}

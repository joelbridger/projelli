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
    network_policy: Option<(
        crate::network_policy::NetworkPolicy,
        crate::network_policy::EgressOperation,
    )>,
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
        Self {
            token,
            base,
            http,
            network_policy: None,
        }
    }

    pub fn with_network_policy(
        mut self,
        policy: crate::network_policy::NetworkPolicy,
        operation: crate::network_policy::EgressOperation,
    ) -> Self {
        self.network_policy = Some((policy, operation));
        self
    }
    async fn send(&self, url: &str, request: reqwest::RequestBuilder) -> Result<reqwest::Response> {
        let Some((policy, operation)) = self.network_policy.as_ref() else {
            #[cfg(test)]
            return Ok(request.send().await?);
            #[cfg(not(test))]
            anyhow::bail!("BoxClient requires a NetworkPolicy before it can make a request");
        };
        let authorized = crate::commands::connector_network::authorize_url(policy, operation, url)?;
        crate::commands::connector_network::await_authorized(policy, &authorized, async move {
            Ok(request.send().await?)
        })
        .await
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
            let req = self.http.get(url).bearer_auth(&self.token);
            let resp = self
                .send(url, req)
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
            // Never surface the raw Box response body to the caller/UI (or
            // the log): it can carry file/folder names or other PII. Match
            // the sibling connectors' convention (DocuSign/Jotform/Zocks):
            // a generic context, no per-request URL/id in either surface —
            // a Box file/folder id in a long-lived log is itself an
            // indirect PII correlation risk.
            let body = resp.text().await.unwrap_or_default();
            crate::util::http_log::log_http_failure("Box GET", status, &body);
            anyhow::bail!("Box request failed (HTTP {status})");
        }
        anyhow::bail!("Box request failed after retries")
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
    use super::*;

    #[test]
    fn read_only_client_declares_no_write_calls() {
        let src = include_str!("client.rs");
        assert!(src.contains(".get("), "client should use GET requests");
        for verb in ["post", "put", "patch", "delete"] {
            let forbidden = format!(".{verb}(");
            assert!(
                !src.contains(forbidden.as_str()),
                "Box client must stay read-only; found {}",
                forbidden
            );
        }
    }

    // ── error responses never leak the raw body ──────────────────────────────

    #[tokio::test]
    async fn get_bytes_failure_never_surfaces_raw_body_pii() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        // A Box error body shaped like the real API, carrying a PII-bearing
        // free-text message (a file name / owner email).
        let pii_body = serde_json::json!({
            "type": "error",
            "status": 404,
            "code": "not_found",
            "message": "file owned by alice@example.com not found"
        })
        .to_string();
        Mock::given(method("GET"))
            .and(path("/files/abc/content"))
            .respond_with(ResponseTemplate::new(404).set_body_raw(pii_body, "application/json"))
            .mount(&server)
            .await;

        let client = BoxClient::new_with_base("AT".into(), server.uri());
        let err = client
            .download_content("abc")
            .await
            .expect_err("should fail on 404");
        let msg = format!("{err:#}");
        assert!(
            !msg.contains("alice@example.com"),
            "error must never contain the raw response body: {msg}"
        );
        assert!(
            !msg.contains("not found"),
            "error must never contain the raw response message text: {msg}"
        );
        assert!(
            !msg.contains("/files/abc/content"),
            "error must never contain the request URL/file id: {msg}"
        );
        assert!(msg.contains("404"), "error should retain the status: {msg}");
    }
}

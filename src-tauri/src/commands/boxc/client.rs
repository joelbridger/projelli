//! Read-only Box API client.
//!
//! Every public API call in this module is a GET. Do not add Box write methods
//! here; this connector imports documents only.

use anyhow::{Context, Result};
use reqwest::{redirect::Policy, StatusCode, Url};
use serde::de::DeserializeOwned;

use crate::commands::boxc::model::{BoxCollection, BoxFile, BoxFolder, BoxItem, BoxUser};

const BOX_API_BASE: &str = "https://api.box.com/2.0";
const LIST_FIELDS: &str = "id,type,name,etag,sha1,size,modified_at,web_url";
const MAX_REDIRECTS: usize = 10;

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
            // Box content endpoints redirect to the Box CDN.  Follow each
            // response ourselves so the policy approves the CDN hop too.
            .redirect(Policy::none())
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
            let resp = self
                .send_get_following_redirects(url)
                .await
                .with_context(|| format!("Box GET failed for {url}"))?;
            let status = resp.status();
            if status.is_success() {
                let (policy, operation) = self.network_policy.as_ref().ok_or_else(|| {
                    anyhow::anyhow!("BoxClient requires a NetworkPolicy before it can read a response")
                })?;
                let body_url = resp.url().as_str().to_string();
                let body_grant = crate::commands::connector_network::authorize_url(policy, operation, &body_url)?;
                let body = crate::commands::connector_network::await_authorized(policy, &body_grant, async {
                    Ok(resp.bytes().await?)
                })
                .await?;
                return Ok(body.to_vec());
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
            let (policy, operation) = self.network_policy.as_ref().ok_or_else(|| {
                anyhow::anyhow!("BoxClient requires a NetworkPolicy before it can read a response")
            })?;
            let body_url = resp.url().as_str().to_string();
            let body_grant = crate::commands::connector_network::authorize_url(policy, operation, &body_url)?;
            let body = crate::commands::connector_network::await_authorized(policy, &body_grant, async {
                Ok(resp.text().await?)
            })
            .await
            .unwrap_or_default();
            crate::util::http_log::log_http_failure("Box GET", status, &body);
            anyhow::bail!("Box request failed (HTTP {status})");
        }
        anyhow::bail!("Box request failed after retries")
    }

    /// Send a read request one hop at a time.  A Box API redirect normally
    /// points at a pre-signed CDN URL, so credentials stay on the API origin;
    /// every actual destination still passes through `send` and its policy
    /// authorization before a socket is opened.
    async fn send_get_following_redirects(&self, url: &str) -> Result<reqwest::Response> {
        let start_url = Url::parse(url).context("parse Box request URL")?;
        let mut next_url = start_url.clone();
        for redirect_count in 0..=MAX_REDIRECTS {
            let request = self.http.get(next_url.clone());
            let request = if next_url.origin() == start_url.origin() {
                request.bearer_auth(&self.token)
            } else {
                request
            };
            let response = self.send(next_url.as_str(), request).await?;
            if !response.status().is_redirection() {
                return Ok(response);
            }
            if redirect_count == MAX_REDIRECTS {
                anyhow::bail!("Box request exceeded redirect limit");
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| anyhow::anyhow!("Box redirect had no usable Location header"))?;
            next_url = next_url
                .join(location)
                .context("Box redirect had an invalid Location header")?;
        }
        unreachable!("redirect loop returns after its limit")
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

    fn policy() -> crate::network_policy::NetworkPolicy {
        crate::network_policy::NetworkPolicy::load_from_directory(
            &tempfile::tempdir().unwrap().keep(),
        )
    }

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

        let client = BoxClient::new_with_base("AT".into(), server.uri())
            .with_network_policy(policy(), crate::network_policy::LOCAL_LLAMA);
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

    #[tokio::test]
    async fn rejects_an_unapproved_box_redirect_destination() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let redirect = format!("http://localhost:{}/blocked", server.address().port());
        Mock::given(method("GET"))
            .and(path("/files/abc/content"))
            .respond_with(ResponseTemplate::new(302).insert_header("Location", redirect))
            .mount(&server)
            .await;
        // If reqwest still followed redirects itself, this expectation would
        // fail. `localhost` is not a literal-loopback policy destination.
        Mock::given(method("GET"))
            .and(path("/blocked"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;

        let client = BoxClient::new_with_base("token".into(), server.uri())
            .with_network_policy(policy(), crate::network_policy::LOCAL_LLAMA);
        assert!(client.download_content("abc").await.is_err());
        server.verify().await;
    }

    #[tokio::test]
    async fn policy_flip_stops_box_download_before_redirect_hop() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        use std::time::Duration;
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            sync::{mpsc, oneshot},
        };

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (first_seen, mut first_seen_rx) = mpsc::channel(1);
        let (allow_redirect, wait_for_redirect) = oneshot::channel();
        let redirected_requests = Arc::new(AtomicUsize::new(0));
        let redirected_requests_for_server = redirected_requests.clone();
        let server = tokio::spawn(async move {
            let (mut first, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            first.read(&mut request).await.unwrap();
            first_seen.send(()).await.unwrap();
            wait_for_redirect.await.unwrap();
            first
                .write_all(b"HTTP/1.1 302 Found\r\nLocation: /second\r\nContent-Length: 0\r\n\r\n")
                .await
                .unwrap();
            if let Ok(Ok((_second, _))) =
                tokio::time::timeout(Duration::from_millis(150), listener.accept()).await
            {
                redirected_requests_for_server.fetch_add(1, Ordering::SeqCst);
            }
        });
        let policy = policy();
        let client = BoxClient::new_with_base("token".into(), format!("http://127.0.0.1:{port}"))
            .with_network_policy(policy.clone(), crate::network_policy::LOCAL_LLAMA);
        let download = tokio::spawn(async move { client.download_content("abc").await });

        first_seen_rx.recv().await.unwrap();
        policy.set_offline_mode(true).unwrap();
        allow_redirect.send(()).unwrap();
        assert!(download.await.unwrap().is_err());
        server.await.unwrap();
        assert_eq!(redirected_requests.load(Ordering::SeqCst), 0);
    }
}

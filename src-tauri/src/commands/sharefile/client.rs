//! Read-only ShareFile REST client helpers.
//!
//! Every method is a GET. This module must never add ShareFile write endpoints.

use std::time::{Duration, Instant};

use anyhow::Context;
use reqwest::StatusCode;

use crate::commands::sharefile::model::{SharefileFeed, SharefileItem};

const MAX_429_RETRIES: u32 = 6;
const MAX_RETRY_AFTER_SECS: u64 = 120;
const MAX_REDIRECTS: usize = 10;
const SELECT_ITEM: &str = "Id,Name,FileName,FileSizeBytes,FileSizeInKB,CreationDate,ProgenyEditDate,ClientModifiedDate,FileCount,Path,SemanticPath";

pub struct SharefileClient {
    access_token: String,
    api_base: String,
    http: reqwest::Client,
    last_request: tokio::sync::Mutex<Option<Instant>>,
    network_policy: Option<(
        crate::network_policy::NetworkPolicy,
        crate::network_policy::EgressOperation,
    )>,
}

impl SharefileClient {
    pub fn new(access_token: String, subdomain: String) -> anyhow::Result<Self> {
        let api_base = normalize_api_base(&subdomain)?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(90))
            .connect_timeout(Duration::from_secs(15))
            // Authorize every hop ourselves.  A redirect target must never
            // inherit the configured ShareFile origin's permission.
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .context("build reqwest client for SharefileClient")?;
        Ok(Self {
            access_token,
            api_base,
            http,
            last_request: tokio::sync::Mutex::new(None),
            network_policy: None,
        })
    }

    #[cfg(test)]
    pub fn new_with_base(access_token: String, api_base: String) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(90))
            .connect_timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .context("build reqwest client for SharefileClient")?;
        Ok(Self {
            access_token,
            api_base: api_base.trim_end_matches('/').to_string(),
            http,
            last_request: tokio::sync::Mutex::new(None),
            network_policy: None,
        })
    }

    pub fn base(&self) -> &str {
        &self.api_base
    }

    pub fn with_network_policy(
        mut self,
        policy: crate::network_policy::NetworkPolicy,
        operation: crate::network_policy::EgressOperation,
    ) -> Self {
        self.network_policy = Some((policy, operation));
        self
    }
    async fn send(
        &self,
        url: &str,
        request: reqwest::RequestBuilder,
    ) -> anyhow::Result<reqwest::Response> {
        let Some((policy, operation)) = self.network_policy.as_ref() else {
            #[cfg(test)]
            return Ok(request.send().await?);
            #[cfg(not(test))]
            anyhow::bail!("SharefileClient requires a NetworkPolicy before it can make a request");
        };
        let authorized = crate::commands::connector_network::authorize_configured_origin(
            policy,
            operation,
            url,
            &self.api_base,
        )?;
        crate::commands::connector_network::await_authorized(policy, &authorized, async move {
            Ok(request.send().await?)
        })
        .await
    }

    pub async fn validate_token(&self) -> anyhow::Result<()> {
        let _: serde_json::Value = self.get_json("/Users/Current").await?;
        Ok(())
    }

    pub async fn list_root_children(&self) -> anyhow::Result<Vec<SharefileItem>> {
        match self.list_children_for_id("top").await {
            Ok(items) => Ok(items),
            Err(_) => {
                self.collect_feed(&format!("/Items?$select={SELECT_ITEM}&$top=200"))
                    .await
            }
        }
    }

    pub async fn list_children(&self, item_id: &str) -> anyhow::Result<Vec<SharefileItem>> {
        self.list_children_for_id(item_id).await
    }

    pub async fn download_content(&self, item_id: &str) -> anyhow::Result<Vec<u8>> {
        let path = format!(
            "/Items({})/Download?includeallversions=false&includeDeleted=false",
            enc_path_segment(item_id)
        );
        self.get_bytes(&path).await
    }

    async fn list_children_for_id(&self, item_id: &str) -> anyhow::Result<Vec<SharefileItem>> {
        self.collect_feed(&format!(
            "/Items({})/Children?includeDeleted=false&$select={SELECT_ITEM}&$top=200",
            enc_path_segment(item_id)
        ))
        .await
    }

    async fn collect_feed(&self, first_path_or_url: &str) -> anyhow::Result<Vec<SharefileItem>> {
        let mut out = Vec::new();
        let mut next = Some(self.url(first_path_or_url));
        while let Some(url) = next {
            let page: SharefileFeed = self.get_json_url(&url).await?;
            let next_url = page.next_url().map(|n| self.url(&n));
            out.extend(page.value);
            next = next_url;
        }
        Ok(out)
    }

    async fn rate_gate(&self) {
        let mut guard = self.last_request.lock().await;
        if let Some(last) = *guard {
            let elapsed = last.elapsed();
            if elapsed < Duration::from_millis(250) {
                tokio::time::sleep(Duration::from_millis(250) - elapsed).await;
            }
        }
        *guard = Some(Instant::now());
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> anyhow::Result<T> {
        let url = self.url(path);
        self.get_json_url(&url).await
    }

    async fn get_json_url<T: serde::de::DeserializeOwned>(&self, url: &str) -> anyhow::Result<T> {
        // Never attach the access token to a URL off the configured ShareFile
        // origin. Absolute odata.nextLink values come straight from the API
        // response, so a malformed/compromised link could otherwise exfiltrate
        // the bearer token (P1-C).
        self.ensure_same_origin(url)?;
        for attempt in 0..MAX_429_RETRIES {
            self.rate_gate().await;
            let resp = self
                .send_get_following_redirects(url)
                .await
                .context("ShareFile HTTP GET send")?;

            if resp.status() == StatusCode::TOO_MANY_REQUESTS {
                let retry_after = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string);
                tokio::time::sleep(retry_delay(retry_after.as_deref(), attempt)).await;
                continue;
            }

            let status = resp.status();
            let body = resp.text().await.context("read ShareFile response body")?;
            if !status.is_success() {
                anyhow::bail!("ShareFile request failed (HTTP {})", status);
            }
            return serde_json::from_str(&body).context("parse ShareFile JSON response");
        }
        anyhow::bail!("ShareFile throttled past retry budget")
    }

    async fn get_bytes(&self, path: &str) -> anyhow::Result<Vec<u8>> {
        let url = self.url(path);
        self.ensure_same_origin(&url)?;
        for attempt in 0..MAX_429_RETRIES {
            self.rate_gate().await;
            let resp = self
                .send_get_following_redirects(&url)
                .await
                .context("ShareFile HTTP GET download send")?;

            if resp.status() == StatusCode::TOO_MANY_REQUESTS {
                let retry_after = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string);
                tokio::time::sleep(retry_delay(retry_after.as_deref(), attempt)).await;
                continue;
            }

            let status = resp.status();
            if !status.is_success() {
                anyhow::bail!("ShareFile download request failed (HTTP {})", status);
            }
            return Ok(resp
                .bytes()
                .await
                .context("read ShareFile document bytes")?
                .to_vec());
        }
        anyhow::bail!("ShareFile download throttled past retry budget")
    }

    /// Follow redirects explicitly so every real destination is checked
    /// against the saved ShareFile origin and the current network policy.
    async fn send_get_following_redirects(&self, url: &str) -> anyhow::Result<reqwest::Response> {
        let mut next_url = reqwest::Url::parse(url).context("parse ShareFile request URL")?;
        for redirect_count in 0..=MAX_REDIRECTS {
            let request = self
                .http
                .get(next_url.clone())
                .bearer_auth(&self.access_token);
            let response = self.send(next_url.as_str(), request).await?;
            if !response.status().is_redirection() {
                return Ok(response);
            }
            if redirect_count == MAX_REDIRECTS {
                anyhow::bail!("ShareFile request exceeded redirect limit");
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| {
                    anyhow::anyhow!("ShareFile redirect had no usable Location header")
                })?;
            next_url = next_url
                .join(location)
                .context("ShareFile redirect had an invalid Location header")?;
        }
        unreachable!("redirect loop returns after its limit")
    }

    fn url(&self, path_or_url: &str) -> String {
        if path_or_url.starts_with("http://") || path_or_url.starts_with("https://") {
            path_or_url.to_string()
        } else if path_or_url.starts_with('/') {
            format!("{}{}", self.api_base, path_or_url)
        } else {
            format!("{}/{}", self.api_base, path_or_url)
        }
    }

    /// Refuse to issue a token-bearing request to anything off the configured
    /// ShareFile origin (scheme + host + port).
    fn ensure_same_origin(&self, url: &str) -> anyhow::Result<()> {
        crate::commands::connector::assert_same_origin(&self.api_base, url)
    }
}

pub fn normalize_api_base(subdomain: &str) -> anyhow::Result<String> {
    let mut raw = subdomain.trim().trim_end_matches('/').to_ascii_lowercase();
    if raw.is_empty() {
        anyhow::bail!("ShareFile subdomain is required");
    }
    raw = raw
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches("/sf/v3")
        .trim_end_matches("/sf/v3/")
        .trim_end_matches('/')
        .to_string();
    if let Some(host) = raw.strip_suffix(".sharefile.com") {
        raw = format!("{host}.sf-api.com");
    } else if !raw.contains('.') {
        raw = format!("{raw}.sf-api.com");
    }
    // Reject anything that isn't a bare hostname BEFORE the suffix check: a value
    // like `attacker.example/x.sf-api.com` ends with `.sf-api.com` but its real
    // URL host is `attacker.example`, which would receive the access token during
    // validation (P1-B). is_valid_hostname denies slashes/ports/userinfo.
    if !crate::commands::connector::is_valid_hostname(&raw) {
        anyhow::bail!(
            "ShareFile subdomain is not a valid hostname (no slashes, ports, or special characters)"
        );
    }
    if !raw.ends_with(".sf-api.com") {
        anyhow::bail!("ShareFile subdomain must be like yourfirm or yourfirm.sf-api.com");
    }
    Ok(format!("https://{raw}/sf/v3"))
}

fn retry_delay(retry_after: Option<&str>, attempt: u32) -> Duration {
    if let Some(seconds) = retry_after.and_then(|s| s.parse::<u64>().ok()) {
        return Duration::from_secs(seconds.min(MAX_RETRY_AFTER_SECS));
    }
    Duration::from_millis(500 * 2u64.saturating_pow(attempt).min(16))
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
    fn normalizes_sharefile_subdomain() {
        assert_eq!(
            normalize_api_base("acme").unwrap(),
            "https://acme.sf-api.com/sf/v3"
        );
        assert_eq!(
            normalize_api_base("https://acme.sharefile.com/").unwrap(),
            "https://acme.sf-api.com/sf/v3"
        );
        assert_eq!(
            normalize_api_base("acme.sf-api.com").unwrap(),
            "https://acme.sf-api.com/sf/v3"
        );
        assert_eq!(
            normalize_api_base("https://acme.sf-api.com/sf/v3").unwrap(),
            "https://acme.sf-api.com/sf/v3"
        );
        assert!(normalize_api_base("example.com").is_err());
    }

    #[test]
    fn rejects_subdomain_that_smuggles_a_foreign_host() {
        // P1-B: a slash-bearing value whose suffix is .sf-api.com but whose real
        // URL host is the attacker's must be rejected before any token is sent.
        assert!(normalize_api_base("attacker.example/x.sf-api.com").is_err());
        assert!(normalize_api_base("attacker.example/acme").is_err());
        assert!(normalize_api_base("acme.sf-api.com:8443").is_err());
        assert!(normalize_api_base("user@acme.sf-api.com").is_err());
    }

    #[test]
    fn refuses_token_bearing_request_to_foreign_origin() {
        // P1-C: an absolute odata.nextLink to a different host must be refused
        // before the bearer token is attached.
        let client =
            SharefileClient::new_with_base("tok".into(), "https://acme.sf-api.com/sf/v3".into())
                .unwrap();
        assert!(client
            .ensure_same_origin("https://acme.sf-api.com/sf/v3/Items?p=2")
            .is_ok());
        assert!(client
            .ensure_same_origin("https://evil.example.com/sf/v3/Items")
            .is_err());
        assert!(client
            .ensure_same_origin("http://acme.sf-api.com/sf/v3/Items")
            .is_err());
    }

    #[tokio::test]
    async fn rejects_an_unapproved_sharefile_redirect_destination() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let redirect = format!("http://localhost:{}/blocked", server.address().port());
        Mock::given(method("GET"))
            .and(path("/sf/v3/Items(abc)/Download"))
            .respond_with(ResponseTemplate::new(302).insert_header("Location", redirect))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/blocked"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;

        let client =
            SharefileClient::new_with_base("token".into(), format!("{}/sf/v3", server.uri()))
                .unwrap()
                .with_network_policy(policy(), crate::network_policy::SHAREFILE_SYNC);
        assert!(client.download_content("abc").await.is_err());
        server.verify().await;
    }

    #[tokio::test]
    async fn policy_flip_stops_sharefile_download_before_redirect_hop() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
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
                .write_all(
                    b"HTTP/1.1 302 Found\r\nLocation: /sf/v3/second\r\nContent-Length: 0\r\n\r\n",
                )
                .await
                .unwrap();
            if let Ok(Ok((_second, _))) =
                tokio::time::timeout(Duration::from_millis(150), listener.accept()).await
            {
                redirected_requests_for_server.fetch_add(1, Ordering::SeqCst);
            }
        });
        let policy = policy();
        let client = SharefileClient::new_with_base(
            "token".into(),
            format!("http://127.0.0.1:{port}/sf/v3"),
        )
        .unwrap()
        .with_network_policy(policy.clone(), crate::network_policy::SHAREFILE_SYNC);
        let download = tokio::spawn(async move { client.download_content("abc").await });

        first_seen_rx.recv().await.unwrap();
        policy.set_offline_mode(true).unwrap();
        allow_redirect.send(()).unwrap();
        assert!(download.await.unwrap().is_err());
        server.await.unwrap();
        assert_eq!(redirected_requests.load(Ordering::SeqCst), 0);
    }
}

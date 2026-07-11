//! Provisional, read-only Zocks REST client.
//!
//! Assumption pending vendor confirmation: `https://api.zocks.io/v1/` with
//! Bearer API-key auth, `GET /sessions`, and `GET /sessions/{id}`.
//! This file is the only place that should know those endpoint details.

use std::time::Duration;

use anyhow::Context;

use crate::commands::zocks::model::{ZocksSession, ZocksSessionsPage};

const BASE_URL: &str = "https://api.zocks.io/v1";
const MAX_429_RETRIES: u32 = 6;
const MAX_RETRY_AFTER_SECS: u64 = 120;

pub trait ZocksReadOnlyApi {
    const WRITE_CAPABILITY: bool = false;
}

pub struct ZocksClient {
    api_key: String,
    base: String,
    http: reqwest::Client,
    network_policy: Option<(
        crate::network_policy::NetworkPolicy,
        crate::network_policy::EgressOperation,
    )>,
}

impl ZocksReadOnlyApi for ZocksClient {}

impl ZocksClient {
    pub fn new(api_key: String) -> Self {
        Self::new_with_base(api_key, BASE_URL.to_string())
    }

    pub fn new_with_base(api_key: String, base: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("build reqwest client for ZocksClient");
        Self {
            api_key,
            base: base.trim_end_matches('/').to_string(),
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
    async fn send(
        &self,
        url: &str,
        request: reqwest::RequestBuilder,
    ) -> anyhow::Result<reqwest::Response> {
        let Some((policy, operation)) = self.network_policy.as_ref() else {
            #[cfg(test)]
            return Ok(request.send().await?);
            #[cfg(not(test))]
            anyhow::bail!("ZocksClient requires a NetworkPolicy before it can make a request");
        };
        let authorized = crate::commands::connector_network::authorize_url(policy, operation, url)?;
        crate::commands::connector_network::await_authorized(policy, &authorized, async move {
            Ok(request.send().await?)
        })
        .await
    }

    pub fn base_url(&self) -> &str {
        &self.base
    }

    pub async fn validate_connection(&self) -> anyhow::Result<()> {
        self.list_sessions(None, Some(1)).await.map(|_| ())
    }

    pub async fn list_sessions(
        &self,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> anyhow::Result<ZocksSessionsPage> {
        let mut query = vec![("limit", limit.unwrap_or(100).to_string())];
        if let Some(cursor) = cursor {
            if !cursor.trim().is_empty() {
                query.push(("cursor", cursor.to_string()));
            }
        }
        self.get_json("/sessions", &query).await
    }

    pub async fn get_session(&self, session_id: &str) -> anyhow::Result<ZocksSession> {
        self.get_json(
            &format!("/sessions/{}", encode_path_segment(session_id)),
            &[],
        )
        .await
    }

    async fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> anyhow::Result<T> {
        let url = if path.starts_with("http") {
            path.to_string()
        } else {
            format!("{}{}", self.base, path)
        };

        for attempt in 0..MAX_429_RETRIES {
            let mut req = self.http.get(&url).bearer_auth(&self.api_key);
            for (k, v) in query {
                req = req.query(&[(*k, v.as_str())]);
            }
            let resp = self.send(&url, req).await.context("Zocks HTTP GET send")?;
            if resp.status().as_u16() == 429 {
                let retry_after = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string);
                tokio::time::sleep(retry_delay(retry_after.as_deref(), attempt)).await;
                continue;
            }

            let status = resp.status();
            let body = resp.text().await.context("read Zocks response body")?;
            if !status.is_success() {
                log::warn!("Zocks GET failed: HTTP {} at {}", status, path);
                anyhow::bail!("Zocks request failed (HTTP {})", status);
            }
            return serde_json::from_str(&body).context("parse Zocks JSON response");
        }
        anyhow::bail!(
            "Zocks throttled past retry budget ({} attempts)",
            MAX_429_RETRIES
        )
    }
}

fn retry_delay(retry_after: Option<&str>, attempt: u32) -> Duration {
    if let Some(value) = retry_after {
        if let Ok(secs) = value.trim().parse::<u64>() {
            return Duration::from_secs(secs.min(MAX_RETRY_AFTER_SECS));
        }
    }
    Duration::from_secs((1u64 << attempt).min(MAX_RETRY_AFTER_SECS))
}

fn encode_path_segment(value: &str) -> String {
    let mut out = String::new();
    for byte in value.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zocks_client_is_structurally_read_only() {
        fn assert_read_only<T: ZocksReadOnlyApi>() {
            assert!(!T::WRITE_CAPABILITY);
        }
        assert_read_only::<ZocksClient>();

        let source = include_str!("client.rs");
        for (prefix, suffix) in [
            (".po", "st("),
            (".pu", "t("),
            (".pa", "tch("),
            (".de", "lete("),
        ] {
            assert!(!source.contains(&format!("{prefix}{suffix}")));
        }
    }

    #[test]
    fn retry_delay_caps_retry_after() {
        assert_eq!(retry_delay(Some("999"), 0), Duration::from_secs(120));
        assert_eq!(retry_delay(None, 3), Duration::from_secs(8));
    }

    #[test]
    fn path_segment_encoding_is_local_to_zocks_client() {
        assert_eq!(encode_path_segment("sess 1/a"), "sess%201%2Fa");
    }
}

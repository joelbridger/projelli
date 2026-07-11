//! Read-only DocuSign eSignature REST client.
//!
//! Security contract: this client exposes only the GET endpoints needed for
//! import. There is no generic public request method and no method for send,
//! void, create, update, delete, POST, PUT, PATCH, or DELETE.

use std::time::{Duration, Instant};

use anyhow::Context;

use crate::commands::docusign::model::{
    DocusignAuditEvent, DocusignAuditEventsResponse, DocusignDocument, DocusignEnvelope,
    DocusignEnvelopePage, DocusignRecipients,
};

const MAX_429_RETRIES: u32 = 6;
const MAX_RETRY_AFTER_SECS: u64 = 120;

pub trait DocusignReadOnlyApi {
    const WRITE_CAPABILITY: bool = false;
}

pub struct DocusignClient {
    access_token: String,
    account_id: String,
    api_base: String,
    http: reqwest::Client,
    last_request: tokio::sync::Mutex<Option<Instant>>,
    network_policy: Option<(
        crate::network_policy::NetworkPolicy,
        crate::network_policy::EgressOperation,
    )>,
}

impl DocusignReadOnlyApi for DocusignClient {}

impl DocusignClient {
    pub fn new(access_token: String, account_id: String, api_base: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("build reqwest client for DocusignClient");
        Self {
            access_token,
            account_id,
            api_base: api_base.trim_end_matches('/').to_string(),
            http,
            last_request: tokio::sync::Mutex::new(None),
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
            anyhow::bail!("DocusignClient requires a NetworkPolicy before it can make a request");
        };
        let configured_host = reqwest::Url::parse(&self.api_base)
            .ok()
            .and_then(|url| url.host_str().map(str::to_owned))
            .ok_or_else(|| anyhow::anyhow!("DocuSign API base has no host"))?;
        let authorized = crate::commands::connector_network::authorize_configured_host(
            policy,
            operation,
            url,
            &configured_host,
        )?;
        crate::commands::connector_network::await_authorized(policy, &authorized, async move {
            Ok(request.send().await?)
        })
        .await
    }

    pub fn account_id(&self) -> &str {
        &self.account_id
    }

    async fn rate_gate(&self) {
        let mut guard = self.last_request.lock().await;
        if let Some(last) = *guard {
            let elapsed = last.elapsed();
            if elapsed < Duration::from_millis(350) {
                tokio::time::sleep(Duration::from_millis(350) - elapsed).await;
            }
        }
        *guard = Some(Instant::now());
    }

    async fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> anyhow::Result<T> {
        let url = if path.starts_with("http") {
            path.to_string()
        } else {
            format!("{}{}", self.api_base, path)
        };

        for attempt in 0..MAX_429_RETRIES {
            self.rate_gate().await;
            let mut req = self.http.get(&url).bearer_auth(&self.access_token);
            for (k, v) in query {
                req = req.query(&[(*k, v.as_str())]);
            }
            let resp = self
                .send(&url, req)
                .await
                .context("DocuSign HTTP GET send")?;

            if resp.status().as_u16() == 429 {
                let retry_after = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string);
                tokio::time::sleep(retry_delay(retry_after.as_deref(), attempt)).await;
                continue;
            }

            log_rate_headers(resp.headers());
            let status = resp.status();
            let (policy, operation) = self.network_policy.as_ref().ok_or_else(|| {
                anyhow::anyhow!("DocusignClient requires a NetworkPolicy before it can read a response")
            })?;
            let body_url = resp.url().as_str().to_string();
            let body_grant = crate::commands::connector_network::authorize_configured_host(
                policy,
                operation,
                &body_url,
                reqwest::Url::parse(&self.api_base)
                    .ok()
                    .and_then(|url| url.host_str().map(str::to_owned))
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("DocuSign API base has no host"))?,
            )?;
            let body = crate::commands::connector_network::await_authorized(policy, &body_grant, async {
                Ok(resp.text().await?)
            })
            .await
            .context("read DocuSign response body")?;
            if !status.is_success() {
                log::warn!("DocuSign GET failed: HTTP {} at {}", status, path);
                anyhow::bail!("DocuSign request failed (HTTP {})", status);
            }
            return serde_json::from_str(&body).context("parse DocuSign JSON response");
        }

        anyhow::bail!(
            "DocuSign throttled past retry budget ({} attempts)",
            MAX_429_RETRIES
        )
    }

    async fn get_bytes(&self, path: &str) -> anyhow::Result<Vec<u8>> {
        let url = if path.starts_with("http") {
            path.to_string()
        } else {
            format!("{}{}", self.api_base, path)
        };
        for attempt in 0..MAX_429_RETRIES {
            self.rate_gate().await;
            let req = self.http.get(&url).bearer_auth(&self.access_token);
            let resp = self
                .send(&url, req)
                .await
                .context("DocuSign HTTP GET document send")?;
            if resp.status().as_u16() == 429 {
                let retry_after = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string);
                tokio::time::sleep(retry_delay(retry_after.as_deref(), attempt)).await;
                continue;
            }
            log_rate_headers(resp.headers());
            let status = resp.status();
            if !status.is_success() {
                log::warn!("DocuSign document GET failed: HTTP {} at {}", status, path);
                anyhow::bail!("DocuSign document request failed (HTTP {})", status);
            }
            let (policy, operation) = self.network_policy.as_ref().ok_or_else(|| {
                anyhow::anyhow!("DocusignClient requires a NetworkPolicy before it can read a response")
            })?;
            let body_url = resp.url().as_str().to_string();
            let body_grant = crate::commands::connector_network::authorize_configured_host(
                policy,
                operation,
                &body_url,
                reqwest::Url::parse(&self.api_base)
                    .ok()
                    .and_then(|url| url.host_str().map(str::to_owned))
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("DocuSign API base has no host"))?,
            )?;
            let bytes = crate::commands::connector_network::await_authorized(policy, &body_grant, async {
                Ok(resp.bytes().await?)
            })
            .await
            .context("read DocuSign document bytes")?;
            return Ok(bytes.to_vec());
        }
        anyhow::bail!("DocuSign document throttled past retry budget")
    }

    pub async fn list_envelopes(
        &self,
        from_date: &str,
        to_date: Option<&str>,
        start_position: Option<&str>,
    ) -> anyhow::Result<DocusignEnvelopePage> {
        let path = format!("/v2.1/accounts/{}/envelopes", self.account_id);
        let mut query = vec![
            ("from_date", from_date.to_string()),
            ("status", "completed".to_string()),
            ("include", "recipients,documents,custom_fields".to_string()),
            ("folder_types", "normal,inbox,sentitems".to_string()),
        ];
        if let Some(to) = to_date {
            query.push(("to_date", to.to_string()));
        }
        if let Some(start) = start_position {
            query.push(("start_position", start.to_string()));
        }
        self.get_json(&path, &query).await
    }

    pub async fn get_envelope(&self, envelope_id: &str) -> anyhow::Result<DocusignEnvelope> {
        let path = format!(
            "/v2.1/accounts/{}/envelopes/{}",
            self.account_id, envelope_id
        );
        self.get_json(
            &path,
            &[("include", "recipients,documents,custom_fields".to_string())],
        )
        .await
    }

    pub async fn list_recipients(&self, envelope_id: &str) -> anyhow::Result<DocusignRecipients> {
        let path = format!(
            "/v2.1/accounts/{}/envelopes/{}/recipients",
            self.account_id, envelope_id
        );
        self.get_json(&path, &[("include_extended", "true".to_string())])
            .await
    }

    pub async fn list_documents(&self, envelope_id: &str) -> anyhow::Result<Vec<DocusignDocument>> {
        #[derive(serde::Deserialize, Default)]
        #[serde(default, rename_all = "camelCase")]
        struct DocumentsResponse {
            envelope_documents: Vec<DocusignDocument>,
        }
        let path = format!(
            "/v2.1/accounts/{}/envelopes/{}/documents",
            self.account_id, envelope_id
        );
        let resp: DocumentsResponse = self.get_json(&path, &[]).await?;
        Ok(resp.envelope_documents)
    }

    pub async fn download_document(
        &self,
        envelope_id: &str,
        document_id: &str,
    ) -> anyhow::Result<Vec<u8>> {
        let path = format!(
            "/v2.1/accounts/{}/envelopes/{}/documents/{}",
            self.account_id, envelope_id, document_id
        );
        self.get_bytes(&path).await
    }

    pub async fn get_audit_events(
        &self,
        envelope_id: &str,
    ) -> anyhow::Result<Vec<DocusignAuditEvent>> {
        let path = format!(
            "/v2.1/accounts/{}/envelopes/{}/audit_events",
            self.account_id, envelope_id
        );
        let resp: DocusignAuditEventsResponse = self.get_json(&path, &[]).await?;
        Ok(resp.audit_events)
    }
}

fn retry_delay(retry_after: Option<&str>, attempt: u32) -> Duration {
    if let Some(header) = retry_after {
        if let Ok(secs) = header.parse::<u64>() {
            return Duration::from_secs(secs.min(MAX_RETRY_AFTER_SECS));
        }
    }
    let secs = 2u64
        .saturating_pow(attempt.min(6))
        .min(MAX_RETRY_AFTER_SECS);
    Duration::from_secs(secs)
}

fn log_rate_headers(headers: &reqwest::header::HeaderMap) {
    let remaining = headers
        .get("x-ratelimit-remaining")
        .and_then(|v| v.to_str().ok());
    let burst_remaining = headers
        .get("x-burstlimit-remaining")
        .and_then(|v| v.to_str().ok());
    if let Some(r) = remaining {
        log::debug!("DocuSign x-ratelimit-remaining={r}");
    }
    if let Some(r) = burst_remaining {
        log::debug!("DocuSign x-burstlimit-remaining={r}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn docusign_client_is_structurally_read_only() {
        fn assert_read_only<T: DocusignReadOnlyApi>() {
            assert!(!T::WRITE_CAPABILITY);
        }
        assert_read_only::<DocusignClient>();

        let source = include_str!("client.rs");
        let forbidden = vec![
            format!("{}{}", ".po", "st("),
            format!("{}{}", ".pu", "t("),
            format!("{}{}", ".pa", "tch("),
            format!("{}{}", ".de", "lete("),
            format!("{}{}", "void", "_envelope"),
            format!("{}{}", "send", "_envelope"),
            format!("{}{}", "create", "_envelope"),
            format!("{}{}", "update", "_envelope"),
        ];
        for forbidden in forbidden {
            assert!(
                !source.contains(&forbidden),
                "DocuSign client must not expose write capability: found {forbidden}"
            );
        }
    }

    #[test]
    fn retry_delay_caps_retry_after() {
        assert_eq!(
            retry_delay(Some("999"), 0),
            Duration::from_secs(MAX_RETRY_AFTER_SECS)
        );
        assert_eq!(retry_delay(None, 2), Duration::from_secs(4));
    }
}

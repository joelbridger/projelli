//! Read-only Jotform REST client.
//!
//! Security contract: this client only exposes GET-backed methods. Jotform
//! accepts the API key through the `APIKEY` query parameter, which keeps this
//! connector simple and self-serve.

use std::time::Duration;

use anyhow::Context;

use crate::commands::jotform::model::{
    JotformForm, JotformFormsResponse, JotformSubmission, JotformSubmissionsResponse, JotformUser,
    JotformUserResponse,
};

const BASE_URL: &str = "https://api.jotform.com";
const PAGE_LIMIT: u32 = 100;
const MAX_429_RETRIES: u32 = 6;
const MAX_RETRY_AFTER_SECS: u64 = 120;

pub trait JotformReadOnlyApi {
    const WRITE_CAPABILITY: bool = false;
}

pub struct JotformClient {
    api_key: String,
    base: String,
    http: reqwest::Client,
}

impl JotformReadOnlyApi for JotformClient {}

impl JotformClient {
    pub fn new(api_key: String) -> Self {
        Self::new_with_base(api_key, BASE_URL.to_string())
    }

    pub fn new_with_base(api_key: String, base: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("build reqwest client for JotformClient");
        Self {
            api_key,
            base: base.trim_end_matches('/').to_string(),
            http,
        }
    }

    pub async fn current_user_with_key(api_key: String) -> anyhow::Result<JotformUser> {
        Self::new(api_key).current_user().await
    }

    pub async fn current_user(&self) -> anyhow::Result<JotformUser> {
        let resp: JotformUserResponse = self.get_json("/user", &[]).await?;
        Ok(resp.content)
    }

    pub async fn list_forms(&self) -> anyhow::Result<Vec<JotformForm>> {
        let resp: JotformFormsResponse = self.get_json("/user/forms", &[]).await?;
        Ok(resp.content)
    }

    pub async fn list_form_submissions(
        &self,
        form_id: &str,
        offset: u32,
    ) -> anyhow::Result<Vec<JotformSubmission>> {
        let path = format!("/form/{form_id}/submissions");
        let resp: JotformSubmissionsResponse = self
            .get_json(
                &path,
                &[("limit", PAGE_LIMIT.to_string()), ("offset", offset.to_string())],
            )
            .await?;
        Ok(resp.content)
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
            let mut req = self.http.get(&url).query(&[("APIKEY", self.api_key.as_str())]);
            for (key, value) in query {
                req = req.query(&[(*key, value.as_str())]);
            }
            let resp = req.send().await.context("Jotform HTTP GET send")?;
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
            let body = resp.text().await.context("read Jotform response body")?;
            if !status.is_success() {
                log::warn!("Jotform GET failed: HTTP {} at {}", status, path);
                anyhow::bail!("Jotform request failed (HTTP {})", status);
            }
            return serde_json::from_str(&body).context("parse Jotform JSON response");
        }

        anyhow::bail!(
            "Jotform throttled past retry budget ({} attempts)",
            MAX_429_RETRIES
        )
    }
}

fn retry_delay(retry_after: Option<&str>, attempt: u32) -> Duration {
    if let Some(header) = retry_after {
        if let Ok(secs) = header.trim().parse::<u64>() {
            return Duration::from_secs(secs.min(MAX_RETRY_AFTER_SECS));
        }
    }
    Duration::from_secs((1u64 << attempt).min(MAX_RETRY_AFTER_SECS))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jotform_client_is_structurally_read_only() {
        fn assert_read_only<T: JotformReadOnlyApi>() {
            assert!(!T::WRITE_CAPABILITY);
        }
        assert_read_only::<JotformClient>();
    }

    #[test]
    fn client_source_has_no_write_http_methods() {
        let source = include_str!("client.rs");
        for (prefix, suffix) in [
            (".po", "st("),
            (".pu", "t("),
            (".pa", "tch("),
            (".de", "lete("),
        ] {
            let needle = format!("{prefix}{suffix}");
            assert!(!source.contains(&needle), "found write method {needle}");
        }
    }
}

//! Read-only Calendly API client.
//!
//! Auth uses a Calendly Personal Access Token with the API v2 Bearer header.
//! This client intentionally exposes only GET-backed methods.

use std::time::Duration;

use anyhow::Context;

use crate::commands::calendly::model::{
    CalendlyEventResponse, CalendlyEventsResponse, CalendlyInviteesResponse,
    CalendlyScheduledEvent, CalendlyUser, CalendlyUserResponse, DEFAULT_COUNT,
};

const BASE_URL: &str = "https://api.calendly.com";
const MAX_RETRY_AFTER_SECS: u64 = 120;
const MAX_429_RETRIES: u32 = 6;

pub struct CalendlyClient {
    token: String,
    base: String,
    user_uri: String,
    http: reqwest::Client,
    network_policy: Option<(
        crate::network_policy::NetworkPolicy,
        crate::network_policy::EgressOperation,
    )>,
}

impl CalendlyClient {
    pub fn new(token: String, user_uri: String) -> Self {
        Self::new_with_base(token, user_uri, BASE_URL.to_string())
    }

    pub fn new_with_base(token: String, user_uri: String, base: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("build reqwest client for CalendlyClient");
        Self {
            token,
            base,
            user_uri,
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
            anyhow::bail!("CalendlyClient requires a NetworkPolicy before it can make a request");
        };
        let authorized = crate::commands::connector_network::authorize_url(policy, operation, url)?;
        crate::commands::connector_network::await_authorized(policy, &authorized, async move {
            Ok(request.send().await?)
        })
        .await
    }

    pub async fn current_user_with_token(token: String) -> anyhow::Result<CalendlyUser> {
        Self::current_user_with_base(token, BASE_URL.to_string()).await
    }

    pub async fn current_user_with_token_and_policy(
        token: String,
        policy: crate::network_policy::NetworkPolicy,
    ) -> anyhow::Result<CalendlyUser> {
        Self::new(token, String::new())
            .with_network_policy(policy, crate::network_policy::CALENDLY_SYNC)
            .current_user()
            .await
    }

    pub async fn current_user_with_base(
        token: String,
        base: String,
    ) -> anyhow::Result<CalendlyUser> {
        let client = Self::new_with_base(token, String::new(), base);
        client.current_user().await
    }

    pub async fn current_user(&self) -> anyhow::Result<CalendlyUser> {
        let body = self.get_json("/users/me", &[]).await?;
        let parsed: CalendlyUserResponse =
            serde_json::from_value(body).context("deserialize Calendly current user")?;
        Ok(parsed.resource)
    }

    pub async fn list_scheduled_events(
        &self,
        page_token: Option<&str>,
    ) -> anyhow::Result<CalendlyEventsResponse> {
        let mut query = vec![
            ("user", self.user_uri.clone()),
            ("count", DEFAULT_COUNT.to_string()),
            ("sort", "start_time:desc".to_string()),
        ];
        if let Some(token) = page_token {
            if !token.trim().is_empty() {
                query.push(("page_token", token.to_string()));
            }
        }
        let body = self.get_json("/scheduled_events", &query).await?;
        serde_json::from_value(body).context("deserialize Calendly scheduled events")
    }

    pub async fn get_scheduled_event(&self, uuid: &str) -> anyhow::Result<CalendlyScheduledEvent> {
        let body = self
            .get_json(&format!("/scheduled_events/{}", uuid), &[])
            .await?;
        let parsed: CalendlyEventResponse =
            serde_json::from_value(body).context("deserialize Calendly scheduled event")?;
        Ok(parsed.resource)
    }

    pub async fn list_event_invitees(
        &self,
        uuid: &str,
    ) -> anyhow::Result<Vec<crate::commands::calendly::model::CalendlyInvitee>> {
        let mut out = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let mut query = vec![("count", DEFAULT_COUNT.to_string())];
            if let Some(token) = page_token.as_deref() {
                query.push(("page_token", token.to_string()));
            }
            let body = self
                .get_json(&format!("/scheduled_events/{}/invitees", uuid), &query)
                .await?;
            let parsed: CalendlyInviteesResponse =
                serde_json::from_value(body).context("deserialize Calendly invitees")?;
            out.extend(parsed.collection);
            page_token = parsed.pagination.next_page_token;
            if page_token.as_deref().unwrap_or("").is_empty() {
                break;
            }
        }
        Ok(out)
    }

    async fn get_json(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> anyhow::Result<serde_json::Value> {
        let url = if path.starts_with("http") {
            path.to_string()
        } else {
            format!("{}{}", self.base, path)
        };

        for attempt in 0..MAX_429_RETRIES {
            let mut req = self.http.get(&url).bearer_auth(&self.token);
            for (k, v) in query {
                req = req.query(&[(*k, v.as_str())]);
            }
            let resp = self.send(&url, req).await.context("Calendly HTTP send")?;
            if resp.status().as_u16() == 429 {
                let retry_after = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);
                tokio::time::sleep(retry_delay(retry_after.as_deref(), attempt)).await;
                continue;
            }

            let status = resp.status();
            let body = resp.text().await.context("read Calendly response body")?;
            if !status.is_success() {
                log::warn!("Calendly request failed: HTTP {} at {}", status, path);
                anyhow::bail!("Calendly request failed (HTTP {})", status);
            }
            return serde_json::from_str(&body).context("parse Calendly JSON response");
        }
        anyhow::bail!(
            "Calendly: throttled past retry budget ({} attempts)",
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
    let secs = (1u64 << attempt).min(MAX_RETRY_AFTER_SECS);
    Duration::from_secs(secs)
}

#[cfg(test)]
mod tests {
    #[test]
    fn calendly_client_exposes_no_write_methods() {
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
}

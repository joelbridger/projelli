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
/// Safety cap on form-list pagination (PAGE_LIMIT forms per page). Far above any
/// real account; prevents an unbounded loop if the API never returns a short page.
const MAX_FORM_PAGES: u32 = 1000;

pub trait JotformReadOnlyApi {
    const WRITE_CAPABILITY: bool = false;
}

pub struct JotformClient {
    api_key: String,
    base: String,
    http: reqwest::Client,
    network_policy: Option<(
        crate::network_policy::NetworkPolicy,
        crate::network_policy::EgressOperation,
    )>,
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
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("build reqwest client for JotformClient");
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
    fn authorize_request(
        &self,
        url: &str,
    ) -> anyhow::Result<
        Option<(
            crate::network_policy::NetworkPolicy,
            crate::network_policy::AuthorizedGeneration,
        )>,
    > {
        let Some((policy, operation)) = self.network_policy.as_ref() else {
            #[cfg(test)]
            return Ok(None);
            #[cfg(not(test))]
            anyhow::bail!("JotformClient requires a NetworkPolicy before it can make a request");
        };
        let authorized = crate::commands::connector_network::authorize_url(policy, operation, url)?;
        Ok(Some((policy.clone(), authorized)))
    }

    async fn send_authorized(
        &self,
        authorization: Option<(
            crate::network_policy::NetworkPolicy,
            crate::network_policy::AuthorizedGeneration,
        )>,
        request: reqwest::RequestBuilder,
    ) -> anyhow::Result<reqwest::Response> {
        match authorization {
            Some((policy, authorized)) => {
                crate::commands::connector_network::await_authorized(
                    &policy,
                    &authorized,
                    async move { Ok(request.send().await?) },
                )
                .await
            }
            #[cfg(test)]
            None => Ok(request.send().await?),
            #[cfg(not(test))]
            None => unreachable!("production requests always require authorization"),
        }
    }

    pub async fn current_user_with_key(api_key: String) -> anyhow::Result<JotformUser> {
        Self::new(api_key).current_user().await
    }

    pub async fn current_user_with_key_and_policy(
        api_key: String,
        policy: crate::network_policy::NetworkPolicy,
    ) -> anyhow::Result<JotformUser> {
        Self::new(api_key)
            .with_network_policy(policy, crate::network_policy::JOTFORM_SYNC)
            .current_user()
            .await
    }

    pub async fn current_user(&self) -> anyhow::Result<JotformUser> {
        let resp: JotformUserResponse = self.get_json("/user", &[]).await?;
        Ok(resp.content)
    }

    pub async fn list_forms(&self) -> anyhow::Result<Vec<JotformForm>> {
        // Paginate the FULL form list. If we only read the first page, a larger
        // account's later-page forms would be invisible to a sync, and the
        // stale-prune pass would then treat their submissions as "vanished" and
        // delete them (silent data loss). Fetching every page keeps the prune's
        // "complete scan" assumption true.
        let mut out = Vec::new();
        let mut offset = 0u32;
        let mut pages = 0u32;
        loop {
            pages += 1;
            if pages > MAX_FORM_PAGES {
                anyhow::bail!("Jotform form pagination exceeded the safety limit");
            }
            let resp: JotformFormsResponse = self
                .get_json(
                    "/user/forms",
                    &[
                        ("limit", PAGE_LIMIT.to_string()),
                        ("offset", offset.to_string()),
                    ],
                )
                .await?;
            let page_len = resp.content.len() as u32;
            out.extend(resp.content);
            if page_len < PAGE_LIMIT {
                break;
            }
            offset += PAGE_LIMIT;
        }
        Ok(out)
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
                &[
                    ("limit", PAGE_LIMIT.to_string()),
                    ("offset", offset.to_string()),
                ],
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
            // This must happen before constructing the request because Jotform
            // puts its API key in the query string.
            let authorization = self.authorize_request(&url)?;
            let mut req = self
                .http
                .get(&url)
                .query(&[("APIKEY", self.api_key.as_str())]);
            for (key, value) in query {
                req = req.query(&[(*key, value.as_str())]);
            }
            let resp = self
                .send_authorized(authorization, req)
                .await
                .context("Jotform HTTP GET send")?;
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
            let (policy, operation) = self.network_policy.as_ref().ok_or_else(|| {
                anyhow::anyhow!("JotformClient requires a NetworkPolicy before it can read a response")
            })?;
            let body_url = resp.url().as_str().to_string();
            let body_grant = crate::commands::connector_network::authorize_url(policy, operation, &body_url)?;
            let body = crate::commands::connector_network::await_authorized(policy, &body_grant, async {
                Ok(resp.text().await?)
            })
            .await
            .context("read Jotform response body")?;
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

    #[tokio::test]
    async fn list_forms_paginates_every_page() {
        // P1: a larger account's forms span multiple /user/forms pages. list_forms
        // must fetch them ALL, or a sync would miss later-page forms and the
        // stale-prune pass would delete their submissions as "vanished".
        use wiremock::matchers::{method, path, query_param};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        // Page 1: a FULL page (PAGE_LIMIT forms) signals "there may be more".
        let page1: Vec<_> = (0..PAGE_LIMIT)
            .map(|i| serde_json::json!({ "id": format!("f{i}"), "title": format!("Form {i}") }))
            .collect();
        Mock::given(method("GET"))
            .and(path("/user/forms"))
            .and(query_param("offset", "0"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({ "content": page1 })),
            )
            .mount(&server)
            .await;
        // Page 2: a SHORT page ends pagination.
        let page2: Vec<_> = (PAGE_LIMIT..PAGE_LIMIT + 5)
            .map(|i| serde_json::json!({ "id": format!("f{i}"), "title": format!("Form {i}") }))
            .collect();
        Mock::given(method("GET"))
            .and(path("/user/forms"))
            .and(query_param("offset", PAGE_LIMIT.to_string()))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({ "content": page2 })),
            )
            .mount(&server)
            .await;

        let policy = crate::network_policy::NetworkPolicy::load_from_directory(
            &tempfile::tempdir().unwrap().keep(),
        );
        let client = JotformClient::new_with_base("k".into(), server.uri())
            .with_network_policy(policy, crate::network_policy::LOCAL_LLAMA);
        let forms = client.list_forms().await.unwrap();
        assert_eq!(forms.len() as u32, PAGE_LIMIT + 5);
        assert_eq!(forms.first().unwrap().form_id, "f0");
        assert_eq!(
            forms.last().unwrap().form_id,
            format!("f{}", PAGE_LIMIT + 4)
        );
    }
}

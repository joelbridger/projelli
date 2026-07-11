//! HTTP client for the read-only Addepar API surface used by Advisor Prep Hero.
//!
//! Addepar's Portfolio Query API uses POST for read-only analysis queries, so
//! the POST bodies stay isolated here. No create/update/delete endpoints are
//! exposed by this connector.

use std::time::Duration;

use anyhow::{Context, Result};
use serde_json::json;

use crate::commands::addepar::model::{
    AddeparCollection, AddeparConfig, AddeparEntity, AddeparEntityAttributes,
    AddeparHouseholdRecord, AddeparPortfolioQueryResponse,
};

#[derive(Clone)]
pub struct AddeparClient {
    http: reqwest::Client,
    config: AddeparConfig,
    network_policy: Option<(
        crate::network_policy::NetworkPolicy,
        crate::network_policy::EgressOperation,
    )>,
}

impl AddeparClient {
    pub fn new(config: AddeparConfig) -> Self {
        Self {
            http: reqwest::Client::builder()
                .user_agent("Advisor Prep Hero-Addepar-Connector/1.0")
                .redirect(reqwest::redirect::Policy::none())
                // Without these, a stalled connection or a non-responding
                // Addepar host left every "Connecting…"/"Syncing…" state in
                // the UI hung forever, with no error and no way to recover
                // short of restarting the app. Matches the other connector
                // clients (docusign, boxc, crm, zocks, jotform, calendly).
                .timeout(Duration::from_secs(60))
                .connect_timeout(Duration::from_secs(15))
                .build()
                .expect("build Addepar reqwest client"),
            config,
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
            anyhow::bail!("AddeparClient requires a NetworkPolicy before it can make a request");
        };
        let configured_host = reqwest::Url::parse(&self.config.api_base()?)
            .ok()
            .and_then(|url| url.host_str().map(str::to_owned))
            .ok_or_else(|| anyhow::anyhow!("Addepar API base has no host"))?;
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

    #[cfg(test)]
    pub fn new_with_base(mut config: AddeparConfig, base_url: String) -> Self {
        config.subdomain = base_url
            .trim()
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches("/api/v1")
            .trim_end_matches(".addepar.com")
            .to_string();
        Self::new(config)
    }

    pub async fn validate(&self) -> Result<()> {
        let _: AddeparCollection<AddeparEntityAttributes> =
            self.get_json("/entities?page[limit]=1").await?;
        Ok(())
    }

    pub async fn list_entities(&self) -> Result<Vec<AddeparEntity>> {
        let mut out = Vec::new();
        let mut next: Option<String> = Some(
            "/entities?page[limit]=200&filter[model_types]=PERSON_NODE,CLIENT,HOUSEHOLD".into(),
        );
        let mut pages = 0u32;
        while let Some(path_or_url) = next.take() {
            pages += 1;
            if pages > 50 {
                anyhow::bail!("Addepar entity pagination exceeded the safety limit");
            }
            let page: AddeparCollection<AddeparEntityAttributes> =
                self.get_json(&path_or_url).await?;
            out.extend(
                page.data
                    .into_iter()
                    .filter(|entity| entity.is_household_or_client()),
            );
            next = page
                .links
                .and_then(|links| links.next)
                .filter(|s| !s.trim().is_empty());
        }
        Ok(out)
    }

    pub async fn household_record(&self, entity: &AddeparEntity) -> Result<AddeparHouseholdRecord> {
        let mut warnings = Vec::new();

        let asset_allocation = match self
            .portfolio_query(entity, &["value"], &["asset_class"], 365)
            .await
        {
            Ok(v) => Some(v),
            Err(e) => {
                warnings.push(format!("Asset-allocation query unavailable: {e}"));
                None
            }
        };

        let performance = match self
            .portfolio_query(
                entity,
                &["time_weighted_return", "value"],
                &["asset_class"],
                365,
            )
            .await
        {
            Ok(v) => Some(v),
            Err(e) => {
                warnings.push(format!("Performance query unavailable: {e}"));
                None
            }
        };

        let account_list = match self
            .portfolio_query(entity, &["value"], &["owning_account"], 365)
            .await
        {
            Ok(v) => Some(v),
            Err(e) => {
                warnings.push(format!("Account-list query unavailable: {e}"));
                None
            }
        };

        Ok(AddeparHouseholdRecord {
            entity: entity.clone(),
            asset_allocation,
            performance,
            account_list,
            warnings,
        })
    }

    async fn portfolio_query(
        &self,
        entity: &AddeparEntity,
        columns: &[&str],
        groupings: &[&str],
        lookback_days: i64,
    ) -> Result<AddeparPortfolioQueryResponse> {
        let end = chrono::Utc::now().date_naive();
        let start = end - chrono::Duration::days(lookback_days);
        let portfolio_id = parse_portfolio_id(&entity.id);
        let body = json!({
            "data": {
                "type": "portfolio_query",
                "attributes": {
                    "columns": columns.iter().map(|key| json!({ "key": key })).collect::<Vec<_>>(),
                    "groupings": groupings.iter().map(|key| json!({ "key": key })).collect::<Vec<_>>(),
                    "portfolio_type": "ENTITY",
                    "portfolio_id": portfolio_id,
                    "start_date": start.format("%Y-%m-%d").to_string(),
                    "end_date": end.format("%Y-%m-%d").to_string(),
                    "hide_previous_holdings": true
                }
            }
        });
        self.post_json("/portfolio/query", &body).await
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, path_or_url: &str) -> Result<T> {
        let url = self.url(path_or_url)?;
        let req = self
            .http
            .get(&url)
            .basic_auth(&self.config.api_key, Some(&self.config.api_secret))
            .header("Addepar-Firm", self.config.firm_id.trim())
            .header("Accept", "application/vnd.api+json");
        let resp = self
            .send(&url, req)
            .await
            .context("Addepar HTTP GET send")?;
        let (policy, operation) = self
            .network_policy
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("AddeparClient requires a NetworkPolicy before it can read a response"))?;
        Self::parse_response(resp, policy, operation, "GET", path_or_url).await
    }

    async fn post_json<T: serde::de::DeserializeOwned>(
        &self,
        path_or_url: &str,
        body: &serde_json::Value,
    ) -> Result<T> {
        let url = self.url(path_or_url)?;
        let req = self
            .http
            .post(&url)
            .basic_auth(&self.config.api_key, Some(&self.config.api_secret))
            .header("Addepar-Firm", self.config.firm_id.trim())
            .header("Accept", "application/vnd.api+json")
            .header("Content-Type", "application/vnd.api+json")
            .json(body);
        let resp = self
            .send(&url, req)
            .await
            .context("Addepar HTTP POST send")?;
        let (policy, operation) = self
            .network_policy
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("AddeparClient requires a NetworkPolicy before it can read a response"))?;
        Self::parse_response(resp, policy, operation, "POST", path_or_url).await
    }

    async fn parse_response<T: serde::de::DeserializeOwned>(
        resp: reqwest::Response,
        policy: &crate::network_policy::NetworkPolicy,
        operation: &crate::network_policy::EgressOperation,
        method: &str,
        path: &str,
    ) -> Result<T> {
        let status = resp.status();
        let body_url = resp.url().as_str().to_string();
        let body_grant = crate::commands::connector_network::authorize_url(policy, operation, &body_url)?;
        let body = crate::commands::connector_network::await_authorized(policy, &body_grant, async {
            Ok(resp.text().await?)
        })
        .await
        .context("read Addepar response body")?;
        if !status.is_success() {
            log::warn!(
                "Addepar request failed: {} {} HTTP {}",
                method,
                path,
                status
            );
            anyhow::bail!("Addepar request failed (HTTP {})", status);
        }
        serde_json::from_str(&body).context("parse Addepar JSON response")
    }

    fn url(&self, path_or_url: &str) -> Result<String> {
        // api_base() validates the configured host (P1-B) and fails closed.
        let base = self.config.api_base()?;
        if path_or_url.starts_with("http://") || path_or_url.starts_with("https://") {
            // Absolute links come from `links.next` in the API response; never
            // send the Basic-auth credentials off the configured Addepar origin
            // (P1-C).
            crate::commands::connector::assert_same_origin(&base, path_or_url)?;
            return Ok(path_or_url.to_string());
        }
        if path_or_url.starts_with('/') {
            Ok(format!("{base}{path_or_url}"))
        } else {
            Ok(format!("{base}/{path_or_url}"))
        }
    }
}

fn parse_portfolio_id(entity_id: &str) -> serde_json::Value {
    entity_id
        .trim()
        .parse::<u64>()
        .map(serde_json::Value::from)
        .unwrap_or_else(|_| serde_json::Value::String(entity_id.trim().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client(subdomain: &str) -> AddeparClient {
        AddeparClient::new(AddeparConfig {
            api_key: "k".into(),
            api_secret: "s".into(),
            subdomain: subdomain.into(),
            firm_id: "1".into(),
        })
    }

    #[test]
    fn url_builds_relative_paths_against_configured_host() {
        let c = client("acme");
        assert_eq!(
            c.url("/entities").unwrap(),
            "https://acme.addepar.com/api/v1/entities"
        );
    }

    #[test]
    fn url_rejects_absolute_links_to_a_foreign_origin() {
        // P1-C: a links.next pointing off the configured Addepar host must be
        // refused before the Basic-auth credentials are attached.
        let c = client("acme");
        assert!(c
            .url("https://acme.addepar.com/api/v1/entities?page[after]=2")
            .is_ok());
        assert!(c.url("https://evil.example.com/api/v1/entities").is_err());
        assert!(c.url("http://acme.addepar.com/api/v1/entities").is_err());
    }

    #[test]
    fn url_fails_closed_on_invalid_subdomain() {
        // P1-B propagates through url(): an unusable host can't produce a request.
        let c = client("attacker.example/foo");
        assert!(c.url("/entities").is_err());
    }
}

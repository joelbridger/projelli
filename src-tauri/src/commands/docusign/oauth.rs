//! DocuSign OAuth Authorization Code + PKCE.
//!
//! DocuSign has no read-only eSignature scope. We request `signature extended`
//! for access + refresh, then the read-only safety boundary lives in
//! `client.rs`, where only GET endpoints exist.

use anyhow::Context;

use crate::commands::docusign::model::{
    DocusignAccountInfo, DocusignConnection, DocusignEnvironment,
};

pub const DOCUSIGN_SCOPES: &str = "signature extended";
const KEYCHAIN_SERVICE: &str = crate::identity::DOCUSIGN_SERVICE;
const KEYCHAIN_CONNECTION_KEY: &str = "connection-v1";
const DEFAULT_DEMO_CLIENT_ID: &str = "LANTERN_DOCUSIGN_CLIENT_ID_REQUIRED";

#[derive(Debug, Clone)]
pub struct DocusignTokens {
    pub access: String,
    pub refresh: String,
    pub expires_in: u64,
}

#[derive(Clone)]
pub struct DocusignOAuth {
    client_id: String,
    oauth_base: String,
    environment: DocusignEnvironment,
    http: reqwest::Client,
}

impl DocusignOAuth {
    pub fn new(client_id: String, environment: DocusignEnvironment) -> Self {
        Self::new_with_base(client_id, environment.oauth_base().to_string(), environment)
    }

    pub fn new_with_base(
        client_id: String,
        oauth_base: String,
        environment: DocusignEnvironment,
    ) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("build reqwest client for DocusignOAuth");
        Self {
            client_id,
            oauth_base: oauth_base.trim_end_matches('/').to_string(),
            environment,
            http,
        }
    }

    pub fn environment(&self) -> DocusignEnvironment {
        self.environment
    }

    pub fn build_auth_url(&self, redirect_uri: &str, code_challenge: &str, state: &str) -> String {
        build_auth_url(
            &self.oauth_base,
            &self.client_id,
            redirect_uri,
            code_challenge,
            state,
        )
    }

    pub async fn exchange_code(
        &self,
        code: &str,
        code_verifier: &str,
        redirect_uri: &str,
    ) -> anyhow::Result<DocusignTokens> {
        let url = format!("{}/oauth/token", self.oauth_base);
        let resp = self
            .http
            .post(&url)
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", self.client_id.as_str()),
                ("code", code),
                ("code_verifier", code_verifier),
                ("redirect_uri", redirect_uri),
            ])
            .send()
            .await
            .context("DocuSign token exchange send")?;
        let status = resp.status().as_u16();
        let body: serde_json::Value = resp.json().await.context("DocuSign token JSON")?;
        parse_token_response(status, &body)
    }

    pub async fn refresh(&self, refresh_token: &str) -> anyhow::Result<DocusignTokens> {
        let url = format!("{}/oauth/token", self.oauth_base);
        let resp = self
            .http
            .post(&url)
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", self.client_id.as_str()),
                ("refresh_token", refresh_token),
            ])
            .send()
            .await
            .context("DocuSign token refresh send")?;
        let status = resp.status().as_u16();
        let body: serde_json::Value = resp.json().await.context("DocuSign refresh JSON")?;
        parse_token_response(status, &body)
    }

    pub async fn userinfo(&self, access_token: &str) -> anyhow::Result<DocusignAccountInfo> {
        #[derive(serde::Deserialize, Default)]
        #[serde(default)]
        struct UserInfo {
            accounts: Vec<DocusignAccountInfo>,
        }
        let url = format!("{}/oauth/userinfo", self.oauth_base);
        let info: UserInfo = self
            .http
            .get(&url)
            .bearer_auth(access_token)
            .send()
            .await
            .context("DocuSign userinfo GET")?
            .error_for_status()
            .context("DocuSign userinfo status")?
            .json()
            .await
            .context("DocuSign userinfo JSON")?;
        pick_account(info.accounts)
    }
}

pub fn client_id() -> String {
    std::env::var("LANTERN_DOCUSIGN_CLIENT_ID")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_DEMO_CLIENT_ID.to_string())
}

pub fn build_auth_url(
    oauth_base: &str,
    client_id: &str,
    redirect_uri: &str,
    code_challenge: &str,
    state: &str,
) -> String {
    use crate::commands::mail::gmail::oauth::urlencoding_encode;
    format!(
        "{}/oauth/auth?response_type=code&scope={}&client_id={}&redirect_uri={}&code_challenge={}&code_challenge_method=S256&state={}",
        oauth_base.trim_end_matches('/'),
        urlencoding_encode(DOCUSIGN_SCOPES),
        urlencoding_encode(client_id),
        urlencoding_encode(redirect_uri),
        urlencoding_encode(code_challenge),
        urlencoding_encode(state),
    )
}

pub fn parse_token_response(
    status: u16,
    body: &serde_json::Value,
) -> anyhow::Result<DocusignTokens> {
    if status == 200 {
        let access = body
            .get("access_token")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let refresh = body
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if access.is_empty() {
            anyhow::bail!("DocuSign token response had no access_token");
        }
        if refresh.is_empty() {
            anyhow::bail!("DocuSign token response had no refresh_token; ensure extended scope");
        }
        return Ok(DocusignTokens {
            access: access.to_string(),
            refresh: refresh.to_string(),
            expires_in: body
                .get("expires_in")
                .and_then(|v| v.as_u64())
                .unwrap_or(3600),
        });
    }
    let err = body
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown error");
    anyhow::bail!("DocuSign token request failed (http {status}): {err}")
}

pub fn pick_account(accounts: Vec<DocusignAccountInfo>) -> anyhow::Result<DocusignAccountInfo> {
    accounts
        .iter()
        .find(|account| account.is_default)
        .cloned()
        .or_else(|| accounts.into_iter().next())
        .ok_or_else(|| anyhow::anyhow!("DocuSign userinfo returned no accounts"))
}

pub fn store_connection(connection: &DocusignConnection) -> anyhow::Result<()> {
    let json = serde_json::to_string(connection).context("serialize DocuSign connection")?;
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_CONNECTION_KEY)
        .context("DocuSign keychain entry")?
        .set_password(&json)
        .context("store DocuSign connection")
}

pub fn read_connection() -> anyhow::Result<Option<DocusignConnection>> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_CONNECTION_KEY)
        .context("DocuSign keychain entry")?;
    match entry.get_password() {
        Ok(json) => Ok(Some(
            serde_json::from_str(&json).context("parse DocuSign connection")?,
        )),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(anyhow::anyhow!("DocuSign keychain read: {e}")),
    }
}

pub fn delete_connection() -> anyhow::Result<()> {
    match keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_CONNECTION_KEY)
        .context("DocuSign keychain entry")?
        .delete_credential()
    {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(anyhow::anyhow!("DocuSign keychain delete: {e}")),
    }
}

pub async fn fresh_access_token(
    connection: &DocusignConnection,
) -> anyhow::Result<(String, DocusignConnection)> {
    let env = if connection.environment == "production" {
        DocusignEnvironment::Production
    } else {
        DocusignEnvironment::Demo
    };
    let oauth = DocusignOAuth::new(client_id(), env);
    let tokens = oauth.refresh(&connection.refresh_token).await?;
    let mut updated = connection.clone();
    updated.refresh_token = tokens.refresh;
    store_connection(&updated)?;
    Ok((tokens.access, updated))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_url_uses_signature_extended_pkce_without_secret() {
        // BOUND: `url.contains("scope=signature%20extended")` is a PREFIX match on a
        // query parameter — "signature extended impersonation" still contains it, and
        // did pass. Exactness lives in src/scope_freeze.rs.
        let url = build_auth_url(
            "https://account-d.docusign.com",
            "client-1",
            "http://127.0.0.1:1234",
            "challenge",
            "state",
        );
        assert!(url.starts_with("https://account-d.docusign.com/oauth/auth?"));
        assert!(url.contains("scope=signature%20extended"));
        assert!(url.contains("code_challenge=challenge"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=state"));
        assert!(!url.contains("client_secret"));
    }

    #[test]
    fn pick_account_prefers_default_else_first() {
        let first = DocusignAccountInfo {
            account_id: "a1".into(),
            account_name: "First".into(),
            base_uri: "https://demo.docusign.net".into(),
            is_default: false,
        };
        let default = DocusignAccountInfo {
            account_id: "a2".into(),
            account_name: "Default".into(),
            base_uri: "https://demo.docusign.net".into(),
            is_default: true,
        };
        assert_eq!(
            pick_account(vec![first.clone(), default.clone()])
                .unwrap()
                .account_id,
            "a2"
        );
        assert_eq!(pick_account(vec![first]).unwrap().account_id, "a1");
    }

    #[test]
    fn userinfo_accounts_deserialize_real_snake_case_shape_and_pick_default() {
        #[derive(serde::Deserialize, Default)]
        #[serde(default)]
        struct UserInfo {
            accounts: Vec<DocusignAccountInfo>,
        }

        let payload = r#"{
            "sub": "00000000-0000-0000-0000-000000000000",
            "name": "Advisor User",
            "email": "advisor@example.com",
            "accounts": [
                {
                    "account_id": "acct-non-default",
                    "account_name": "Non Default Account",
                    "base_uri": "https://demo.docusign.net",
                    "is_default": false,
                    "organization": {
                        "organization_id": "org-1",
                        "links": []
                    }
                },
                {
                    "account_id": "acct-default",
                    "account_name": "Default Account",
                    "base_uri": "https://na4.docusign.net",
                    "is_default": true,
                    "organization": {
                        "organization_id": "org-2",
                        "links": []
                    }
                }
            ]
        }"#;

        let info: UserInfo = serde_json::from_str(payload).unwrap();
        let selected = pick_account(info.accounts).unwrap();

        assert_eq!(selected.account_id, "acct-default");
        assert_eq!(selected.account_name, "Default Account");
        assert_eq!(selected.base_uri, "https://na4.docusign.net");
        assert!(selected.is_default);
    }
}

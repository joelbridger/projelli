pub const SCOPES: &str = "offline_access openid User.Read Files.Read.All Sites.Read.All";

const MS_AUTH_ENDPOINT: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
pub const MS_TOKEN_ENDPOINT: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

#[derive(Debug, Clone)]
pub struct MsTokens {
    pub access: String,
    pub refresh: String,
    pub expires_in: u64,
}

#[derive(Debug)]
pub enum TokenOutcome {
    Tokens {
        access: String,
        refresh: Option<String>,
        expires_in: u64,
    },
    Pending,
    SlowDown,
    Failed(String),
}

#[derive(Debug, Clone)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval_secs: u64,
    pub expires_in_secs: u64,
}

pub fn build_ms_auth_url(
    client_id: &str,
    redirect_uri: &str,
    code_challenge: &str,
    state: &str,
) -> String {
    use crate::commands::mail::gmail::oauth::urlencoding_encode;
    format!(
        "{auth}?client_id={client_id}&redirect_uri={redirect_uri}&response_type=code\
         &scope={scope}&code_challenge={challenge}&code_challenge_method=S256\
         &state={state}&prompt=select_account",
        auth = MS_AUTH_ENDPOINT,
        client_id = urlencoding_encode(client_id),
        redirect_uri = urlencoding_encode(redirect_uri),
        scope = urlencoding_encode(SCOPES),
        challenge = urlencoding_encode(code_challenge),
        state = urlencoding_encode(state),
    )
}

pub async fn ms_exchange_code(
    client_id: &str,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
    token_endpoint: &str,
) -> anyhow::Result<MsTokens> {
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("build reqwest client");

    let resp = http
        .post(token_endpoint)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("code_verifier", code_verifier),
            ("redirect_uri", redirect_uri),
            ("scope", SCOPES),
        ])
        .send()
        .await?;

    let status = resp.status().as_u16();
    let v: serde_json::Value = resp.json().await?;
    parse_ms_token_response(status, &v)
}

fn parse_ms_token_response(status: u16, v: &serde_json::Value) -> anyhow::Result<MsTokens> {
    if status == 200 {
        let access = v.get("access_token").and_then(|s| s.as_str()).unwrap_or("");
        if access.is_empty() {
            anyhow::bail!("MS token response had no access_token");
        }
        let refresh = v
            .get("refresh_token")
            .and_then(|s| s.as_str())
            .unwrap_or("");
        if refresh.is_empty() {
            anyhow::bail!("MS token response had no refresh_token; ensure offline_access scope");
        }
        return Ok(MsTokens {
            access: access.to_string(),
            refresh: refresh.to_string(),
            expires_in: v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(3600),
        });
    }
    let err = v
        .get("error")
        .and_then(|s| s.as_str())
        .unwrap_or("unknown error");
    anyhow::bail!("MS token request failed (http {status}): {err}")
}

pub struct OAuth {
    client_id: String,
    base: String,
    http: reqwest::Client,
}

impl OAuth {
    pub fn new(client_id: String) -> Self {
        Self::new_with_base(client_id, "https://login.microsoftonline.com".into())
    }

    pub fn new_with_base(client_id: String, base: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("build reqwest client");
        Self {
            client_id,
            base,
            http,
        }
    }

    pub async fn request_device_code(&self) -> anyhow::Result<DeviceCode> {
        let url = format!("{}/common/oauth2/v2.0/devicecode", self.base);
        let v: serde_json::Value = self
            .http
            .post(&url)
            .form(&[("client_id", self.client_id.as_str()), ("scope", SCOPES)])
            .send()
            .await?
            .json()
            .await?;
        DeviceCode::from_json(&v).ok_or_else(|| anyhow::anyhow!("bad devicecode response"))
    }

    pub async fn poll_token(&self, device_code: &str) -> anyhow::Result<TokenOutcome> {
        let url = format!("{}/common/oauth2/v2.0/token", self.base);
        let resp = self
            .http
            .post(&url)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("client_id", self.client_id.as_str()),
                ("device_code", device_code),
            ])
            .send()
            .await?;
        let status = resp.status().as_u16();
        let v: serde_json::Value = resp.json().await?;
        Ok(TokenOutcome::from_json(status, &v))
    }

    pub async fn refresh(&self, refresh_token: &str) -> anyhow::Result<TokenOutcome> {
        let url = format!("{}/common/oauth2/v2.0/token", self.base);
        let resp = self
            .http
            .post(&url)
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", self.client_id.as_str()),
                ("scope", SCOPES),
                ("refresh_token", refresh_token),
            ])
            .send()
            .await?;
        let status = resp.status().as_u16();
        let v: serde_json::Value = resp.json().await?;
        Ok(TokenOutcome::from_json(status, &v))
    }
}

impl DeviceCode {
    pub fn from_json(v: &serde_json::Value) -> Option<DeviceCode> {
        Some(DeviceCode {
            device_code: v.get("device_code")?.as_str()?.to_string(),
            user_code: v.get("user_code")?.as_str()?.to_string(),
            verification_uri: v.get("verification_uri")?.as_str()?.to_string(),
            interval_secs: v.get("interval").and_then(|x| x.as_u64()).unwrap_or(5),
            expires_in_secs: v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(900),
        })
    }
}

impl TokenOutcome {
    pub fn from_json(status: u16, v: &serde_json::Value) -> TokenOutcome {
        if status == 200 {
            let access = v.get("access_token").and_then(|s| s.as_str()).unwrap_or("");
            if access.is_empty() {
                return TokenOutcome::Failed("token response had no access_token".into());
            }
            return TokenOutcome::Tokens {
                access: access.to_string(),
                refresh: v
                    .get("refresh_token")
                    .and_then(|s| s.as_str())
                    .map(String::from),
                expires_in: v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(3600),
            };
        }
        match v.get("error").and_then(|s| s.as_str()) {
            Some("authorization_pending") => TokenOutcome::Pending,
            Some("slow_down") => TokenOutcome::SlowDown,
            Some(other) => TokenOutcome::Failed(other.to_string()),
            None => TokenOutcome::Failed(format!("http {status}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_url_uses_docs_scopes() {
        // BOUND: these are `contains` checks — PRESENCE only. They can notice a
        // scope going MISSING; they are structurally blind to one being ADDED
        // (measured: a planted widening left the whole suite green). Exactness
        // lives in src/scope_freeze.rs, which pins this constant token-for-token.
        let url = build_ms_auth_url("client", "http://localhost:1234", "challenge", "state");
        assert!(url.contains("Files.Read.All"));
        assert!(url.contains("Sites.Read.All"));
        assert!(url.contains("offline_access"));
        assert!(!url.contains("Mail.Read"));
    }

    #[test]
    fn empty_access_token_fails() {
        let v = serde_json::json!({ "refresh_token": "RT" });
        assert!(matches!(
            TokenOutcome::from_json(200, &v),
            TokenOutcome::Failed(_)
        ));
    }
}

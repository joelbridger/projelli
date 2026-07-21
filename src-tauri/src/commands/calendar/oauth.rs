//! Calendar OAuth: Microsoft (Calendars.Read) + Google (calendar.readonly).
//! MS token machinery is a scoped copy of `onedrive/oauth.rs` (established
//! per-connector pattern); loopback/PKCE plumbing is reused from
//! `mail::gmail::oauth`.

pub const MS_SCOPES: &str = "offline_access openid User.Read Calendars.Read";
pub const GOOGLE_SCOPE: &str =
    "openid email https://www.googleapis.com/auth/calendar.readonly";

const MS_AUTH_ENDPOINT: &str =
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
pub const MS_TOKEN_ENDPOINT: &str =
    "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GOOGLE_AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";

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
        scope = urlencoding_encode(MS_SCOPES),
        challenge = urlencoding_encode(code_challenge),
        state = urlencoding_encode(state),
    )
}

/// Google auth URL with the calendar scope (the gmail builder hardcodes mail
/// scopes, so calendar carries its own with the same shape:
/// access_type=offline + prompt=consent to always get a refresh token).
pub fn build_google_auth_url(
    client_id: &str,
    redirect_uri: &str,
    code_challenge: &str,
    state: &str,
) -> String {
    use crate::commands::mail::gmail::oauth::urlencoding_encode;
    format!(
        "{auth}?client_id={client_id}&redirect_uri={redirect_uri}&response_type=code\
         &scope={scope}&code_challenge={challenge}&code_challenge_method=S256\
         &state={state}&access_type=offline&prompt=consent",
        auth = GOOGLE_AUTH_ENDPOINT,
        client_id = urlencoding_encode(client_id),
        redirect_uri = urlencoding_encode(redirect_uri),
        scope = urlencoding_encode(GOOGLE_SCOPE),
        challenge = urlencoding_encode(code_challenge),
        state = urlencoding_encode(state),
    )
}

// ── Scoped copy of the MS token machinery (see onedrive/oauth.rs) ──────────
// Copied from src-tauri/src/commands/onedrive/oauth.rs, restricted to the
// pieces the calendar connector needs (loopback+PKCE flow + refresh; no
// device-code flow), with SCOPES swapped for MS_SCOPES.

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
            ("scope", MS_SCOPES),
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

    pub async fn refresh(&self, refresh_token: &str) -> anyhow::Result<TokenOutcome> {
        let url = format!("{}/common/oauth2/v2.0/token", self.base);
        let resp = self
            .http
            .post(&url)
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", self.client_id.as_str()),
                ("scope", MS_SCOPES),
                ("refresh_token", refresh_token),
            ])
            .send()
            .await?;
        let status = resp.status().as_u16();
        let v: serde_json::Value = resp.json().await?;
        Ok(TokenOutcome::from_json(status, &v))
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
    fn ms_auth_url_requests_calendar_read_scope_only() {
        // NAME CORRECTED DOWN in effect: the `_only` in this test's name was never
        // proven by its body — an enumerated two-entry denylist (Files/Mail) cannot
        // establish 'only'. Contacts.Read passed it. `only` is now genuinely proven,
        // but in src/scope_freeze.rs, not here.
        let url = build_ms_auth_url("cid", "http://localhost:1/", "chal", "st");
        assert!(url.contains("Calendars.Read"));
        assert!(!url.contains("Files.Read"), "calendar must not request drive scopes");
        assert!(!url.contains("Mail.Read"), "calendar must not request mail scopes");
        assert!(url.contains("code_challenge_method=S256"));
    }

    #[test]
    fn google_auth_url_requests_calendar_readonly_offline() {
        // BOUND: these are `contains` checks — PRESENCE only. They can notice a
        // scope going MISSING; they are structurally blind to one being ADDED
        // (measured: a planted widening left the whole suite green). Exactness
        // lives in src/scope_freeze.rs, which pins this constant token-for-token.
        let url = build_google_auth_url("cid", "http://127.0.0.1:1/", "chal", "st");
        assert!(url.contains("calendar.readonly"));
        assert!(!url.contains("gmail."), "calendar must not request gmail scopes");
        assert!(url.contains("access_type=offline"));
        assert!(url.contains("prompt=consent"));
    }
}

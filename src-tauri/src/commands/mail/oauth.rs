pub const SCOPES: &str = "offline_access openid User.Read Mail.Read Mail.ReadWrite Mail.Send";

const MS_AUTH_ENDPOINT: &str =
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
pub const MS_TOKEN_ENDPOINT: &str =
    "https://login.microsoftonline.com/common/oauth2/v2.0/token";

// ── Microsoft loopback auth-code + PKCE flow ──────────────────────────────

/// Build the Microsoft authorization URL for the loopback desktop flow.
/// `prompt=select_account` forces account picker so the user is never silently
/// signed in as the wrong account. Microsoft is a public client here — no
/// client_secret is sent.
pub fn build_ms_auth_url(
    client_id: &str,
    redirect_uri: &str,
    code_challenge: &str,
    state: &str,
) -> String {
    use crate::commands::mail::gmail::oauth::urlencoding_encode;
    let encoded_redirect = urlencoding_encode(redirect_uri);
    let encoded_scope = urlencoding_encode(SCOPES);
    let encoded_challenge = urlencoding_encode(code_challenge);
    let encoded_state = urlencoding_encode(state);
    let encoded_client_id = urlencoding_encode(client_id);

    format!(
        "{auth}?client_id={client_id}&redirect_uri={redirect_uri}&response_type=code\
         &scope={scope}&code_challenge={challenge}&code_challenge_method=S256\
         &state={state}&prompt=select_account",
        auth = MS_AUTH_ENDPOINT,
        client_id = encoded_client_id,
        redirect_uri = encoded_redirect,
        scope = encoded_scope,
        challenge = encoded_challenge,
        state = encoded_state,
    )
}

/// Exchange an auth code for MS tokens via the loopback flow (public client,
/// PKCE, no client_secret).
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

#[derive(Debug, Clone)]
pub struct MsTokens {
    pub access: String,
    pub refresh: String,
    pub expires_in: u64,
}

fn parse_ms_token_response(status: u16, v: &serde_json::Value) -> anyhow::Result<MsTokens> {
    if status == 200 {
        let access = v
            .get("access_token")
            .and_then(|s| s.as_str())
            .unwrap_or("");
        if access.is_empty() {
            return Err(anyhow::anyhow!("MS token response had no access_token"));
        }
        let refresh = v
            .get("refresh_token")
            .and_then(|s| s.as_str())
            .unwrap_or("");
        if refresh.is_empty() {
            return Err(anyhow::anyhow!(
                "MS token response had no refresh_token; ensure offline_access scope"
            ));
        }
        return Ok(MsTokens {
            access: access.to_string(),
            refresh: refresh.to_string(),
            expires_in: v
                .get("expires_in")
                .and_then(|x| x.as_u64())
                .unwrap_or(3600),
        });
    }
    let err = v
        .get("error")
        .and_then(|s| s.as_str())
        .unwrap_or("unknown error");
    Err(anyhow::anyhow!("MS token request failed (http {status}): {err}"))
}

pub struct OAuth { client_id: String, base: String, http: reqwest::Client }
impl OAuth {
    pub fn new(client_id: String) -> Self { Self::new_with_base(client_id, "https://login.microsoftonline.com".into()) }
    pub fn new_with_base(client_id: String, base: String) -> Self {
        // Bound device-code polling / refresh requests so a hung connection
        // can't stall the sign-in loop indefinitely.
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("build reqwest client");
        Self { client_id, base, http }
    }
    pub async fn request_device_code(&self) -> anyhow::Result<DeviceCode> {
        let url = format!("{}/common/oauth2/v2.0/devicecode", self.base);
        let v: serde_json::Value = self.http.post(&url)
            .form(&[("client_id", self.client_id.as_str()), ("scope", SCOPES)])
            .send().await?.json().await?;
        DeviceCode::from_json(&v).ok_or_else(|| anyhow::anyhow!("bad devicecode response"))
    }
    /// Poll the token endpoint once. Caller loops on Pending/SlowDown.
    pub async fn poll_token(&self, device_code: &str) -> anyhow::Result<TokenOutcome> {
        let url = format!("{}/common/oauth2/v2.0/token", self.base);
        let resp = self.http.post(&url).form(&[
            ("grant_type","urn:ietf:params:oauth:grant-type:device_code"),
            ("client_id", self.client_id.as_str()),
            ("device_code", device_code),
        ]).send().await?;
        let status = resp.status().as_u16();
        let v: serde_json::Value = resp.json().await?;
        Ok(TokenOutcome::from_json(status, &v))
    }
    /// Exchange a stored refresh token for a fresh access token.
    pub async fn refresh(&self, refresh_token: &str) -> anyhow::Result<TokenOutcome> {
        let url = format!("{}/common/oauth2/v2.0/token", self.base);
        let resp = self.http.post(&url).form(&[
            ("grant_type","refresh_token"),
            ("client_id", self.client_id.as_str()),
            ("scope", SCOPES),
            ("refresh_token", refresh_token),
        ]).send().await?;
        let status = resp.status().as_u16();
        let v: serde_json::Value = resp.json().await?;
        Ok(TokenOutcome::from_json(status, &v))
    }
}

#[derive(Debug, Clone)]
pub struct DeviceCode {
    pub device_code: String, pub user_code: String,
    pub verification_uri: String, pub interval_secs: u64, pub expires_in_secs: u64,
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

#[derive(Debug)]
pub enum TokenOutcome {
    Tokens { access: String, refresh: Option<String>, expires_in: u64 },
    Pending,
    SlowDown,
    Failed(String),
}
impl TokenOutcome {
    pub fn from_json(status: u16, v: &serde_json::Value) -> TokenOutcome {
        if status == 200 {
            // A 200 with no (or empty) access_token is a malformed response;
            // treat it as a failure rather than handing an empty bearer token
            // to the Graph client (which would just 401 with a confusing error).
            let access = v.get("access_token").and_then(|s| s.as_str()).unwrap_or("");
            if access.is_empty() {
                return TokenOutcome::Failed("token response had no access_token".into());
            }
            return TokenOutcome::Tokens {
                access: access.to_string(),
                refresh: v.get("refresh_token").and_then(|s| s.as_str()).map(String::from),
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

    #[tokio::test]
    async fn requests_device_code_from_endpoint() {
        use wiremock::{Mock, MockServer, ResponseTemplate};
        use wiremock::matchers::{method, path};
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/common/oauth2/v2.0/devicecode"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "device_code":"DC","user_code":"WXYZ","verification_uri":"https://microsoft.com/devicelogin",
                "expires_in":900,"interval":5 }))).mount(&server).await;
        let auth = OAuth::new_with_base("client-123".into(), server.uri());
        let dc = auth.request_device_code().await.expect("device code");
        assert_eq!(dc.user_code, "WXYZ");
    }

    #[test]
    fn parses_device_code_response() {
        let j = serde_json::json!({
            "device_code": "DC", "user_code": "ABCD-EFGH",
            "verification_uri": "https://microsoft.com/devicelogin",
            "expires_in": 900, "interval": 5 });
        let d = DeviceCode::from_json(&j).unwrap();
        assert_eq!(d.user_code, "ABCD-EFGH");
        assert_eq!(d.interval_secs, 5);
        assert_eq!(d.verification_uri, "https://microsoft.com/devicelogin");
    }
    #[test]
    fn parses_token_response_and_pending() {
        let ok = serde_json::json!({ "access_token":"AT","refresh_token":"RT","expires_in":3600 });
        match TokenOutcome::from_json(200, &ok) {
            TokenOutcome::Tokens { access, refresh, .. } => { assert_eq!(access,"AT"); assert_eq!(refresh.as_deref(),Some("RT")); }
            _ => panic!("expected tokens"),
        }
        let pending = serde_json::json!({ "error": "authorization_pending" });
        assert!(matches!(TokenOutcome::from_json(400, &pending), TokenOutcome::Pending));
        let slow = serde_json::json!({ "error": "slow_down" });
        assert!(matches!(TokenOutcome::from_json(400, &slow), TokenOutcome::SlowDown));
        let denied = serde_json::json!({ "error": "authorization_declined" });
        assert!(matches!(TokenOutcome::from_json(400, &denied), TokenOutcome::Failed(_)));
    }

    #[test]
    fn empty_access_token_is_treated_as_failure() {
        // A 200 with a missing or empty access_token must not yield Tokens.
        let missing = serde_json::json!({ "refresh_token": "RT", "expires_in": 3600 });
        assert!(matches!(TokenOutcome::from_json(200, &missing), TokenOutcome::Failed(_)));
        let empty = serde_json::json!({ "access_token": "", "refresh_token": "RT" });
        assert!(matches!(TokenOutcome::from_json(200, &empty), TokenOutcome::Failed(_)));
    }

    // ── MS loopback auth-code + PKCE flow ────────────────────────────────────

    #[test]
    fn build_ms_auth_url_contains_required_params() {
        // BOUND: these are `contains` checks — PRESENCE only. They can notice a
        // scope going MISSING; they are structurally blind to one being ADDED
        // (measured: a planted widening left the whole suite green). Exactness
        // lives in src/scope_freeze.rs, which pins this constant token-for-token.
        let url = build_ms_auth_url(
            "my-ms-client",
            "http://127.0.0.1:54321",
            "challenge_abc",
            "state_xyz",
        );
        assert!(url.starts_with(MS_AUTH_ENDPOINT), "URL must start with MS auth endpoint");
        assert!(url.contains("my-ms-client"), "missing client_id");
        assert!(url.contains("127.0.0.1"), "missing loopback host in redirect_uri");
        assert!(url.contains("response_type=code"), "missing response_type=code");
        assert!(url.contains("challenge_abc"), "missing code_challenge");
        assert!(url.contains("code_challenge_method=S256"), "missing S256 method");
        assert!(url.contains("state_xyz"), "missing state");
        assert!(url.contains("prompt=select_account"), "missing prompt=select_account");
        assert!(url.contains("offline_access"), "missing offline_access scope");
        assert!(url.contains("Mail.ReadWrite"), "missing Mail.ReadWrite scope (drafts)");
        assert!(!url.contains("client_secret"), "client_secret must NOT be in the authorize URL");
    }

    #[tokio::test]
    async fn ms_exchange_code_parses_tokens() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/common/oauth2/v2.0/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "AT_ms",
                "refresh_token": "RT_ms",
                "expires_in": 3600,
                "token_type": "Bearer"
            })))
            .mount(&server)
            .await;

        let token_endpoint = format!("{}/common/oauth2/v2.0/token", server.uri());
        let tokens = ms_exchange_code(
            "client-ms",
            "code123",
            "verifier123",
            "http://127.0.0.1:1234",
            &token_endpoint,
        )
        .await
        .expect("ms_exchange_code should succeed");

        assert_eq!(tokens.access, "AT_ms");
        assert_eq!(tokens.refresh, "RT_ms");
        assert_eq!(tokens.expires_in, 3600);
    }

    #[tokio::test]
    async fn ms_exchange_code_no_client_secret_in_body() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        // Register a catch-all mock; then inspect recorded requests to assert
        // no client_secret was included (MS public client must not send one).
        Mock::given(method("POST"))
            .and(path("/common/oauth2/v2.0/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "AT_ms",
                "refresh_token": "RT_ms",
                "expires_in": 3600,
            })))
            .mount(&server)
            .await;

        let token_endpoint = format!("{}/common/oauth2/v2.0/token", server.uri());
        ms_exchange_code("client-ms", "code", "verifier", "http://127.0.0.1:1234", &token_endpoint)
            .await
            .expect("ms_exchange_code should succeed");

        // Inspect the recorded request body to assert no client_secret was sent.
        let received = server.received_requests().await.unwrap();
        assert_eq!(received.len(), 1);
        let body_str = std::str::from_utf8(&received[0].body).unwrap_or("");
        assert!(
            !body_str.contains("client_secret"),
            "MS public client must NOT send client_secret; got: {body_str}"
        );
    }

    #[tokio::test]
    async fn ms_exchange_code_error_propagates() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/common/oauth2/v2.0/token"))
            .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
                "error": "invalid_grant",
                "error_description": "AADSTS70008: The provided authorization code is expired."
            })))
            .mount(&server)
            .await;

        let token_endpoint = format!("{}/common/oauth2/v2.0/token", server.uri());
        let result = ms_exchange_code(
            "client-ms", "bad-code", "verifier", "http://127.0.0.1:1234", &token_endpoint,
        )
        .await;
        assert!(result.is_err(), "error response must propagate as Err");
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("invalid_grant"), "error message must surface MS error: {msg}");
    }

    #[tokio::test]
    async fn ms_exchange_code_missing_refresh_token_errors() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        // 200 but no refresh_token — missing offline_access scope scenario.
        Mock::given(method("POST"))
            .and(path("/common/oauth2/v2.0/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "AT_ms",
                "expires_in": 3600,
            })))
            .mount(&server)
            .await;

        let token_endpoint = format!("{}/common/oauth2/v2.0/token", server.uri());
        let result = ms_exchange_code(
            "client-ms", "code", "verifier", "http://127.0.0.1:1234", &token_endpoint,
        )
        .await;
        assert!(result.is_err(), "missing refresh_token must be Err");
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("refresh_token"), "error must mention refresh_token: {msg}");
    }

    // Live OAuth smoke test for server-side connector validation (no signed build
    // needed). Ignored by default; run manually in two phases:
    //   Phase 1 (no MS_CODE env): prints MS_VERIFIER + MS_AUTH_URL.
    //   Phase 2 (MS_CODE + MS_VERIFIER env): exchanges the real code for tokens.
    #[tokio::test]
    #[ignore]
    async fn outlook_live_smoke() {
        use crate::commands::mail::gmail::oauth::gen_pkce;
        let cid = std::env::var("LANTERN_MS_CLIENT_ID")
            .unwrap_or_else(|_| "845ddba0-70ab-4f90-88ba-e3522157e37a".to_string());
        // Personal Microsoft accounts require "localhost" (not "127.0.0.1") for
        // the loopback redirect to match the http://localhost app registration.
        let redirect = "http://localhost:7777";
        if let Ok(code) = std::env::var("MS_CODE") {
            let verifier = std::env::var("MS_VERIFIER").expect("set MS_VERIFIER");
            match ms_exchange_code(&cid, &code, &verifier, redirect, MS_TOKEN_ENDPOINT).await {
                Ok(t) => eprintln!("MS_RESULT=OK refresh_len={}", t.refresh.len()),
                Err(e) => eprintln!("MS_RESULT=FAIL err={e}"),
            }
        } else {
            let (verifier, challenge) = gen_pkce();
            eprintln!("MS_VERIFIER={verifier}");
            eprintln!("MS_AUTH_URL={}", build_ms_auth_url(&cid, redirect, &challenge, "smoke"));
        }
    }

    // Live END-TO-END import: actually pulls real Outlook mail through the real
    // sync pipeline (the same code the desktop app runs) into a TEMP encrypted
    // store, then queries it the way the Email tab does — to surface real problems
    // no unit test can. Ignored; two phases like outlook_live_smoke:
    //   Phase 1 (no MS_CODE):              prints MS_VERIFIER + MS_AUTH_URL.
    //   Phase 2 (MS_CODE + MS_VERIFIER):   exchanges, imports every folder, reports.
    // Optional env: IMPORT_FOLDER_CAP=N (limit folders), IMPORT_SEARCH=word.
    #[tokio::test]
    #[ignore]
    async fn outlook_live_import() {
        use crate::commands::mail::gmail::oauth::gen_pkce;
        use crate::commands::mail::graph::GraphProvider;
        use crate::commands::mail::provider::MailProvider;
        use crate::commands::mail::store::{EncryptedMailStore, MailListQuery, MailStore};
        use crate::commands::mail::sync::sync_folder_provider;
        use crate::commands::rag::store::UNASSIGNED_MATTER;

        let cid = std::env::var("LANTERN_MS_CLIENT_ID")
            .unwrap_or_else(|_| "845ddba0-70ab-4f90-88ba-e3522157e37a".to_string());
        let redirect = "http://localhost:7777";

        let code = match std::env::var("MS_CODE") {
            Ok(c) => c,
            Err(_) => {
                let (verifier, challenge) = gen_pkce();
                eprintln!("MS_VERIFIER={verifier}");
                eprintln!("MS_AUTH_URL={}", build_ms_auth_url(&cid, redirect, &challenge, "import"));
                return;
            }
        };
        let verifier = std::env::var("MS_VERIFIER").expect("set MS_VERIFIER");

        // 1. Exchange the real code for a real access token.
        let tokens = ms_exchange_code(&cid, &code, &verifier, redirect, MS_TOKEN_ENDPOINT)
            .await
            .expect("token exchange failed");
        eprintln!("IMPORT: token OK (access_len={}, refresh_len={})", tokens.access.len(), tokens.refresh.len());

        // 2. Real provider + a throwaway encrypted workspace (fixed key, no keychain).
        let provider = GraphProvider::new(tokens.access.clone());
        let dir = tempfile::TempDir::new().unwrap();
        let workspace = dir.path();
        let key = [7u8; 32];
        let store = EncryptedMailStore::open_with_key(workspace, &key).expect("open store");

        // 3. Import every folder (no-op RAG/tombstone callbacks: we are exercising
        //    the import + metadata store + keyword list, not the embedder).
        let folders = provider.list_folders().await.expect("list folders");
        eprintln!("IMPORT: {} folders", folders.len());
        let noop_index = |_id: &str, _t: &str, _m: &str| {};
        let noop_tomb = |_id: &str| {};
        let noop_emit = |_w: u32, _r: u32| {};
        let folder_cap: usize = std::env::var("IMPORT_FOLDER_CAP").ok()
            .and_then(|s| s.parse().ok()).unwrap_or(usize::MAX);
        let mut grand_written = 0u32;
        let mut folder_errors = 0u32;
        for (i, folder) in folders.iter().enumerate() {
            if i >= folder_cap { eprintln!("IMPORT: stopping at folder cap {folder_cap}"); break; }
            match sync_folder_provider(
                &provider, &store, workspace, folder, "default", UNASSIGNED_MATTER,
                &key, &noop_emit, &noop_index, &noop_tomb,
            ).await {
                Ok(stats) => {
                    eprintln!("IMPORT: '{}' ({}) -> written={} removed={}",
                        folder.display_name, folder.id, stats.written, stats.removed);
                    grand_written += stats.written;
                }
                Err(e) => { eprintln!("IMPORT: '{}' ERROR: {e:#}", folder.display_name); folder_errors += 1; }
            }
        }
        eprintln!("IMPORT: total written={grand_written}, folder_errors={folder_errors}");

        // 4. Query the store exactly like the Email tab does (date desc, page 1).
        let store_count = store.count().expect("count");
        eprintln!("VERIFY: store row count={store_count}");
        let q = |keyword: Option<String>, limit: i64| MailListQuery {
            keyword, folder_id: None, provider: None, account: None,
            date_from: None, date_to: None, has_attachments: None,
            sort_by: "date".into(), sort_desc: true, limit, offset: 0,
        };
        let page = store.list_messages(&q(None, 12)).expect("list");
        eprintln!("VERIFY: list total={} (showing {})", page.total, page.items.len());
        // Data-health counters across the first page.
        let mut empty_subject = 0u32;
        let mut empty_from = 0u32;
        let mut null_date = 0u32;
        let mut with_attach = 0u32;
        for it in &page.items {
            if it.subject.trim().is_empty() { empty_subject += 1; }
            if it.from_addr.trim().is_empty() && it.from_name.trim().is_empty() { empty_from += 1; }
            if it.received_date_time.is_none() { null_date += 1; }
            if it.has_attachments { with_attach += 1; }
            eprintln!("  - [{}] \"{}\" | {} <{}> | folder={} | attach={} | snippet={:?}",
                it.received_date_time.as_deref().unwrap_or("NULL"),
                it.subject, it.from_name, it.from_addr, it.folder_id, it.has_attachments,
                it.snippet.chars().take(60).collect::<String>());
        }
        eprintln!("HEALTH(first page): empty_subject={empty_subject} empty_from={empty_from} null_date={null_date} with_attach={with_attach}");

        // 5. Keyword search (exercise the search path that powers the Email tab).
        if let Ok(kw) = std::env::var("IMPORT_SEARCH") {
            let hits = store.list_messages(&q(Some(kw.clone()), 5)).expect("search");
            eprintln!("SEARCH '{kw}': {} hits", hits.total);
            for it in &hits.items {
                eprintln!("  > \"{}\" | {} <{}>", it.subject, it.from_name, it.from_addr);
            }
        }

        // Hard assertions: the import must have produced searchable mail.
        assert!(grand_written > 0, "no mail was imported");
        assert_eq!(store_count as u32, grand_written, "store row count != written (lost rows)");
        assert_eq!(page.total as u32, grand_written, "list total != written (list query drops rows)");
    }
}

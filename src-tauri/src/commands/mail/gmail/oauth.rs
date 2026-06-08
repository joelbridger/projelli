use anyhow::anyhow;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// ── Constants ──────────────────────────────────────────────────────────────

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
pub const SCOPE: &str = "openid email https://www.googleapis.com/auth/gmail.readonly";

// ── PKCE ──────────────────────────────────────────────────────────────────

/// Returns `(code_verifier, code_challenge)` using the S256 method.
///
/// Verifier: 64 random URL-safe base64 characters (no padding). This
/// satisfies RFC 7636 §4.1 (43–128 ASCII chars, unreserved).
/// Challenge: base64url_nopad(SHA-256(ASCII(verifier))).
pub fn gen_pkce() -> (String, String) {
    // 48 random bytes encodes to exactly 64 base64url chars (no padding).
    let mut bytes = [0u8; 48];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);

    let hash = Sha256::digest(verifier.as_bytes());
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hash);

    (verifier, challenge)
}

/// Returns a random URL-safe state token (32 bytes, base64url-encoded).
pub fn gen_state() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

// ── Auth URL builder ──────────────────────────────────────────────────────

/// Build the Google authorization URL for the loopback desktop flow.
/// `access_type=offline` and `prompt=consent` ensure a refresh token is
/// always returned even if the user previously authorized this client_id.
pub fn build_auth_url(
    client_id: &str,
    redirect_uri: &str,
    code_challenge: &str,
    state: &str,
) -> String {
    let encoded_redirect = urlencoding_encode(redirect_uri);
    let encoded_scope = urlencoding_encode(SCOPE);
    let encoded_challenge = urlencoding_encode(code_challenge);
    let encoded_state = urlencoding_encode(state);
    let encoded_client_id = urlencoding_encode(client_id);

    format!(
        "{auth}?client_id={client_id}&redirect_uri={redirect_uri}&response_type=code\
         &scope={scope}&code_challenge={challenge}&code_challenge_method=S256\
         &state={state}&access_type=offline&prompt=consent",
        auth = AUTH_ENDPOINT,
        client_id = encoded_client_id,
        redirect_uri = encoded_redirect,
        scope = encoded_scope,
        challenge = encoded_challenge,
        state = encoded_state,
    )
}

/// Minimal percent-encoder: encodes everything except unreserved chars
/// (RFC 3986 §2.3: ALPHA / DIGIT / "-" / "." / "_" / "~").
fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
            | b'-' | b'.' | b'_' | b'~' => out.push(b as char),
            _ => {
                out.push('%');
                out.push(char::from_digit((b >> 4) as u32, 16).unwrap().to_ascii_uppercase());
                out.push(char::from_digit((b & 0xf) as u32, 16).unwrap().to_ascii_uppercase());
            }
        }
    }
    out
}

// ── Redirect parser ───────────────────────────────────────────────────────

/// Parse `code` and `state` from the first line of a loopback GET request.
///
/// Expects a string like `"GET /?code=abc&state=xyz HTTP/1.1"`.
/// Returns `Some((code, state))` if both are present; `None` otherwise.
/// Extra query parameters are ignored. Values are NOT percent-decoded (the
/// code is an opaque token that Google issues without encoding in practice).
pub fn parse_redirect_query(request_line: &str) -> Option<(String, String)> {
    // Extract the path+query portion between the first space and "HTTP/"
    let after_method = request_line.splitn(2, ' ').nth(1)?;
    let path_query = after_method.splitn(2, ' ').next()?;

    // Strip the leading path, keep only the query string
    let query = if let Some(q) = path_query.splitn(2, '?').nth(1) {
        q
    } else {
        return None;
    };

    let mut code: Option<String> = None;
    let mut state: Option<String> = None;

    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        let key = kv.next().unwrap_or("");
        let val = kv.next().unwrap_or("");
        match key {
            "code" => code = Some(val.to_string()),
            "state" => state = Some(val.to_string()),
            _ => {}
        }
    }

    Some((code?, state?))
}

// ── Token types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct GoogleTokens {
    pub access: String,
    pub refresh: Option<String>,
    pub expires_in: u64,
}

// ── GoogleOAuth client ────────────────────────────────────────────────────

pub struct GoogleOAuth {
    client_id: String,
    /// Full token endpoint URL (overridable for wiremock tests).
    base: String,
    http: reqwest::Client,
}

impl GoogleOAuth {
    /// Create with the real Google token endpoint.
    pub fn new(client_id: String) -> Self {
        Self::new_with_base(client_id, TOKEN_ENDPOINT.to_string())
    }

    /// Create with a custom token endpoint (e.g. wiremock base URL + path).
    pub fn new_with_base(client_id: String, base: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("build reqwest client");
        Self { client_id, base, http }
    }

    /// Exchange an authorization code (plus PKCE verifier) for tokens.
    pub async fn exchange_code(
        &self,
        code: &str,
        code_verifier: &str,
        redirect_uri: &str,
    ) -> anyhow::Result<GoogleTokens> {
        let resp = self
            .http
            .post(&self.base)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("code", code),
                ("code_verifier", code_verifier),
                ("grant_type", "authorization_code"),
                ("redirect_uri", redirect_uri),
            ])
            .send()
            .await?;
        let status = resp.status().as_u16();
        let v: serde_json::Value = resp.json().await?;
        parse_token_response(status, &v)
    }

    /// Refresh an access token using a stored refresh token.
    pub async fn refresh(&self, refresh_token: &str) -> anyhow::Result<GoogleTokens> {
        let resp = self
            .http
            .post(&self.base)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("refresh_token", refresh_token),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await?;
        let status = resp.status().as_u16();
        let v: serde_json::Value = resp.json().await?;
        parse_token_response(status, &v)
    }
}

/// Shared token-response parser. Mirrors the empty-token guard in M365 oauth.rs.
fn parse_token_response(status: u16, v: &serde_json::Value) -> anyhow::Result<GoogleTokens> {
    if status == 200 {
        let access = v
            .get("access_token")
            .and_then(|s| s.as_str())
            .unwrap_or("");
        if access.is_empty() {
            return Err(anyhow!("token response had no access_token"));
        }
        return Ok(GoogleTokens {
            access: access.to_string(),
            refresh: v
                .get("refresh_token")
                .and_then(|s| s.as_str())
                .map(String::from),
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
    Err(anyhow!("token request failed (http {status}): {err}"))
}

// ── Loopback listener ─────────────────────────────────────────────────────

/// Bind a loopback TCP listener on an OS-assigned port.
/// Returns `(listener, redirect_uri)` where `redirect_uri` is
/// `"http://127.0.0.1:<port>"` — suitable to pass to Google and to
/// `exchange_code`.
pub async fn bind_loopback() -> anyhow::Result<(tokio::net::TcpListener, String)> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    Ok((listener, redirect_uri))
}

/// Open the system browser to `auth_url`.
/// Best-effort: logs a warning on failure but does not return an error
/// (the user can also copy-paste the URL).
pub fn open_browser(auth_url: &str) {
    if let Err(e) = open::that(auth_url) {
        log::warn!("gmail: could not open browser automatically: {e}");
    }
}

/// Accept ONE connection on `listener`, read the GET request line,
/// verify `state`, write a "you can close this tab" response, and return
/// the authorization code. Times out after `timeout`.
pub async fn await_redirect_code(
    listener: tokio::net::TcpListener,
    expected_state: &str,
    timeout: Duration,
) -> anyhow::Result<String> {
    let expected_state = expected_state.to_string();

    tokio::time::timeout(timeout, async move {
        let (mut socket, _peer) = listener.accept().await?;

        // Read bytes until we see \r\n (end of request line) or the buffer fills.
        let mut buf = Vec::with_capacity(4096);
        let mut tmp = [0u8; 1];
        loop {
            socket.read_exact(&mut tmp).await?;
            buf.push(tmp[0]);
            if buf.ends_with(b"\r\n") {
                break;
            }
            if buf.len() > 8192 {
                anyhow::bail!("request line too long");
            }
        }

        let request_line = std::str::from_utf8(&buf)
            .map_err(|e| anyhow!("non-UTF8 request line: {e}"))?
            .trim_end_matches(['\r', '\n'])
            .to_string();

        let (code, state) = parse_redirect_query(&request_line)
            .ok_or_else(|| anyhow!("missing code or state in redirect"))?;

        if state != expected_state {
            // Write error page before returning error so the browser sees something.
            let _ = socket
                .write_all(
                    b"HTTP/1.1 400 Bad Request\r\nContent-Type: text/html\r\n\r\n\
                      <html><body>Authentication error: state mismatch.</body></html>",
                )
                .await;
            anyhow::bail!("state mismatch in OAuth redirect");
        }

        socket
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n\
                  <html><body>Signed in. You can close this tab and return to Keepance.</body></html>",
            )
            .await?;
        // Flush so the browser actually receives the response before we drop the socket.
        socket.flush().await?;

        Ok(code)
    })
    .await
    .map_err(|_| anyhow!("timed out waiting for OAuth redirect"))?
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── PKCE ──────────────────────────────────────────────────────────────

    #[test]
    fn gen_pkce_verifier_length_and_challenge_correct() {
        let (verifier, challenge) = gen_pkce();

        // Verifier must be exactly 64 URL-safe base64 chars (48 bytes → 64 chars, no padding).
        assert_eq!(verifier.len(), 64, "verifier must be 64 chars");
        // Must be URL-safe base64 (no +, /, or =).
        assert!(
            verifier.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "verifier must be URL-safe base64url chars: {verifier}"
        );

        // Challenge must equal base64url_nopad(sha256(verifier_bytes)).
        let expected_hash = Sha256::digest(verifier.as_bytes());
        let expected_challenge =
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(expected_hash);
        assert_eq!(challenge, expected_challenge, "challenge must be S256 of verifier");
    }

    #[test]
    fn gen_pkce_produces_unique_pairs() {
        let (v1, c1) = gen_pkce();
        let (v2, c2) = gen_pkce();
        assert_ne!(v1, v2, "two verifiers must differ");
        assert_ne!(c1, c2, "two challenges must differ");
    }

    // ── Auth URL ──────────────────────────────────────────────────────────

    #[test]
    fn build_auth_url_contains_required_params() {
        let url = build_auth_url(
            "my-client-id",
            "http://127.0.0.1:54321",
            "challenge_abc",
            "state_xyz",
        );

        assert!(url.contains("my-client-id"), "missing client_id");
        // redirect_uri is percent-encoded
        assert!(url.contains("127.0.0.1"), "missing redirect host");
        assert!(url.contains("challenge_abc"), "missing code_challenge");
        assert!(url.contains("code_challenge_method=S256"), "missing S256 method");
        assert!(url.contains("state_xyz"), "missing state");
        // gmail.readonly scope (encoded)
        assert!(
            url.contains("gmail.readonly"),
            "gmail.readonly scope missing from URL: {url}"
        );
        assert!(url.contains("access_type=offline"), "missing access_type=offline");
        assert!(url.contains("prompt=consent"), "missing prompt=consent");
        assert!(url.contains("response_type=code"), "missing response_type=code");
    }

    // ── Redirect parser ───────────────────────────────────────────────────

    #[test]
    fn parse_redirect_query_happy_path() {
        let result =
            parse_redirect_query("GET /?code=abc&state=xyz HTTP/1.1");
        assert_eq!(result, Some(("abc".to_string(), "xyz".to_string())));
    }

    #[test]
    fn parse_redirect_query_extra_params() {
        let result = parse_redirect_query(
            "GET /?scope=email&code=tok123&state=s456&prompt=consent HTTP/1.1",
        );
        assert_eq!(result, Some(("tok123".to_string(), "s456".to_string())));
    }

    #[test]
    fn parse_redirect_query_missing_code_returns_none() {
        let result = parse_redirect_query("GET /?state=xyz HTTP/1.1");
        assert!(result.is_none(), "should be None when code is absent");
    }

    #[test]
    fn parse_redirect_query_missing_state_returns_none() {
        let result = parse_redirect_query("GET /?code=abc HTTP/1.1");
        assert!(result.is_none(), "should be None when state is absent");
    }

    #[test]
    fn parse_redirect_query_no_query_string_returns_none() {
        let result = parse_redirect_query("GET / HTTP/1.1");
        assert!(result.is_none(), "should be None with no query string");
    }

    // ── Token exchange + refresh (wiremock) ───────────────────────────────

    #[tokio::test]
    async fn exchange_code_parses_tokens() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "AT_google",
                "refresh_token": "RT_google",
                "expires_in": 3600,
                "token_type": "Bearer"
            })))
            .mount(&server)
            .await;

        let token_url = format!("{}/token", server.uri());
        let auth = GoogleOAuth::new_with_base("client-abc".into(), token_url);
        let tokens = auth
            .exchange_code("code123", "verifier123", "http://127.0.0.1:1234")
            .await
            .expect("exchange_code should succeed");

        assert_eq!(tokens.access, "AT_google");
        assert_eq!(tokens.refresh.as_deref(), Some("RT_google"));
        assert_eq!(tokens.expires_in, 3600);
    }

    #[tokio::test]
    async fn refresh_parses_tokens() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "AT_refreshed",
                "expires_in": 3600,
                "token_type": "Bearer"
            })))
            .mount(&server)
            .await;

        let token_url = format!("{}/token", server.uri());
        let auth = GoogleOAuth::new_with_base("client-abc".into(), token_url);
        let tokens = auth
            .refresh("old-refresh-token")
            .await
            .expect("refresh should succeed");

        assert_eq!(tokens.access, "AT_refreshed");
        assert!(tokens.refresh.is_none(), "refresh may not return a new refresh_token");
        assert_eq!(tokens.expires_in, 3600);
    }

    #[tokio::test]
    async fn exchange_code_200_without_access_token_errors() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        // 200 but no access_token — Google returning a malformed body.
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "refresh_token": "RT",
                "expires_in": 3600
            })))
            .mount(&server)
            .await;

        let token_url = format!("{}/token", server.uri());
        let auth = GoogleOAuth::new_with_base("client-abc".into(), token_url);
        let result = auth
            .exchange_code("code", "verifier", "http://127.0.0.1:1234")
            .await;
        assert!(result.is_err(), "missing access_token must be an error");
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("access_token"), "error message should mention access_token: {msg}");
    }

    #[tokio::test]
    async fn exchange_code_200_with_empty_access_token_errors() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "",
                "refresh_token": "RT"
            })))
            .mount(&server)
            .await;

        let token_url = format!("{}/token", server.uri());
        let auth = GoogleOAuth::new_with_base("client-abc".into(), token_url);
        let result = auth
            .exchange_code("code", "verifier", "http://127.0.0.1:1234")
            .await;
        assert!(result.is_err(), "empty access_token must be an error");
    }

    #[tokio::test]
    async fn exchange_code_non_200_errors() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
                "error": "invalid_grant",
                "error_description": "Code was already redeemed."
            })))
            .mount(&server)
            .await;

        let token_url = format!("{}/token", server.uri());
        let auth = GoogleOAuth::new_with_base("client-abc".into(), token_url);
        let result = auth
            .exchange_code("bad_code", "verifier", "http://127.0.0.1:1234")
            .await;
        assert!(result.is_err(), "non-200 must be an error");
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("invalid_grant"), "error should surface google error: {msg}");
    }
}

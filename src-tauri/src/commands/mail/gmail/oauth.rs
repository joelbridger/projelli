use anyhow::anyhow;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// ── Constants ──────────────────────────────────────────────────────────────

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
pub const SCOPE: &str = "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose";

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
pub(crate) fn urlencoding_encode(s: &str) -> String {
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
/// Extra query parameters are ignored. Values ARE percent-decoded: Microsoft
/// auth codes contain reserved characters (* ! $) that arrive percent-encoded
/// in the redirect; without decoding they get double-encoded at the token
/// exchange (reqwest re-encodes the %), which Microsoft rejects as invalid_grant.
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
            "code" => code = Some(percent_decode(val)),
            "state" => state = Some(percent_decode(val)),
            _ => {}
        }
    }

    Some((code?, state?))
}

/// Percent-decode a URL query value (`%XX` -> byte). Non-encoded characters are
/// left as-is. Needed so Microsoft auth codes (which arrive percent-encoded)
/// reach the token endpoint as their literal value rather than double-encoded.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
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
    client_secret: String,
    /// Full token endpoint URL (overridable for wiremock tests).
    base: String,
    http: reqwest::Client,
}

impl GoogleOAuth {
    /// Create with the real Google token endpoint.
    pub fn new(client_id: String, client_secret: String) -> Self {
        Self::new_with_base(client_id, client_secret, TOKEN_ENDPOINT.to_string())
    }

    /// Create with a custom token endpoint (e.g. wiremock base URL + path).
    pub fn new_with_base(client_id: String, client_secret: String, base: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("build reqwest client");
        Self { client_id, client_secret, base, http }
    }

    /// Exchange an authorization code (plus PKCE verifier) for tokens.
    /// Google requires client_secret for Desktop-type OAuth clients even with PKCE.
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
                ("client_secret", self.client_secret.as_str()),
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
    /// Google requires client_secret for Desktop-type OAuth clients.
    pub async fn refresh(&self, refresh_token: &str) -> anyhow::Result<GoogleTokens> {
        let resp = self
            .http
            .post(&self.base)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
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
    bind_loopback_host("127.0.0.1").await
}

/// Bind an ephemeral loopback listener for an OAuth redirect on a SPECIFIC host
/// ("127.0.0.1" or "localhost"), returning the listener and the matching
/// `http://<host>:<port>` redirect URI.
///
/// Why the host matters (BUG-010): the redirect URI host and the bound listener
/// host must be the SAME name, because the browser resolves the redirect host
/// and connects there. On Windows, "localhost" resolves to ::1 (IPv6) first —
/// so binding 127.0.0.1 (IPv4) while redirecting to "localhost" left the browser
/// hitting a dead ::1 port ("localhost refused to connect") and the listener
/// never received the code. Binding the literal "localhost" makes tokio resolve
/// it the same way the browser will, so they always meet. Microsoft personal
/// accounts require the "localhost" redirect (they reject a numeric 127.0.0.1
/// loopback); Gmail keeps 127.0.0.1.
pub async fn bind_loopback_host(host: &str) -> anyhow::Result<(tokio::net::TcpListener, String)> {
    let listener = tokio::net::TcpListener::bind(format!("{host}:0")).await?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://{host}:{port}");
    Ok((listener, redirect_uri))
}

/// Open the system browser to `auth_url`.
/// Best-effort: logs a warning on failure but does not return an error
/// (the user can also copy-paste the URL).
pub fn open_browser(auth_url: &str) {
    // Routed through the shared no-window opener so Windows does not flash a
    // console window when launching the browser for the Gmail OAuth consent.
    crate::util::proc::open_url(auth_url);
}

/// Accept ONE connection on `listener`, read the GET request line,
/// verify `state`, write a "you can close this tab" response, and return
/// the authorization code. Times out after `timeout`.
///
/// This function drains the rest of the browser's HTTP request headers before
/// closing so the OS sends a clean TCP FIN instead of a RST. Without draining,
/// closing a socket with unread data causes the OS to send a RST, which makes
/// the browser show `net::ERR_CONNECTION_RESET` and a blank page.
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

        // Drain remaining request headers up to \r\n\r\n (or 16 KB cap).
        // This empties the receive buffer so the OS sends FIN rather than RST.
        drain_request_headers(&mut socket).await;

        if state != expected_state {
            // Write a complete response before returning error so the browser sees something.
            let err_body = b"<html><body>Authentication error: state mismatch.</body></html>";
            let err_response = format!(
                "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                err_body.len()
            );
            let _ = socket.write_all(err_response.as_bytes()).await;
            let _ = socket.write_all(err_body).await;
            let _ = socket.flush().await;
            let _ = socket.shutdown().await;
            anyhow::bail!("state mismatch in OAuth redirect");
        }

        let body = b"<html><body>Signed in. You can close this tab and return to Advisor Prep Hero.</body></html>";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        socket.write_all(response.as_bytes()).await?;
        socket.write_all(body).await?;
        // Flush then shut down the write half cleanly (FIN, not RST).
        socket.flush().await?;
        let _ = socket.shutdown().await;

        Ok(code)
    })
    .await
    .map_err(|_| anyhow!("timed out waiting for OAuth redirect"))?
}

/// Race `await_redirect_code` against `cancel` being set, polling every 150ms.
/// Lets a pending interactive OAuth wait (OneDrive, Salesforce, ...) be
/// aborted immediately — user clicked Cancel, or closed the browser tab and
/// gave up — instead of sitting on the full `timeout`. Returns
/// `Err("cancelled")` when the cancel flag wins. Shared by every loopback
/// connector so the "5-minute frozen login" fix lives in one place.
pub async fn await_redirect_code_or_cancel(
    listener: tokio::net::TcpListener,
    expected_state: &str,
    timeout: Duration,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> anyhow::Result<String> {
    let redirect_fut = await_redirect_code(listener, expected_state, timeout);
    tokio::pin!(redirect_fut);
    loop {
        tokio::select! {
            res = &mut redirect_fut => {
                // A redirect that lands in the same instant Cancel was
                // clicked can win this select before the next poll tick
                // notices — re-check `cancel` here so a late Cancel still
                // wins instead of silently completing the connect.
                if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                    anyhow::bail!("cancelled");
                }
                return res;
            }
            _ = tokio::time::sleep(Duration::from_millis(150)) => {
                if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                    anyhow::bail!("cancelled");
                }
            }
        }
    }
}

/// Persist a just-exchanged credential while honoring a cancel that arrives
/// during the exchange (a network round trip) or between the exchange
/// finishing and the store completing.
///
/// A redirect wait resolving successfully (`await_redirect_code_or_cancel`
/// returning `Ok`) does NOT mean the flow is done — the token exchange that
/// follows is itself a slow network call, and Cancel can still be clicked
/// during it. Without this check, a canceled user could end up connected
/// with a stored credential and no way to tell from the UI. `store` is only
/// called if `cancel` is still clear; if `cancel` flips in the (vanishingly
/// small) window between the check and `store` returning, `rollback` undoes
/// it so a canceled flow leaves NO NEW credential.
///
/// `rollback` is caller-defined on purpose: a fresh connect (no prior
/// credential) should delete on rollback, but a **reconnect** over an
/// existing connection must restore the previous credential instead —
/// deleting unconditionally would let a canceled reconnect attempt silently
/// disconnect an already-working account. Callers with a possible prior
/// value should snapshot it before calling this and have `rollback` restore
/// it (falling back to delete only when there was nothing to restore).
pub fn store_or_rollback_on_cancel(
    cancel: &std::sync::atomic::AtomicBool,
    store: impl FnOnce() -> Result<(), String>,
    rollback: impl FnOnce(),
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if cancel.load(Ordering::SeqCst) {
        return Err("cancelled".to_string());
    }
    store()?;
    if cancel.load(Ordering::SeqCst) {
        rollback();
        return Err("cancelled".to_string());
    }
    Ok(())
}

/// Read and discard bytes from `socket` until the end-of-headers marker
/// `\r\n\r\n` is seen or 16 KB have been consumed, whichever comes first.
/// Best-effort: ignores errors (the browser may have already closed its send half).
async fn drain_request_headers(socket: &mut tokio::net::TcpStream) {
    const CAP: usize = 16 * 1024;
    let mut drained = Vec::with_capacity(512);
    let mut tmp = [0u8; 1];
    while drained.len() < CAP {
        match socket.read_exact(&mut tmp).await {
            Ok(_) => {
                drained.push(tmp[0]);
                if drained.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            Err(_) => break, // EOF or connection error — nothing more to drain
        }
    }
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
        // BOUND: these are `contains` checks — PRESENCE only. They can notice a
        // scope going MISSING; they are structurally blind to one being ADDED
        // (measured: a planted widening left the whole suite green). Exactness
        // lives in src/scope_freeze.rs, which pins this constant token-for-token.
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
        assert!(url.contains("gmail.send"), "gmail.send scope missing from URL: {url}");
        assert!(url.contains("gmail.compose"), "gmail.compose scope missing from URL: {url}");
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
        let auth = GoogleOAuth::new_with_base("client-abc".into(), "test-secret".into(), token_url);
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
        let auth = GoogleOAuth::new_with_base("client-abc".into(), "test-secret".into(), token_url);
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
        let auth = GoogleOAuth::new_with_base("client-abc".into(), "test-secret".into(), token_url);
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
        let auth = GoogleOAuth::new_with_base("client-abc".into(), "test-secret".into(), token_url);
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
        let auth = GoogleOAuth::new_with_base("client-abc".into(), "test-secret".into(), token_url);
        let result = auth
            .exchange_code("bad_code", "verifier", "http://127.0.0.1:1234")
            .await;
        assert!(result.is_err(), "non-200 must be an error");
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("invalid_grant"), "error should surface google error: {msg}");
    }

    // ── client_secret is sent in both exchange and refresh ────────────────────

    #[tokio::test]
    async fn exchange_code_sends_client_secret() {
        use wiremock::matchers::{method, path, body_string_contains};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        // The mock requires `client_secret` to be present in the body.
        Mock::given(method("POST"))
            .and(path("/token"))
            .and(body_string_contains("client_secret=my-secret"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "AT",
                "refresh_token": "RT",
                "expires_in": 3600,
                "token_type": "Bearer"
            })))
            .mount(&server)
            .await;

        let token_url = format!("{}/token", server.uri());
        let auth = GoogleOAuth::new_with_base("client-abc".into(), "my-secret".into(), token_url);
        let result = auth
            .exchange_code("code123", "verifier123", "http://127.0.0.1:1234")
            .await;
        assert!(result.is_ok(), "exchange_code must succeed when client_secret is present: {:?}", result.err());
    }

    #[tokio::test]
    async fn refresh_sends_client_secret() {
        use wiremock::matchers::{method, path, body_string_contains};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        // The mock requires `client_secret` to be present in the body.
        Mock::given(method("POST"))
            .and(path("/token"))
            .and(body_string_contains("client_secret=my-secret"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "AT_refreshed",
                "expires_in": 3600,
                "token_type": "Bearer"
            })))
            .mount(&server)
            .await;

        let token_url = format!("{}/token", server.uri());
        let auth = GoogleOAuth::new_with_base("client-abc".into(), "my-secret".into(), token_url);
        let result = auth.refresh("old-rt").await;
        assert!(result.is_ok(), "refresh must succeed when client_secret is present: {:?}", result.err());
    }

    // ── Loopback redirect — connection-reset regression test ─────────────────
    //
    // Verifies that await_redirect_code:
    //   1. Returns the authorization code.
    //   2. Sends a complete HTTP/1.1 response with Content-Length and 200 OK.
    //   3. Drains the browser's request headers before closing so the OS sends
    //      a clean FIN instead of a TCP RST (fixes net::ERR_CONNECTION_RESET).
    //   4. The client read reaches EOF cleanly (no connection reset).
    #[tokio::test]
    async fn await_redirect_code_returns_code_and_clean_response() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::{TcpListener, TcpStream};

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let expected_state = "TEST_STATE_12345";

        // Spawn the function under test in a background task.
        let task = tokio::spawn(await_redirect_code(
            listener,
            expected_state,
            Duration::from_secs(5),
        ));

        // Act as the browser: connect and write a complete realistic HTTP request.
        let mut stream = TcpStream::connect(format!("127.0.0.1:{port}")).await.unwrap();
        let request = format!(
            "GET /?code=TESTCODE&state={} HTTP/1.1\r\nHost: 127.0.0.1\r\nUser-Agent: test\r\nAccept: */*\r\n\r\n",
            expected_state
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        stream.flush().await.unwrap();

        // Read the ENTIRE response until EOF. This proves the server sent a
        // complete, well-formed response and shut down cleanly (FIN, not RST).
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await
            .expect("read_to_end must not error — a TCP RST would produce an error here");

        let response_str = String::from_utf8_lossy(&response);

        // The authorization code must be returned by the task.
        let code = task.await.unwrap().expect("await_redirect_code must succeed");
        assert_eq!(code, "TESTCODE", "returned code must match the query parameter");

        // Response must be 200 OK.
        assert!(
            response_str.contains("200 OK"),
            "response must be 200 OK, got: {response_str}"
        );

        // Response must include a Content-Length header (required for clean close).
        assert!(
            response_str.contains("Content-Length:"),
            "response must include Content-Length header, got: {response_str}"
        );

        // The friendly body must be present.
        assert!(
            response_str.contains("Signed in"),
            "response body must contain the sign-in message, got: {response_str}"
        );

        // Content-Length must equal the actual body byte length.
        let header_end = response_str.find("\r\n\r\n")
            .expect("response must have header/body separator");
        let body = &response_str[header_end + 4..];
        let cl_line = response_str
            .lines()
            .find(|l| l.to_ascii_lowercase().starts_with("content-length:"))
            .expect("Content-Length line must exist");
        let cl_value: usize = cl_line
            .splitn(2, ':')
            .nth(1)
            .unwrap()
            .trim()
            .parse()
            .expect("Content-Length must be a number");
        assert_eq!(
            cl_value,
            body.len(),
            "Content-Length ({cl_value}) must equal actual body length ({})",
            body.len()
        );
    }

    // ── await_redirect_code_or_cancel — F2.4 "5-minute frozen login" fix ────

    #[tokio::test]
    async fn await_redirect_code_or_cancel_returns_immediately_when_cancelled() {
        use std::sync::atomic::AtomicBool;
        use std::sync::Arc;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let cancel = Arc::new(AtomicBool::new(true));

        let started = tokio::time::Instant::now();
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            await_redirect_code_or_cancel(listener, "state", Duration::from_secs(300), cancel),
        )
        .await
        .expect("must not hit the 2s outer test timeout — cancellation should be near-instant");

        assert!(result.is_err(), "a cancelled wait must return an error, not a code");
        assert!(started.elapsed() < Duration::from_secs(1), "cancellation must be detected within one poll tick, not the full timeout");
    }

    #[tokio::test]
    async fn await_redirect_code_or_cancel_returns_the_code_when_not_cancelled() {
        use std::sync::atomic::AtomicBool;
        use std::sync::Arc;
        use tokio::io::AsyncWriteExt;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let cancel = Arc::new(AtomicBool::new(false));

        let task = tokio::spawn(await_redirect_code_or_cancel(
            listener,
            "TEST_STATE",
            Duration::from_secs(5),
            cancel,
        ));

        let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{port}")).await.unwrap();
        let request = "GET /?code=REALCODE&state=TEST_STATE HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        stream.write_all(request.as_bytes()).await.unwrap();
        stream.flush().await.unwrap();

        let code = task.await.unwrap().expect("must succeed when never cancelled");
        assert_eq!(code, "REALCODE");
    }

    #[tokio::test]
    async fn await_redirect_code_or_cancel_notices_a_late_cancel() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_setter = cancel.clone();

        let task = tokio::spawn(await_redirect_code_or_cancel(
            listener,
            "state",
            Duration::from_secs(300),
            cancel,
        ));

        tokio::time::sleep(Duration::from_millis(50)).await;
        cancel_setter.store(true, Ordering::SeqCst);

        let result = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("must not hit the 2s outer test timeout")
            .unwrap();
        assert!(result.is_err(), "a late cancel must still abort the wait");
    }

    #[tokio::test]
    async fn await_redirect_code_or_cancel_rejects_a_redirect_that_lands_after_cancel() {
        // Regression: cancel is set, then the browser redirect ARRIVES (a
        // connect-then-cancel race — e.g. the user finishes the OAuth popup
        // in the same instant they click Cancel). The redirect branch can
        // become ready before the next 150ms poll tick would have noticed
        // cancel on its own; the fix re-checks cancel at the moment the
        // redirect resolves so a Cancel that landed first still wins instead
        // of silently completing the connect.
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        use tokio::io::AsyncWriteExt;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_setter = cancel.clone();

        let task = tokio::spawn(await_redirect_code_or_cancel(
            listener,
            "TEST_STATE",
            Duration::from_secs(300),
            cancel,
        ));

        // Cancel first, then complete the redirect almost immediately after —
        // well within the 150ms poll interval, so the redirect branch is very
        // likely to win the select race against the next sleep tick.
        cancel_setter.store(true, Ordering::SeqCst);
        let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{port}")).await.unwrap();
        let request = "GET /?code=REALCODE&state=TEST_STATE HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        stream.write_all(request.as_bytes()).await.unwrap();
        stream.flush().await.unwrap();

        let result = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("must not hit the 2s outer test timeout")
            .unwrap();
        assert!(result.is_err(), "cancel must win even when the redirect lands right after it, not silently return the code");
    }

    // ── store_or_rollback_on_cancel — "cancel-during-exchange leaves no
    //    stored token" fix (found in codex review of the redirect race fix) ──

    #[test]
    fn store_or_rollback_on_cancel_stores_when_never_cancelled() {
        use std::sync::atomic::AtomicBool;

        let cancel = AtomicBool::new(false);
        let mut stored = None;
        let mut deleted = false;

        let result = super::store_or_rollback_on_cancel(
            &cancel,
            || { stored = Some("token".to_string()); Ok(()) },
            || { deleted = true; },
        );

        assert!(result.is_ok());
        assert_eq!(stored.as_deref(), Some("token"));
        assert!(!deleted, "must not delete on the happy path");
    }

    #[test]
    fn store_or_rollback_on_cancel_never_stores_when_cancelled_before_the_call() {
        use std::sync::atomic::AtomicBool;

        // Simulates cancel arriving during the token exchange (a network
        // round trip) that happens BEFORE store_or_rollback_on_cancel is
        // even called — the flag is already set by the time we get here.
        let cancel = AtomicBool::new(true);
        let mut stored = None;
        let mut deleted = false;

        let result = super::store_or_rollback_on_cancel(
            &cancel,
            || { stored = Some("token".to_string()); Ok(()) },
            || { deleted = true; },
        );

        assert!(result.is_err(), "a canceled flow must not connect");
        assert_eq!(result.unwrap_err(), "cancelled");
        assert_eq!(stored, None, "a canceled flow must leave NO stored credential");
        assert!(!deleted, "nothing was stored, so nothing to delete");
    }

    #[test]
    fn store_or_rollback_on_cancel_deletes_the_credential_if_cancel_lands_right_after_the_store() {
        use std::sync::atomic::AtomicBool;

        // Simulates cancel flipping in the (tiny) window between the
        // pre-store check and the store completing: the store closure
        // itself flips the flag, mimicking a cancel that lands mid-store.
        let cancel = AtomicBool::new(false);
        let mut stored = None;
        let mut deleted = false;

        let result = super::store_or_rollback_on_cancel(
            &cancel,
            || {
                stored = Some("token".to_string());
                cancel.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            },
            || { deleted = true; },
        );

        assert!(result.is_err(), "a late cancel must still abort the connect");
        assert_eq!(result.unwrap_err(), "cancelled");
        assert!(deleted, "a credential stored right before a late cancel must be rolled back — NO credential may survive a cancel");
    }

    #[test]
    fn store_or_rollback_on_cancel_restores_a_prior_value_instead_of_only_deleting() {
        // Regression (found in codex review): a RECONNECT over an existing
        // connection must not let a cancel-after-store wipe out the
        // previously-working credential. `rollback` is caller-defined
        // specifically so a caller who snapshotted a prior value can restore
        // it instead of deleting — this proves that contract actually works
        // through the shared helper, mirroring onedrive/commands.rs and
        // crm/commands.rs's "restore previous or delete if none" callbacks.
        use std::cell::RefCell;
        use std::sync::atomic::AtomicBool;

        let cancel = AtomicBool::new(false);
        let fake_keychain: RefCell<Option<String>> = RefCell::new(Some("old-working-token".to_string()));
        let previous = fake_keychain.borrow().clone();

        let result = super::store_or_rollback_on_cancel(
            &cancel,
            || {
                *fake_keychain.borrow_mut() = Some("new-token".to_string());
                cancel.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            },
            || {
                *fake_keychain.borrow_mut() = previous.clone();
            },
        );

        assert!(result.is_err(), "a late cancel must still abort the reconnect");
        assert_eq!(
            fake_keychain.borrow().as_deref(),
            Some("old-working-token"),
            "a canceled RECONNECT must restore the prior working credential, not delete it"
        );
    }

    #[test]
    fn store_or_rollback_on_cancel_propagates_a_real_store_error_without_deleting() {
        use std::sync::atomic::AtomicBool;

        let cancel = AtomicBool::new(false);
        let mut deleted = false;

        let result = super::store_or_rollback_on_cancel(
            &cancel,
            || Err("keychain locked".to_string()),
            || { deleted = true; },
        );

        assert_eq!(result, Err("keychain locked".to_string()));
        assert!(!deleted, "nothing was stored, so delete must not run for an unrelated store failure");
    }

    // Live OAuth smoke test for server-side connector validation (no signed build
    // needed). Ignored by default; run manually in two phases:
    //   Phase 1 (no GMAIL_CODE env): prints GMAIL_VERIFIER + GMAIL_AUTH_URL.
    //   Phase 2 (GMAIL_CODE + GMAIL_VERIFIER env): exchanges the real code for tokens.
    #[tokio::test]
    #[ignore]
    async fn gmail_live_smoke() {
        let cid = std::env::var("LANTERN_GMAIL_CLIENT_ID").expect("set LANTERN_GMAIL_CLIENT_ID");
        let redirect = "http://127.0.0.1:7777";
        if let Ok(code) = std::env::var("GMAIL_CODE") {
            let verifier = std::env::var("GMAIL_VERIFIER").expect("set GMAIL_VERIFIER");
            let secret =
                std::env::var("LANTERN_GMAIL_CLIENT_SECRET").expect("set LANTERN_GMAIL_CLIENT_SECRET");
            match GoogleOAuth::new(cid, secret).exchange_code(&code, &verifier, redirect).await {
                Ok(t) => eprintln!("GMAIL_RESULT=OK refresh_present={}", t.refresh.is_some()),
                Err(e) => eprintln!("GMAIL_RESULT=FAIL err={e}"),
            }
        } else {
            let (verifier, challenge) = gen_pkce();
            eprintln!("GMAIL_VERIFIER={verifier}");
            eprintln!("GMAIL_AUTH_URL={}", build_auth_url(&cid, redirect, &challenge, "smoke"));
        }
    }

    // Live END-TO-END Gmail import: pulls real Gmail through the real sync pipeline
    // (the same code the desktop app runs) into a TEMP encrypted store, then queries
    // it the way the Email tab does. Ignored; two phases like gmail_live_smoke.
    // Needs LANTERN_GMAIL_CLIENT_ID/_SECRET.
    //   Phase 1 (no GMAIL_CODE):               prints GMAIL_VERIFIER + GMAIL_AUTH_URL.
    //   Phase 2 (GMAIL_CODE + GMAIL_VERIFIER): exchanges, imports, reports.
    // Optional env: IMPORT_FOLDER_CAP=N, IMPORT_SEARCH=word.
    #[tokio::test]
    #[ignore]
    async fn gmail_live_import() {
        use crate::commands::mail::gmail::GmailProvider;
        use crate::commands::mail::provider::MailProvider;
        use crate::commands::mail::store::{EncryptedMailStore, MailListQuery, MailStore};
        use crate::commands::mail::sync::sync_folder_provider;
        use crate::commands::rag::store::UNASSIGNED_MATTER;

        let cid = std::env::var("LANTERN_GMAIL_CLIENT_ID").expect("set LANTERN_GMAIL_CLIENT_ID");
        let redirect = "http://127.0.0.1:7777";

        let code = match std::env::var("GMAIL_CODE") {
            Ok(c) => c,
            Err(_) => {
                let (verifier, challenge) = gen_pkce();
                eprintln!("GMAIL_VERIFIER={verifier}");
                eprintln!("GMAIL_AUTH_URL={}", build_auth_url(&cid, redirect, &challenge, "import"));
                return;
            }
        };
        let verifier = std::env::var("GMAIL_VERIFIER").expect("set GMAIL_VERIFIER");
        let secret = std::env::var("LANTERN_GMAIL_CLIENT_SECRET").expect("set LANTERN_GMAIL_CLIENT_SECRET");

        // 1. Exchange for a real access token.
        let tokens = GoogleOAuth::new(cid, secret)
            .exchange_code(&code, &verifier, redirect)
            .await
            .expect("token exchange failed");
        eprintln!("IMPORT: token OK (access_len={}, refresh_present={})", tokens.access.len(), tokens.refresh.is_some());

        // 2. Real provider + a throwaway encrypted workspace (fixed key, no keychain).
        let provider = GmailProvider::new(tokens.access.clone(), "default".to_string());
        let dir = tempfile::TempDir::new().unwrap();
        let workspace = dir.path();
        let key = [7u8; 32];
        let store = EncryptedMailStore::open_with_key(workspace, &key).expect("open store");

        // 3. Import every label (no-op RAG/tombstone callbacks). NOTE: Gmail labels
        //    OVERLAP (a message can carry INBOX + a custom label + All Mail), and
        //    upsert is by message id, so the sum of per-label `written` is >= the
        //    unique row count in the store.
        let folders = provider.list_folders().await.expect("list folders");
        eprintln!("IMPORT: {} folders/labels", folders.len());
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
        eprintln!("IMPORT: total writes={grand_written} (incl. label overlap), folder_errors={folder_errors}");

        // 4. Query the store exactly like the Email tab does (date desc, page 1).
        let store_count = store.count().expect("count");
        eprintln!("VERIFY: unique store row count={store_count}");
        let q = |keyword: Option<String>, limit: i64| MailListQuery {
            keyword, folder_id: None, provider: None, account: None,
            date_from: None, date_to: None, has_attachments: None,
            sort_by: "date".into(), sort_desc: true, limit, offset: 0,
        };
        let page = store.list_messages(&q(None, 12)).expect("list");
        eprintln!("VERIFY: list total={} (showing {})", page.total, page.items.len());
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

        if let Ok(kw) = std::env::var("IMPORT_SEARCH") {
            let hits = store.list_messages(&q(Some(kw.clone()), 5)).expect("search");
            eprintln!("SEARCH '{kw}': {} hits", hits.total);
            for it in &hits.items {
                eprintln!("  > \"{}\" | {} <{}>", it.subject, it.from_name, it.from_addr);
            }
        }

        // Hard checks: import produced searchable mail; the list returns every stored row.
        assert!(grand_written > 0, "no mail was imported");
        assert!(store_count > 0, "store is empty after import");
        assert_eq!(page.total, store_count, "list total != unique store rows (list query drops rows)");
    }
}

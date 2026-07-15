use anyhow::anyhow;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// ── Redirect parser ───────────────────────────────────────────────────────

/// Outcome of parsing the backend→loopback redirect.
/// The backend redirects to `http://127.0.0.1:<port>/?sso_code=<code>`
/// on success or `?sso_error=<reason>` on failure.
#[derive(Debug, PartialEq, Eq)]
pub enum SsoRedirect {
    Code(String),
    Error(String),
    None,
}

/// Parse the backend→loopback redirect. Carries `sso_code` (success) or
/// `sso_error` (failure). Values are percent-decoded. Unknown query params
/// (e.g. `state`) are silently ignored. Error takes precedence over code.
pub fn parse_sso_redirect(request_line: &str) -> SsoRedirect {
    let Some(after) = request_line.splitn(2, ' ').nth(1) else {
        return SsoRedirect::None;
    };
    let Some(pathq) = after.splitn(2, ' ').next() else {
        return SsoRedirect::None;
    };
    let Some(query) = pathq.splitn(2, '?').nth(1) else {
        return SsoRedirect::None;
    };

    let mut code: Option<String> = None;
    let mut err: Option<String> = None;

    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        let key = kv.next().unwrap_or("");
        let val = kv.next().unwrap_or("");
        match key {
            "sso_code" => code = Some(percent_decode(val)),
            "sso_error" => err = Some(percent_decode(val)),
            _ => {}
        }
    }

    if let Some(e) = err {
        SsoRedirect::Error(e)
    } else if let Some(c) = code {
        SsoRedirect::Code(c)
    } else {
        SsoRedirect::None
    }
}

/// Minimal percent-decoder for query-string values.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ── Tauri state ───────────────────────────────────────────────────────────

/// Lets the frontend abort a pending interactive SSO sign-in (the loopback
/// wait in `firm_sso_authenticate`) without a five-minute wait. See
/// `firm_sso_cancel`.
pub struct FirmSsoState {
    pub cancel: Arc<AtomicBool>,
}

pub fn manage_state(app: &tauri::App) {
    use tauri::Manager;
    app.manage(FirmSsoState {
        cancel: Arc::new(AtomicBool::new(false)),
    });
}

// ── Tauri command ─────────────────────────────────────────────────────────

#[derive(Serialize)]
struct StartReq<'a> {
    email: &'a str,
    loopback_port: u16,
}

/// Full desktop SSO dance: bind loopback → POST sso/start → open browser →
/// await backend redirect → POST sso/exchange → return LoginResponse JSON.
///
/// Returns the backend's `LoginResponse` JSON as a string so the frontend
/// can parse it and run the identical post-login path as password sign-in.
/// Blocks until the user finishes, cancels (see `firm_sso_cancel`), or a
/// 5-minute timeout elapses.
#[tauri::command]
pub async fn firm_sso_authenticate(
    state: State<'_, FirmSsoState>,
    backend_base: String,
    email: String,
) -> Result<String, String> {
    // Reset from any prior cancelled/finished attempt before starting a new one.
    state.cancel.store(false, Ordering::SeqCst);
    let cancel = state.cancel.clone();
    run(backend_base, email, cancel)
        .await
        .map_err(|e| e.to_string())
}

/// Abort a pending `firm_sso_authenticate` sign-in immediately (e.g. the user
/// clicked Cancel, or closed the IdP popup and gave up) instead of leaving
/// them stuck on the 5-minute server-side timeout. A no-op if no sign-in is
/// in flight. Never touches an already-established session.
#[tauri::command]
pub async fn firm_sso_cancel(state: State<'_, FirmSsoState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

/// Drop the native firm-session identity on sign-out. Clearing only ever
/// deny-closes CRM own-clients enforcement, so it is safe for the renderer to
/// call; it can never be used to ASSUME an identity (only the TLS SSO exchange
/// sets one).
#[tauri::command]
pub async fn firm_session_end() -> Result<(), String> {
    crate::commands::firm::session::clear_identity();
    Ok(())
}

async fn run(backend_base: String, email: String, cancel: Arc<AtomicBool>) -> anyhow::Result<String> {
    let base = backend_base.trim_end_matches('/').to_string();

    // Bind a loopback listener on an OS-assigned port.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;

    // POST /auth/sso/start — get the IdP authorization URL.
    let start: serde_json::Value = http
        .post(format!("{base}/auth/sso/start"))
        .json(&StartReq {
            email: &email,
            loopback_port: port,
        })
        .send()
        .await?
        .json()
        .await?;

    let auth_url = start
        .get("auth_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            anyhow!(start
                .get("detail")
                .and_then(|d| d.as_str())
                .unwrap_or("sso_start_failed")
                .to_string())
        })?;

    // Open the system browser to the IdP authorization URL via the shared
    // no-window opener (avoids a Windows console flash during firm sign-in).
    crate::util::proc::open_url(auth_url);

    // Wait for the backend→loopback redirect carrying the one-time sso_code.
    let code = await_sso_redirect_or_cancel(listener, Duration::from_secs(300), cancel).await?;

    // POST /auth/sso/exchange — swap the one-time code for a LoginResponse.
    let exchange: serde_json::Value = http
        .post(format!("{base}/auth/sso/exchange"))
        .json(&serde_json::json!({ "sso_code": code }))
        .send()
        .await?
        .json()
        .await?;

    if exchange.get("access_token").is_none() {
        anyhow::bail!(exchange
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("exchange_failed")
            .to_string());
    }

    // Bind the native firm-session identity from THIS exchange. This is the only
    // place the CRM own-clients identity is established; there is no renderer
    // command that can set it, and a forged store record has no effect.
    // `user_id` is the CRM `member_id` (org-scoped).
    //
    // ⚠️ KNOWN-OPEN (security re-review Finding 1): `backend_base` is a renderer
    // argument, so `run` performed this exchange against a relay the RENDERER
    // chose. A modified renderer can therefore point it at a fake relay and mint
    // any `user_id`/`role`. These fields are trustworthy ONLY when `backend_base`
    // is the genuine relay. Closing this requires a pinned trust anchor the
    // renderer cannot swap — an allowlisted/compiled relay host, or verifying the
    // relay-signed Ed25519 seat token before trusting the identity (Option A).
    // Tracked for the coordinator's trust-anchor decision; the shipped feature is
    // dark until then.
    if let Some(user_id) = exchange
        .get("user")
        .and_then(|user| user.get("user_id"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
    {
        let org_admin = exchange
            .get("user")
            .and_then(|user| user.get("role"))
            .and_then(|value| value.as_str())
            == Some("admin");
        let org_id = exchange
            .get("access_token")
            .and_then(|value| value.as_str())
            .and_then(access_token_org_id)
            .unwrap_or_default();
        crate::commands::firm::session::set_identity(crate::commands::firm::session::FirmIdentity {
            user_id: user_id.to_string(),
            org_id,
            org_admin,
        });
    }

    Ok(exchange.to_string())
}

/// Read the `org_id` claim from a relay access-token JWT WITHOUT verifying the
/// signature. Sound to the same degree as the rest of the identity: the token
/// came from the relay `run` contacted over TLS — but that relay is chosen by
/// the renderer-supplied `backend_base` (see the KNOWN-OPEN note above), so this
/// is only as trustworthy as `backend_base` being the genuine relay.
fn access_token_org_id(token: &str) -> Option<String> {
    use base64::Engine;
    let payload = token.split('.').nth(1)?;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    claims
        .get("org_id")
        .and_then(|value| value.as_str())
        .map(str::to_owned)
}

/// Accept one connection, read the GET request line, respond to the browser,
/// and return the `sso_code`. Times out after `timeout`.
///
/// Drains remaining request headers before closing to send a clean TCP FIN
/// instead of a RST, preventing `net::ERR_CONNECTION_RESET` in the browser.
async fn await_sso_redirect(
    listener: tokio::net::TcpListener,
    timeout: Duration,
) -> anyhow::Result<String> {
    let body_ok = b"<html><body>Signed in. You can close this tab and return to Advisor Prep Hero.</body></html>";
    let body_err = b"<html><body>Sign-in failed. Return to Advisor Prep Hero and try again.</body></html>";

    tokio::time::timeout(timeout, async move {
        let (mut socket, _peer) = listener.accept().await?;

        // Read bytes until we see \r\n (end of request line) or the buffer fills.
        let mut buf = Vec::with_capacity(4096);
        let mut tmp = [0u8; 1];
        loop {
            socket.read_exact(&mut tmp).await?;
            buf.push(tmp[0]);
            if buf.ends_with(b"\r\n") || buf.len() > 8192 {
                break;
            }
        }

        let line = String::from_utf8_lossy(&buf).trim_end().to_string();

        // Drain remaining request headers to empty the receive buffer.
        drain_sso_request_headers(&mut socket).await;

        match parse_sso_redirect(&line) {
            SsoRedirect::Code(c) => {
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body_ok.len()
                );
                let _ = socket.write_all(resp.as_bytes()).await;
                let _ = socket.write_all(body_ok).await;
                let _ = socket.flush().await;
                let _ = socket.shutdown().await;
                Ok(c)
            }
            SsoRedirect::Error(e) => {
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body_err.len()
                );
                let _ = socket.write_all(resp.as_bytes()).await;
                let _ = socket.write_all(body_err).await;
                let _ = socket.flush().await;
                let _ = socket.shutdown().await;
                Err(anyhow!(e))
            }
            SsoRedirect::None => {
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body_err.len()
                );
                let _ = socket.write_all(resp.as_bytes()).await;
                let _ = socket.write_all(body_err).await;
                let _ = socket.flush().await;
                let _ = socket.shutdown().await;
                Err(anyhow!("no_code_in_redirect"))
            }
        }
    })
    .await
    .map_err(|_| anyhow!("timed_out_waiting_for_sso"))?
}

/// Race `await_sso_redirect` against `cancel` being set, polling every 150ms.
/// Lets a pending interactive SSO wait be aborted immediately (user clicked
/// Cancel, or closed the IdP popup and gave up) instead of sitting on the
/// full `timeout`. Returns `Err("cancelled")` when the cancel flag wins.
async fn await_sso_redirect_or_cancel(
    listener: tokio::net::TcpListener,
    timeout: Duration,
    cancel: Arc<AtomicBool>,
) -> anyhow::Result<String> {
    let redirect_fut = await_sso_redirect(listener, timeout);
    tokio::pin!(redirect_fut);
    loop {
        tokio::select! {
            res = &mut redirect_fut => {
                // A redirect that lands in the same instant Cancel was
                // clicked can win this select before the next poll tick
                // notices — re-check `cancel` here so a late Cancel still
                // wins instead of silently establishing a session.
                if cancel.load(Ordering::SeqCst) {
                    anyhow::bail!("cancelled");
                }
                return res;
            }
            _ = tokio::time::sleep(Duration::from_millis(150)) => {
                if cancel.load(Ordering::SeqCst) {
                    anyhow::bail!("cancelled");
                }
            }
        }
    }
}

/// Read and discard bytes until the end-of-headers marker `\r\n\r\n` or 16 KB.
/// Best-effort: ignores errors (the browser may have already closed its send half).
async fn drain_sso_request_headers(socket: &mut tokio::net::TcpStream) {
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
            Err(_) => break,
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_loopback_redirect_extracts_sso_code() {
        let got = parse_sso_redirect("GET /?sso_code=abc123&state=xyz HTTP/1.1");
        assert_eq!(got, SsoRedirect::Code("abc123".to_string()));
    }

    #[test]
    fn parse_loopback_redirect_surfaces_error() {
        let got = parse_sso_redirect("GET /?sso_error=no_matching_account HTTP/1.1");
        assert_eq!(got, SsoRedirect::Error("no_matching_account".to_string()));
    }

    #[test]
    fn parse_loopback_redirect_none_when_empty() {
        assert_eq!(parse_sso_redirect("GET / HTTP/1.1"), SsoRedirect::None);
    }

    #[test]
    fn parse_loopback_redirect_error_takes_precedence_over_code() {
        // If somehow both are present, error wins.
        let got = parse_sso_redirect("GET /?sso_code=abc&sso_error=fail HTTP/1.1");
        assert_eq!(got, SsoRedirect::Error("fail".to_string()));
    }

    #[test]
    fn parse_loopback_redirect_percent_decodes_value() {
        let got = parse_sso_redirect("GET /?sso_code=hello%20world HTTP/1.1");
        assert_eq!(got, SsoRedirect::Code("hello world".to_string()));
    }

    #[test]
    fn parse_loopback_redirect_unknown_params_ignored() {
        // state= is unknown to the SSO parser — should not prevent code extraction.
        let got = parse_sso_redirect("GET /?state=ignored&sso_code=tok HTTP/1.1");
        assert_eq!(got, SsoRedirect::Code("tok".to_string()));
    }

    #[test]
    fn parse_loopback_redirect_error_percent_decoded() {
        let got = parse_sso_redirect("GET /?sso_error=no%20match HTTP/1.1");
        assert_eq!(got, SsoRedirect::Error("no match".to_string()));
    }

    // ── await_sso_redirect_or_cancel — F2.4 "5-minute frozen login" fix ─────

    #[tokio::test]
    async fn await_sso_redirect_or_cancel_returns_immediately_when_cancelled() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let cancel = Arc::new(AtomicBool::new(true));

        let started = tokio::time::Instant::now();
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            await_sso_redirect_or_cancel(listener, Duration::from_secs(300), cancel),
        )
        .await
        .expect("must not hit the 2s outer test timeout — cancellation should be near-instant");

        assert!(result.is_err(), "a cancelled wait must return an error, not a code");
        assert!(started.elapsed() < Duration::from_secs(1), "cancellation must be detected within one poll tick, not the full timeout");
    }

    #[tokio::test]
    async fn await_sso_redirect_or_cancel_returns_the_code_when_not_cancelled() {
        use tokio::io::AsyncWriteExt;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let cancel = Arc::new(AtomicBool::new(false));

        let task = tokio::spawn(await_sso_redirect_or_cancel(
            listener,
            Duration::from_secs(5),
            cancel,
        ));

        let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{port}")).await.unwrap();
        let request = "GET /?sso_code=REALCODE HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        stream.write_all(request.as_bytes()).await.unwrap();
        stream.flush().await.unwrap();

        let code = task.await.unwrap().expect("must succeed when never cancelled");
        assert_eq!(code, "REALCODE");
    }

    #[tokio::test]
    async fn await_sso_redirect_or_cancel_notices_a_late_cancel() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_setter = cancel.clone();

        let task = tokio::spawn(await_sso_redirect_or_cancel(
            listener,
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
    async fn await_sso_redirect_or_cancel_rejects_a_redirect_that_lands_after_cancel() {
        // Regression: cancel is set, then the IdP redirect ARRIVES right
        // after — the fix re-checks cancel at the moment the redirect
        // resolves so a Cancel that landed first still wins instead of
        // silently establishing a session.
        use tokio::io::AsyncWriteExt;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_setter = cancel.clone();

        let task = tokio::spawn(await_sso_redirect_or_cancel(
            listener,
            Duration::from_secs(300),
            cancel,
        ));

        cancel_setter.store(true, Ordering::SeqCst);
        let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{port}")).await.unwrap();
        let request = "GET /?sso_code=REALCODE HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        stream.write_all(request.as_bytes()).await.unwrap();
        stream.flush().await.unwrap();

        let result = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("must not hit the 2s outer test timeout")
            .unwrap();
        assert!(result.is_err(), "cancel must win even when the redirect lands right after it, not silently return the code");
    }
}

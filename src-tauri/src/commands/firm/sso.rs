use anyhow::anyhow;
use serde::Serialize;
use std::time::Duration;
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
#[tauri::command]
pub async fn firm_sso_authenticate(
    backend_base: String,
    email: String,
) -> Result<String, String> {
    run(backend_base, email).await.map_err(|e| e.to_string())
}

async fn run(backend_base: String, email: String) -> anyhow::Result<String> {
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

    // Open the system browser to the IdP authorization URL.
    if let Err(e) = open::that(auth_url) {
        log::warn!("firm sso: could not open browser automatically: {e}");
    }

    // Wait for the backend→loopback redirect carrying the one-time sso_code.
    let code = await_sso_redirect(listener, Duration::from_secs(300)).await?;

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

    Ok(exchange.to_string())
}

/// Accept one connection, read the GET request line, respond to the browser,
/// and return the `sso_code`. Times out after `timeout`.
async fn await_sso_redirect(
    listener: tokio::net::TcpListener,
    timeout: Duration,
) -> anyhow::Result<String> {
    let html_ok = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n\
        <html><body>Signed in. You can close this tab and return to Keepance.</body></html>";
    let html_err = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n\
        <html><body>Sign-in failed. Return to Keepance and try again.</body></html>";

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

        match parse_sso_redirect(&line) {
            SsoRedirect::Code(c) => {
                let _ = socket.write_all(html_ok).await;
                let _ = socket.flush().await;
                Ok(c)
            }
            SsoRedirect::Error(e) => {
                let _ = socket.write_all(html_err).await;
                let _ = socket.flush().await;
                Err(anyhow!(e))
            }
            SsoRedirect::None => {
                let _ = socket.write_all(html_err).await;
                Err(anyhow!("no_code_in_redirect"))
            }
        }
    })
    .await
    .map_err(|_| anyhow!("timed_out_waiting_for_sso"))?
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
}

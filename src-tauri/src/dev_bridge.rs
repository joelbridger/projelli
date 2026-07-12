use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tokio::sync::oneshot;

const HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 9250;
const DEFAULT_TIMEOUT_MS: u64 = 5_000;

/// The bridge port. Overridable so several debug app instances can run side by
/// side on one machine (each with its own workspace), which is what lets live
/// verification of different surfaces happen in parallel instead of queueing on
/// a single hardcoded port.
fn bridge_port() -> u16 {
    std::env::var("LANTERN_DEV_BRIDGE_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}
const MAX_REQUEST_BYTES: usize = 1024 * 1024;

pub struct DevBridgeState {
    next_id: AtomicU64,
    pending: Mutex<HashMap<String, oneshot::Sender<EvalResult>>>,
    /// A WebView executes injected snippets on one UI thread.  Keeping bridge
    /// requests in order prevents a fast form fill/click sequence from racing
    /// React's event processing and losing an otherwise valid action.
    eval_lock: tokio::sync::Mutex<()>,
}

impl Default for DevBridgeState {
    fn default() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            eval_lock: tokio::sync::Mutex::new(()),
        }
    }
}

struct EvalResult {
    ok: bool,
    result_json: Option<String>,
    error: Option<String>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(DevBridgeState::default());
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let port = bridge_port();
        let listener = match TcpListener::bind((HOST, port)) {
            Ok(listener) => listener,
            Err(error) => {
                log::error!("[dev-bridge] failed to listen on {HOST}:{port}: {error}");
                return;
            }
        };

        log::info!("[dev-bridge] listening on {HOST}:{port}");

        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        handle_stream(stream, app);
                    });
                }
                Err(error) => {
                    log::warn!("[dev-bridge] connection failed: {error}");
                }
            }
        }
    });
}

#[tauri::command(rename = "__dev_bridge_result")]
pub fn dev_bridge_result(
    id: String,
    ok: bool,
    result: Option<String>,
    error: Option<String>,
    state: State<'_, DevBridgeState>,
) -> Result<(), String> {
    let sender = state
        .pending
        .lock()
        .map_err(|_| "dev bridge state lock poisoned".to_string())?
        .remove(&id);

    match sender {
        Some(sender) => {
            let _ = sender.send(EvalResult {
                ok,
                result_json: result,
                error,
            });
            Ok(())
        }
        None => Err(format!("no pending dev bridge eval for id {id}")),
    }
}

fn handle_stream(mut stream: TcpStream, app: AppHandle) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));

    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(error) => {
            let _ = write_json(&mut stream, 400, json!({ "ok": false, "error": error }));
            return;
        }
    };

    let response = match request {
        Request::Options => Ok(json!({ "ok": true })),
        Request::Get { path, query } => route_request(&app, &path, &query),
        Request::UnsupportedMethod(method) => Err(HttpError::new(
            405,
            format!("unsupported method {method}; use GET"),
        )),
    };

    match response {
        Ok(body) => {
            let _ = write_json(&mut stream, 200, body);
        }
        Err(error) => {
            let _ = write_json(
                &mut stream,
                error.status,
                json!({ "ok": false, "error": error.message }),
            );
        }
    }
}

fn route_request(
    app: &AppHandle,
    path: &str,
    query: &HashMap<String, String>,
) -> Result<Value, HttpError> {
    match path {
        "/health" => Ok(json!({ "ok": true, "port": bridge_port() })),
        "/eval" => {
            let js = required_query(query, "js")?;
            let timeout_ms = timeout_ms(query);
            run_eval(app.clone(), js.to_string(), timeout_ms)
        }
        "/click" => {
            let testid = required_query(query, "testid")?;
            let js = format!(
                r#"
const target = Array.from(document.querySelectorAll('[data-testid]'))
  .find((el) => el.getAttribute('data-testid') === {});
if (!target) throw new Error('No element found for data-testid=' + {});
target.scrollIntoView({{ block: 'center', inline: 'center' }});
target.click();
true
"#,
                js_string(testid),
                js_string(testid),
            );
            run_eval(app.clone(), js, timeout_ms(query))
        }
        "/fill" => {
            let testid = required_query(query, "testid")?;
            let text = required_query(query, "text")?;
            let js = format!(
                r#"
const target = Array.from(document.querySelectorAll('[data-testid]'))
  .find((el) => el.getAttribute('data-testid') === {});
if (!target) throw new Error('No element found for data-testid=' + {});
const value = {};
const setNativeValue = (el, nextValue) => {{
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
    el instanceof HTMLInputElement ? HTMLInputElement.prototype :
    null;
  const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
  if (descriptor && descriptor.set) {{
    descriptor.set.call(el, nextValue);
  }} else if ('value' in el) {{
    el.value = nextValue;
  }} else {{
    el.textContent = nextValue;
  }}
}};
if (target.isContentEditable) {{
  target.textContent = value;
}} else {{
  setNativeValue(target, value);
}}
target.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: value }}));
target.dispatchEvent(new Event('change', {{ bubbles: true }}));
true
"#,
                js_string(testid),
                js_string(testid),
                js_string(text),
            );
            run_eval(app.clone(), js, timeout_ms(query))
        }
        "/text" => {
            let selector_js = element_selector_js(query)?;
            let js = format!(
                r#"
const target = {selector_js};
if (!target) null;
else if ('innerText' in target) target.innerText;
else target.textContent || '';
"#
            );
            run_eval(app.clone(), js, timeout_ms(query))
        }
        "/exists" => {
            let testid = required_query(query, "testid")?;
            let js = format!(
                r#"
Array.from(document.querySelectorAll('[data-testid]'))
  .some((el) => el.getAttribute('data-testid') === {})
"#,
                js_string(testid),
            );
            run_eval(app.clone(), js, timeout_ms(query))
        }
        "/url" => run_eval(
            app.clone(),
            "window.location.href".to_string(),
            timeout_ms(query),
        ),
        "/testids" => run_eval(
            app.clone(),
            r#"
Array.from(document.querySelectorAll('[data-testid]'))
  .map((el) => el.getAttribute('data-testid'))
  .filter((value) => value !== null && value !== '')
"#
            .to_string(),
            timeout_ms(query),
        ),
        _ => Err(HttpError::new(404, format!("unknown endpoint {path}"))),
    }
}

fn run_eval(app: AppHandle, js: String, timeout_ms: u64) -> Result<Value, HttpError> {
    match tauri::async_runtime::block_on(eval_in_main_webview(app, js, timeout_ms)) {
        Ok(result) => Ok(json!({ "ok": true, "result": result })),
        Err(error) => Ok(json!({ "ok": false, "error": error })),
    }
}

async fn eval_in_main_webview(
    app: AppHandle,
    js: String,
    timeout_ms: u64,
) -> Result<Value, String> {
    let webview = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next())
        .ok_or_else(|| "main webview is not available".to_string())?;

    let state = app.state::<DevBridgeState>();
    let _eval_guard = state.eval_lock.lock().await;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed).to_string();
    let (sender, receiver) = oneshot::channel();

    state
        .pending
        .lock()
        .map_err(|_| "dev bridge state lock poisoned".to_string())?
        .insert(id.clone(), sender);

    let wrapper = eval_wrapper_js(&id, &js);
    if let Err(error) = webview.eval(wrapper) {
        let _ = state
            .pending
            .lock()
            .map_err(|_| "dev bridge state lock poisoned".to_string())?
            .remove(&id);
        return Err(format!("webview eval failed: {error}"));
    }

    let timeout = Duration::from_millis(timeout_ms.max(1));
    let result = match tokio::time::timeout(timeout, receiver).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => return Err("dev bridge result channel closed".to_string()),
        Err(_) => {
            let _ = state
                .pending
                .lock()
                .map_err(|_| "dev bridge state lock poisoned".to_string())?
                .remove(&id);
            return Err(format!("eval timed out after {timeout_ms}ms"));
        }
    };

    if !result.ok {
        return Err(result.error.unwrap_or_else(|| "eval failed".to_string()));
    }

    let result_json = result.result_json.unwrap_or_else(|| "null".to_string());
    serde_json::from_str(&result_json)
        .map_err(|error| format!("eval returned invalid JSON: {error}"))
}

fn eval_wrapper_js(id: &str, source: &str) -> String {
    let id = js_string(id);
    let source = js_string(source);
    format!(
        r#"
(() => {{
  const id = {id};
  const source = {source};
  const send = (payload) => {{
    const internals = window.__TAURI_INTERNALS__;
    if (!internals || typeof internals.invoke !== 'function') {{
      throw new Error('Tauri invoke is not ready');
    }}
    return internals.invoke('__dev_bridge_result', payload)
      .catch((error) => console.error('[dev-bridge] result delivery failed', error));
  }};
  const stringify = (value) => {{
    if (typeof value === 'undefined') return 'null';
    try {{
      const json = JSON.stringify(
        value,
        (_key, inner) => typeof inner === 'bigint' ? inner.toString() : inner,
      );
      return typeof json === 'string' ? json : 'null';
    }} catch (_error) {{
      try {{
        return JSON.stringify(String(value));
      }} catch (_fallbackError) {{
        return '"[unserializable]"';
      }}
    }}
  }};
  Promise.resolve()
    .then(() => (0, eval)(source))
    .then((value) => Promise.resolve(value))
    .then(
      (value) => send({{ id, ok: true, result: stringify(value), error: null }}),
      (error) => send({{
        id,
        ok: false,
        result: null,
        error: error && (error.stack || error.message)
          ? String(error.stack || error.message)
          : String(error),
      }}),
    );
}})();
"#
    )
}

fn element_selector_js(query: &HashMap<String, String>) -> Result<String, HttpError> {
    if let Some(testid) = query.get("testid") {
        Ok(format!(
            r#"Array.from(document.querySelectorAll('[data-testid]')).find((el) => el.getAttribute('data-testid') === {}) || null"#,
            js_string(testid),
        ))
    } else if let Some(selector) = query.get("selector") {
        Ok(format!("document.querySelector({})", js_string(selector)))
    } else {
        Err(HttpError::new(
            400,
            "missing testid or selector query parameter",
        ))
    }
}

fn required_query<'a>(query: &'a HashMap<String, String>, key: &str) -> Result<&'a str, HttpError> {
    query
        .get(key)
        .map(String::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| HttpError::new(400, format!("missing {key} query parameter")))
}

fn timeout_ms(query: &HashMap<String, String>) -> u64 {
    query
        .get("timeout_ms")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_TIMEOUT_MS)
}

fn js_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

enum Request {
    Get {
        path: String,
        query: HashMap<String, String>,
    },
    Options,
    UnsupportedMethod(String),
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 1024];

    loop {
        let read = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..read]);
        if buf.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if buf.len() > MAX_REQUEST_BYTES {
            return Err("request is too large".to_string());
        }
    }

    let request = String::from_utf8_lossy(&buf);
    let request_line = request
        .lines()
        .next()
        .ok_or_else(|| "missing request line".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| "missing request method".to_string())?;
    let target = parts
        .next()
        .ok_or_else(|| "missing request target".to_string())?;

    match method {
        "GET" => {
            let (path, query) = parse_target(target);
            Ok(Request::Get { path, query })
        }
        "OPTIONS" => Ok(Request::Options),
        _ => Ok(Request::UnsupportedMethod(method.to_string())),
    }
}

fn parse_target(target: &str) -> (String, HashMap<String, String>) {
    let target = target
        .strip_prefix(&format!("http://{HOST}:{}", bridge_port()))
        .unwrap_or(target);
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path, query),
        None => (target, ""),
    };

    let mut parsed = HashMap::new();
    for pair in query.split('&').filter(|part| !part.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        parsed.insert(percent_decode(key), percent_decode(value));
    }

    (path.to_string(), parsed)
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                if let Ok(byte) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                    out.push(byte);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }

    String::from_utf8_lossy(&out).into_owned()
}

fn write_json(stream: &mut TcpStream, status: u16, body: Value) -> std::io::Result<()> {
    let body = serde_json::to_vec(&body).unwrap_or_else(|_| b"{\"ok\":false}".to_vec());
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let headers = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: application/json; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(headers.as_bytes())?;
    stream.write_all(&body)
}

struct HttpError {
    status: u16,
    message: String,
}

impl HttpError {
    fn new(status: u16, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

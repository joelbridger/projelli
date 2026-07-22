use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tokio::sync::oneshot;

const HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 9250;
const PORT_ENV: &str = "LANTERN_DEV_BRIDGE_PORT";
const GOLDEN_LOOP_DIAGNOSTICS_ENV: &str = "LANTERN_GOLDEN_LOOP_DIAGNOSTICS";
/// Keep ordinary DOM probes fast, but do not make a legitimate asynchronous
/// desktop operation (such as opening the encrypted CRM store) look like a
/// broken WebView.  Test runners can tighten or extend this with
/// `LANTERN_DEV_BRIDGE_TIMEOUT_MS`, and individual requests still take
/// precedence via `?timeout_ms=`.
const DEFAULT_TIMEOUT_MS: u64 = 20_000;
const MIN_TIMEOUT_MS: u64 = 100;
const MAX_TIMEOUT_MS: u64 = 120_000;
const MAX_REQUEST_BYTES: usize = 1024 * 1024;

pub struct DevBridgeState {
    next_id: AtomicU64,
    pending: Mutex<HashMap<String, oneshot::Sender<EvalResult>>>,
}

impl Default for DevBridgeState {
    fn default() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
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

/// A deliberately narrow, test-only black box recorder. It holds metadata
/// about renderer startup failures in memory only; the Node harness decides
/// whether to persist its bounded snapshot after a failed assertion.
pub fn golden_loop_diagnostics_initialization_script() -> Option<String> {
    if std::env::var(GOLDEN_LOOP_DIAGNOSTICS_ENV).ok().as_deref() != Some("1") {
        return None;
    }
    Some(r#"(() => {
const recorder = window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__ = { pageErrors: [], consoleErrors: [], unhandledRejections: [], resourceFailures: [], networkFailures: [] };
const add = (key, value) => { if (recorder[key].length < 20) recorder[key].push(value); };
const locationFacts = (value) => {
  try {
    const page = new URL(window.location.href);
    const target = new URL(String(value), page);
    let locationClass = 'other';
    if (target.pathname === '/' || target.pathname === '/index.html') locationClass = 'root';
    else if (target.pathname.startsWith('/src/')) locationClass = 'app-module';
    else if (target.pathname.startsWith('/@vite/')) locationClass = 'vite-runtime';
    return { sameOrigin: target.origin === page.origin, locationClass };
  } catch { return { sameOrigin: false, locationClass: 'unavailable' }; }
};
const errorCategory = (error) => {
  const name = String(error?.name || '');
  if (name === 'SyntaxError') return 'syntax-error';
  if (name === 'ReferenceError') return 'reference-error';
  if (name === 'TypeError') return 'type-error';
  return 'javascript-error';
};
window.addEventListener('error', (event) => {
  const target = event.target;
  if (target && target !== window && (target.src || target.href)) {
    add('resourceFailures', { category: 'resource-load-failure', ...locationFacts(target.src || target.href) });
  } else {
    const category = /module|import/i.test(String(event.message || '')) ? 'module-import' : errorCategory(event.error);
    add('pageErrors', { category, ...locationFacts(event.filename) });
  }
}, true);
window.addEventListener('unhandledrejection', () => add('unhandledRejections', { category: 'unhandled-rejection', sameOrigin: false, locationClass: 'unavailable' }));
const originalError = console.error.bind(console);
console.error = (...args) => { add('consoleErrors', { category: 'console-error', sameOrigin: false, locationClass: 'unavailable' }); return originalError(...args); };
const originalFetch = window.fetch;
if (typeof originalFetch === 'function') window.fetch = (...args) => {
  const requestLocation = locationFacts(args[0]?.url || args[0]);
  return originalFetch.apply(window, args).then((response) => {
    if (response.status >= 400 && response.status <= 599) add('networkFailures', { category: 'http-response-failure', status: response.status, ...requestLocation });
    return response;
  }).catch((error) => { add('networkFailures', { category: 'fetch-rejected', ...requestLocation }); throw error; });
};
})();"#.to_string())
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let requested_port = bridge_port_from_env(std::env::var(PORT_ENV).ok().as_deref());
        let listener = match TcpListener::bind((HOST, requested_port)) {
            Ok(listener) => listener,
            Err(error) => {
                log::error!("[dev-bridge] failed to listen on {HOST}:{requested_port}: {error}");
                return;
            }
        };
        let port = match listener.local_addr() {
            Ok(address) => address.port(),
            Err(error) => {
                log::error!("[dev-bridge] failed to determine bound port: {error}");
                return;
            }
        };

        log::info!("[dev-bridge] listening on {HOST}:{port}");

        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        handle_stream(stream, app, port);
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

fn handle_stream(mut stream: TcpStream, app: AppHandle, port: u16) {
    // `/eval` deliberately keeps its HTTP connection open while JavaScript
    // awaits Tauri work.  A five-second socket deadline used to cut that
    // connection off even when the request's own timeout was longer.  Header
    // reads stay bounded, while the response can accommodate the largest
    // accepted per-request eval budget plus a small serialization margin.
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(
        MAX_TIMEOUT_MS.saturating_add(1_000),
    )));

    let request = match read_request(&mut stream, port) {
        Ok(request) => request,
        Err(error) => {
            let _ = write_json(&mut stream, 400, json!({ "ok": false, "error": error }));
            return;
        }
    };

    let response = match request {
        Request::Options => Ok(json!({ "ok": true })),
        Request::Get { path, query } => route_request(&app, &path, &query, port),
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
    port: u16,
) -> Result<Value, HttpError> {
    match path {
        "/health" => Ok(json!({ "ok": true, "port": port })),
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
    // Do not hold a global lock while the page awaits an async Tauri command.
    // The previous lock made a slow store open block every later probe/click;
    // then an innocent readiness check hit the five-second default and hid the
    // actual source of the wait.  The pending-result map already keys every
    // request by id, and callers that need ordering await each response.
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

    let started = Instant::now();
    let timeout = Duration::from_millis(timeout_ms.max(MIN_TIMEOUT_MS));
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

    let elapsed = started.elapsed();
    if elapsed > Duration::from_secs(1) {
        log::debug!(
            "[dev-bridge] eval id={id} completed in {}ms",
            elapsed.as_millis()
        );
    }
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
        .map(clamp_timeout_ms)
        .unwrap_or_else(default_timeout_ms)
}

fn default_timeout_ms() -> u64 {
    std::env::var("LANTERN_DEV_BRIDGE_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map(clamp_timeout_ms)
        .unwrap_or(DEFAULT_TIMEOUT_MS)
}

fn clamp_timeout_ms(timeout_ms: u64) -> u64 {
    timeout_ms.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
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

fn read_request(stream: &mut TcpStream, port: u16) -> Result<Request, String> {
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
            let (path, query) = parse_target(target, port);
            Ok(Request::Get { path, query })
        }
        "OPTIONS" => Ok(Request::Options),
        _ => Ok(Request::UnsupportedMethod(method.to_string())),
    }
}

fn parse_target(target: &str, port: u16) -> (String, HashMap<String, String>) {
    let target = target
        .strip_prefix(&format!("http://{HOST}:{port}"))
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

fn bridge_port_from_env(value: Option<&str>) -> u16 {
    value
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT)
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
#[cfg(test)]
mod tests {
    use super::{bridge_port_from_env, DEFAULT_PORT};

    #[test]
    fn bridge_port_uses_default_when_unset() {
        assert_eq!(bridge_port_from_env(None), DEFAULT_PORT);
    }

    #[test]
    fn bridge_port_uses_default_when_invalid() {
        assert_eq!(bridge_port_from_env(Some("not-a-port")), DEFAULT_PORT);
        assert_eq!(bridge_port_from_env(Some("70000")), DEFAULT_PORT);
    }

    #[test]
    fn bridge_port_uses_valid_environment_value() {
        assert_eq!(bridge_port_from_env(Some("9251")), 9251);
    }
}

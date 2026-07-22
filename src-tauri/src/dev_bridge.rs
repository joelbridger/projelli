use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
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
    dispatch: Mutex<DispatchMachine>,
}

impl Default for DevBridgeState {
    fn default() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            dispatch: Mutex::new(DispatchMachine::default()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DispatchPhase {
    Queued,
    Executing,
    Completed,
    Cancelled,
    Expired,
}

struct ActiveDispatch {
    id: u64,
    phase: DispatchPhase,
    sender: oneshot::Sender<EvalResult>,
}

#[derive(Default)]
struct DispatchMachine {
    active: Option<ActiveDispatch>,
    last_terminal: Option<(u64, DispatchPhase)>,
    fail_closed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BeginDecision {
    Execute,
    Skip,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TimeoutDecision {
    ReleasedQueued,
    RetainedExecuting,
    AlreadyFinished,
}

impl DispatchMachine {
    fn queue(&mut self, id: u64, sender: oneshot::Sender<EvalResult>) -> Result<(), String> {
        if self.fail_closed {
            return Err("dev bridge dispatch is fail-closed".to_string());
        }
        if self.active.is_some() {
            return Err("dev bridge already has an evaluation in flight".to_string());
        }
        self.active = Some(ActiveDispatch {
            id,
            phase: DispatchPhase::Queued,
            sender,
        });
        Ok(())
    }

    /// This transition is the only point at which source gains permission to
    /// begin. It shares one mutex with timeout, so an expired queued request
    /// can never pass this gate later.
    fn begin(&mut self, id: u64) -> BeginDecision {
        if self.fail_closed {
            return BeginDecision::Skip;
        }
        match self.active.as_mut() {
            Some(active) if active.id == id && active.phase == DispatchPhase::Queued => {
                active.phase = DispatchPhase::Executing;
                BeginDecision::Execute
            }
            _ => BeginDecision::Skip,
        }
    }

    fn timeout(&mut self, id: u64) -> TimeoutDecision {
        let Some(active) = self.active.as_mut() else {
            return TimeoutDecision::AlreadyFinished;
        };
        if active.id != id {
            return TimeoutDecision::AlreadyFinished;
        }
        match active.phase {
            DispatchPhase::Queued => {
                let expired = self.active.take().expect("matched active dispatch");
                self.last_terminal = Some((expired.id, DispatchPhase::Expired));
                TimeoutDecision::ReleasedQueued
            }
            DispatchPhase::Executing | DispatchPhase::Expired => {
                // Keep exact ownership. The caller may stop waiting, but no
                // later request can overlap source that may still be running.
                active.phase = DispatchPhase::Expired;
                TimeoutDecision::RetainedExecuting
            }
            DispatchPhase::Completed | DispatchPhase::Cancelled => TimeoutDecision::AlreadyFinished,
        }
    }

    fn finish(&mut self, id: u64, terminal: DispatchPhase) -> Option<oneshot::Sender<EvalResult>> {
        debug_assert!(matches!(
            terminal,
            DispatchPhase::Completed | DispatchPhase::Cancelled
        ));
        let active = self.active.as_ref()?;
        if active.id != id
            || !matches!(
                active.phase,
                DispatchPhase::Executing | DispatchPhase::Expired
            )
        {
            return None;
        }
        let finished = self.active.take().expect("matched active dispatch");
        self.last_terminal = Some((id, terminal));
        Some(finished.sender)
    }

    fn cancel_queued(&mut self, id: u64) -> Option<oneshot::Sender<EvalResult>> {
        let active = self.active.as_ref()?;
        if active.id != id || active.phase != DispatchPhase::Queued {
            return None;
        }
        let cancelled = self.active.take().expect("matched queued dispatch");
        self.last_terminal = Some((id, DispatchPhase::Cancelled));
        Some(cancelled.sender)
    }

    fn channel_closed(&mut self, id: u64) {
        if self.active.as_ref().is_some_and(|active| active.id == id) {
            if let Some(active) = self.active.as_mut() {
                active.phase = DispatchPhase::Cancelled;
            }
        }
        // Losing the exact completion signal means we cannot prove that the
        // source stopped. Preserve ownership and refuse all future work.
        self.fail_closed = true;
    }

    fn poison_fail_closed(&mut self) {
        if let Some(active) = self.active.as_mut() {
            active.phase = DispatchPhase::Cancelled;
        }
        self.fail_closed = true;
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
    let request_id = id
        .parse::<u64>()
        .map_err(|_| "invalid dev bridge request identity".to_string())?;
    let sender = lock_dispatch(&state)?.finish(request_id, DispatchPhase::Completed);
    let Some(sender) = sender else {
        return Err("no matching active dev bridge evaluation".to_string());
    };
    // A receiver that already timed out is expected. The exact callback still
    // completed the exact owner, so it is safe for a later request to proceed.
    let _ = sender.send(EvalResult {
        ok,
        result_json: result,
        error,
    });
    Ok(())
}

fn lock_dispatch(state: &DevBridgeState) -> Result<MutexGuard<'_, DispatchMachine>, String> {
    match state.dispatch.lock() {
        Ok(guard) => Ok(guard),
        Err(poisoned) => {
            let mut guard = poisoned.into_inner();
            guard.poison_fail_closed();
            Err("dev bridge dispatch lock poisoned; bridge is fail-closed".to_string())
        }
    }
}

fn deliver_dispatch_error(sender: oneshot::Sender<EvalResult>, message: &'static str) {
    let _ = sender.send(EvalResult {
        ok: false,
        result_json: None,
        error: Some(message.to_string()),
    });
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
    let state = app.state::<DevBridgeState>();
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = oneshot::channel();
    lock_dispatch(&state)?.queue(id, sender)?;

    let wrapper = eval_wrapper_js(&id.to_string(), &js);
    let dispatch_app = app.clone();
    if app
        .run_on_main_thread(move || {
            let state = dispatch_app.state::<DevBridgeState>();
            let may_execute = match lock_dispatch(&state) {
                Ok(mut machine) => machine.begin(id) == BeginDecision::Execute,
                Err(_) => false,
            };
            if !may_execute {
                return;
            }

            let webview = dispatch_app
                .get_webview_window("main")
                .or_else(|| dispatch_app.webview_windows().into_values().next());
            let dispatch_failed = match webview {
                Some(webview) => webview.eval(wrapper).is_err(),
                None => true,
            };
            if dispatch_failed {
                let sender = match lock_dispatch(&state) {
                    Ok(mut machine) => machine.finish(id, DispatchPhase::Cancelled),
                    Err(_) => None,
                };
                if let Some(sender) = sender {
                    // Persisted diagnostics classify the phase only; never put
                    // platform errors, paths, URLs, or source in this message.
                    deliver_dispatch_error(sender, "native webview dispatch failed");
                }
            }
        })
        .is_err()
    {
        let sender = lock_dispatch(&state)?.cancel_queued(id);
        if let Some(sender) = sender {
            deliver_dispatch_error(sender, "native main-thread dispatch failed");
        }
    }

    let started = Instant::now();
    let timeout = Duration::from_millis(timeout_ms.max(MIN_TIMEOUT_MS));
    let result = match tokio::time::timeout(timeout, receiver).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => {
            lock_dispatch(&state)?.channel_closed(id);
            return Err("dev bridge result channel closed; bridge is fail-closed".to_string());
        }
        Err(_) => {
            let _ = lock_dispatch(&state)?.timeout(id);
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
    use super::{
        bridge_port_from_env, lock_dispatch, BeginDecision, DevBridgeState, DispatchMachine,
        DispatchPhase, TimeoutDecision, DEFAULT_PORT,
    };
    use std::sync::{Arc, Barrier, Mutex};
    use std::thread;
    use tokio::sync::oneshot;

    fn queue(machine: &mut DispatchMachine, id: u64) -> oneshot::Receiver<super::EvalResult> {
        let (sender, receiver) = oneshot::channel();
        machine.queue(id, sender).expect("request should queue");
        receiver
    }

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

    #[test]
    fn queued_timeout_before_main_dispatch_prevents_source_start_and_releases_capacity() {
        let mut machine = DispatchMachine::default();
        let _receiver = queue(&mut machine, 1);
        assert_eq!(machine.timeout(1), TimeoutDecision::ReleasedQueued);
        assert_eq!(machine.begin(1), BeginDecision::Skip);
        assert_eq!(machine.last_terminal, Some((1, DispatchPhase::Expired)));
        let _next_receiver = queue(&mut machine, 2);
    }

    #[test]
    fn timeout_and_main_dispatch_make_one_atomic_start_decision() {
        for id in 1..=200 {
            let machine = Arc::new(Mutex::new(DispatchMachine::default()));
            let _receiver = {
                let mut guard = machine.lock().unwrap();
                queue(&mut guard, id)
            };
            let barrier = Arc::new(Barrier::new(3));
            let begin_machine = Arc::clone(&machine);
            let begin_barrier = Arc::clone(&barrier);
            let begin = thread::spawn(move || {
                begin_barrier.wait();
                begin_machine.lock().unwrap().begin(id)
            });
            let timeout_machine = Arc::clone(&machine);
            let timeout_barrier = Arc::clone(&barrier);
            let timeout = thread::spawn(move || {
                timeout_barrier.wait();
                timeout_machine.lock().unwrap().timeout(id)
            });
            barrier.wait();
            let begin = begin.join().unwrap();
            let timeout = timeout.join().unwrap();
            let mut guard = machine.lock().unwrap();
            match (begin, timeout) {
                (BeginDecision::Execute, TimeoutDecision::RetainedExecuting) => {
                    assert_eq!(guard.active.as_ref().unwrap().phase, DispatchPhase::Expired);
                    let (sender, _receiver) = oneshot::channel();
                    assert!(guard.queue(id + 1_000, sender).is_err());
                }
                (BeginDecision::Skip, TimeoutDecision::ReleasedQueued) => {
                    assert!(guard.active.is_none());
                    let _next_receiver = queue(&mut guard, id + 1_000);
                }
                other => panic!("non-atomic transition result: {other:?}"),
            }
        }
    }

    #[test]
    fn executing_timeout_keeps_exact_single_flight_owner_until_callback() {
        let mut machine = DispatchMachine::default();
        let _receiver = queue(&mut machine, 10);
        assert_eq!(machine.begin(10), BeginDecision::Execute);
        assert_eq!(machine.timeout(10), TimeoutDecision::RetainedExecuting);
        assert_eq!(
            machine.active.as_ref().unwrap().phase,
            DispatchPhase::Expired
        );
        let (sender, _receiver) = oneshot::channel();
        assert!(machine.queue(11, sender).is_err());
        assert!(machine.finish(10, DispatchPhase::Completed).is_some());
        let _next_receiver = queue(&mut machine, 11);
    }

    #[test]
    fn late_callback_finishes_only_its_exact_owner_and_cannot_free_a_newer_request() {
        let mut machine = DispatchMachine::default();
        let _receiver = queue(&mut machine, 20);
        assert_eq!(machine.begin(20), BeginDecision::Execute);
        assert_eq!(machine.timeout(20), TimeoutDecision::RetainedExecuting);
        assert!(machine.finish(20, DispatchPhase::Completed).is_some());
        let _new_receiver = queue(&mut machine, 21);
        assert!(machine.finish(20, DispatchPhase::Completed).is_none());
        assert_eq!(machine.active.as_ref().map(|active| active.id), Some(21));
    }

    #[test]
    fn late_dispatch_error_cannot_cancel_or_free_a_newer_request() {
        let mut machine = DispatchMachine::default();
        let _receiver = queue(&mut machine, 30);
        assert_eq!(machine.begin(30), BeginDecision::Execute);
        assert!(machine.finish(30, DispatchPhase::Cancelled).is_some());
        let _new_receiver = queue(&mut machine, 31);
        assert!(machine.finish(30, DispatchPhase::Cancelled).is_none());
        assert_eq!(machine.active.as_ref().map(|active| active.id), Some(31));
    }

    #[test]
    fn second_request_is_refused_while_first_is_queued_executing_or_expired() {
        for phase in [
            DispatchPhase::Queued,
            DispatchPhase::Executing,
            DispatchPhase::Expired,
        ] {
            let mut machine = DispatchMachine::default();
            let _receiver = queue(&mut machine, 40);
            if phase != DispatchPhase::Queued {
                assert_eq!(machine.begin(40), BeginDecision::Execute);
            }
            if phase == DispatchPhase::Expired {
                assert_eq!(machine.timeout(40), TimeoutDecision::RetainedExecuting);
            }
            let (sender, _receiver) = oneshot::channel();
            assert!(machine.queue(41, sender).is_err(), "phase={phase:?}");
        }
    }

    #[test]
    fn poisoned_dispatch_lock_recovers_state_only_to_fail_closed() {
        let state = Arc::new(DevBridgeState::default());
        let poison_state = Arc::clone(&state);
        let _ = thread::spawn(move || {
            let _guard = poison_state.dispatch.lock().unwrap();
            panic!("intentional poison");
        })
        .join();
        assert!(lock_dispatch(&state).is_err());
        let guard = match state.dispatch.lock() {
            Ok(_) => panic!("dispatch mutex unexpectedly recovered poison"),
            Err(poisoned) => poisoned.into_inner(),
        };
        assert!(guard.fail_closed);
    }

    #[test]
    fn result_channel_close_retains_owner_and_fails_closed() {
        let mut machine = DispatchMachine::default();
        let _receiver = queue(&mut machine, 50);
        assert_eq!(machine.begin(50), BeginDecision::Execute);
        machine.channel_closed(50);
        assert!(machine.fail_closed);
        assert_eq!(machine.active.as_ref().map(|active| active.id), Some(50));
        assert_eq!(
            machine.active.as_ref().unwrap().phase,
            DispatchPhase::Cancelled
        );
        let (sender, _receiver) = oneshot::channel();
        assert!(machine.queue(51, sender).is_err());
    }

    #[test]
    fn success_and_dispatch_error_clean_up_only_the_exact_owner() {
        let mut machine = DispatchMachine::default();
        let _success_receiver = queue(&mut machine, 60);
        assert_eq!(machine.begin(60), BeginDecision::Execute);
        assert!(machine.finish(60, DispatchPhase::Completed).is_some());
        assert_eq!(machine.last_terminal, Some((60, DispatchPhase::Completed)));
        let _error_receiver = queue(&mut machine, 61);
        assert_eq!(machine.begin(61), BeginDecision::Execute);
        assert!(machine.finish(61, DispatchPhase::Cancelled).is_some());
        assert_eq!(machine.last_terminal, Some((61, DispatchPhase::Cancelled)));
        assert!(machine.active.is_none());
    }

    #[test]
    fn main_thread_dispatch_failure_cancels_only_the_exact_queued_owner() {
        let mut machine = DispatchMachine::default();
        let _receiver = queue(&mut machine, 70);
        assert!(machine.cancel_queued(71).is_none());
        assert_eq!(machine.active.as_ref().map(|active| active.id), Some(70));
        assert!(machine.cancel_queued(70).is_some());
        assert_eq!(machine.last_terminal, Some((70, DispatchPhase::Cancelled)));
        assert!(machine.active.is_none());
    }
}

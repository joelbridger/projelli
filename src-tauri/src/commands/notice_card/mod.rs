//! Notice Card — companion-webview commands.
//!
//! The Notice Card joins the advisor's meeting as a guest to show every
//! participant that recording is happening, entirely on the advisor's machine.
//! These commands open, tear down, and read the status of the ISOLATED
//! companion window that does the joining.
//!
//! ## Security model (why this is safe with an untrusted meeting page)
//!
//! The companion window is created with a distinct label (`notice-card-*`). The
//! app's Tauri capabilities are scoped to `"windows": ["main"]` (see
//! `capabilities/default.json`), so the companion window inherits NO commands
//! and NO permissions — the untrusted meeting page it loads cannot invoke any
//! app command or reach any app internal. State flows OUT of the page one-way
//! only: the injected script writes an opaque token into `document.title`, and
//! the app polls it from the trusted main window via `notice_card_status`. The
//! page can set only its own title; it gains zero authority.
//!
//! Nothing from the meeting is captured, stored, or transmitted by this window
//! — it is a notice signal, not a recorder. The recording pipeline is the
//! existing local system-audio capture, untouched.
//!
//! VERIFY-LIVE: the actual guest-join automation is exercised on the Windows/
//! Mac bench against the real Teams/Zoom web clients; the adapters fail soft to
//! the verified-verbal-notice fallback if a page drifts, so a mismatch degrades
//! gracefully and never breaks the recording.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::commands::connector_network::authorize_configured_host;
use crate::network_policy::{AuthorizedGeneration, NetworkPolicy, MEETING_AUTO_JOIN};

/// Only https meeting links may ever be opened in the companion window. Guards
/// against a malformed or non-web scheme (`file:`, `javascript:`, etc.) ever
/// reaching the webview. Pure + unit-tested.
pub fn is_allowed_join_url(raw: &str) -> bool {
    match tauri::Url::parse(raw) {
        Ok(u) => u.scheme() == "https" && u.host_str().is_some_and(|h| !h.is_empty()),
        Err(_) => false,
    }
}

fn authorize_join_url(
    policy: &NetworkPolicy,
    join_url: &str,
) -> Result<AuthorizedGeneration, String> {
    let url = tauri::Url::parse(join_url).map_err(|e| format!("parse join url: {e}"))?;
    let host = url
        .host_str()
        .ok_or_else(|| "notice card join url must have a host".to_string())?;
    authorize_configured_host(policy, &MEETING_AUTO_JOIN, join_url, host).map_err(|e| e.to_string())
}

/// Open (or replace) the isolated companion window for one card and begin the
/// guest join. `init_script` is the self-contained automation the app built
/// (`buildInjectionScript`); it runs before the meeting page's own scripts.
#[tauri::command]
pub async fn notice_card_open(
    app: AppHandle,
    policy: tauri::State<'_, NetworkPolicy>,
    label: String,
    join_url: String,
    init_script: String,
) -> Result<(), String> {
    if !is_allowed_join_url(&join_url) {
        return Err("notice card join url must be a valid https link".into());
    }
    // This is deliberately before window construction: while Offline Mode is
    // on Lantern must not even begin an app-opened meeting navigation.
    let authorized = authorize_join_url(policy.inner(), &join_url)?;
    let url = tauri::Url::parse(&join_url).map_err(|e| format!("parse join url: {e}"))?;

    // Replace any stale window with this label so a re-record rejoins cleanly.
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.destroy();
    }

    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .title("Recording Notice")
        .inner_size(520.0, 400.0)
        .initialization_script(&init_script);

    #[cfg(all(windows, debug_assertions))]
    let builder = {
        let browser_args = crate::webview_env::debug_webview_browser_args(&label);
        log::info!("[webview2-debug] {label}: window_path=additional_browser_args");
        builder.additional_browser_args(&browser_args)
    };

    #[cfg(not(all(windows, debug_assertions)))]
    let builder = {
        // MUST match the main window's WebView2 additional-browser-args exactly.
        // wry creates a fresh CoreWebView2Environment per window; WebView2
        // rejects a second environment on the same user-data-folder whose args
        // differ with ERROR_INVALID_STATE (HRESULT 0x8007139F). The shared string
        // reproduces every extra wry would add on its own (notably
        // `--autoplay-policy=no-user-gesture-required`, which this window needs
        // to play meeting media without a user gesture), so the two windows stay
        // byte-for-byte identical without losing any behavior.
        builder.additional_browser_args(&crate::webview_env::webview_browser_args())
    };

    // Hold the generation grant until the last moment before Tauri creates the
    // external webview. If Offline Mode flipped while this command prepared the
    // window, the now-stale grant stops the navigation before construction.
    policy
        .assert_authorized_generation(&authorized)
        .map_err(|e| e.to_string())?;

    builder
        // CRITICAL for the status channel: the injected script reports the join
        // phase by writing `NC:<phase>` into the PAGE's `document.title`, but
        // `notice_card_status` reads the NATIVE window title (`title()`), and
        // Tauri/wry do NOT mirror the page title into the native title on their
        // own. Without this, on a real Teams/Zoom join the poller would only
        // ever see the static "Recording Notice" native title, never the NC:
        // tokens — so the supervisor would time out and close a card that had
        // actually joined. Mirroring the page title here into the native title
        // makes `notice_card_status`'s `title()` observe the channel. (Setting
        // the native title does not change `document.title`, so this can't loop.)
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .build()
        .map_err(|e| format!("open notice card window: {e}"))?;
    Ok(())
}

/// Tear down the companion window. Idempotent: an already-absent window is
/// success. This is the forceful watchdog kill — a wedged window cannot linger.
#[tauri::command]
pub fn notice_card_close(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&label) {
        w.destroy()
            .map_err(|e| format!("close notice card window: {e}"))?;
    }
    Ok(())
}

/// Read the companion window's current title — the one-way status channel.
///
/// Channel path: the injected script writes `NC:<phase>` into the PAGE's
/// `document.title`; `notice_card_open`'s `on_document_title_changed` mirror
/// copies that into the NATIVE window title; this reads the native title via
/// `title()`. (Reading the page's `document.title` directly isn't possible here
/// — `eval()` is fire-and-forget with no return value — hence the mirror.)
/// Returns `None` when the window is gone, which the caller treats as
/// closed/disconnected. VERIFY-LIVE: the mirror + poll round-trip is confirmed
/// on the bench against a real Teams/Zoom join.
#[tauri::command]
pub fn notice_card_status(app: AppHandle, label: String) -> Result<Option<String>, String> {
    match app.get_webview_window(&label) {
        Some(w) => w
            .title()
            .map(Some)
            .map_err(|e| format!("read notice card title: {e}")),
        None => Ok(None),
    }
}

/// Play a short WAV announcement through the companion page's fake microphone.
/// The companion page defines the JS hook inside the initialization script; this
/// command only passes bytes into that hook and never exposes app capabilities to
/// the untrusted meeting page.
#[tauri::command]
pub fn notice_card_announce(
    app: AppHandle,
    label: String,
    wav_base64: String,
) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| "notice card window is not open".to_string())?;
    let arg = serde_json::to_string(&wav_base64)
        .map_err(|e| format!("encode notice card announcement: {e}"))?;
    window
        .eval(&format!(
            "try {{ window.__NOTICE_CARD_ANNOUNCE_WAV_BASE64__ && window.__NOTICE_CARD_ANNOUNCE_WAV_BASE64__({arg}); }} catch (e) {{}}"
        ))
        .map_err(|e| format!("announce notice card audio: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_https_meeting_links() {
        assert!(is_allowed_join_url(
            "https://teams.microsoft.com/l/meetup-join/abc"
        ));
        assert!(is_allowed_join_url("https://acme.zoom.us/j/123?pwd=x"));
        // Rejected: non-https schemes, missing host, and junk.
        assert!(!is_allowed_join_url("http://teams.microsoft.com/x")); // not https
        assert!(!is_allowed_join_url("file:///etc/passwd"));
        assert!(!is_allowed_join_url("javascript:alert(1)"));
        assert!(!is_allowed_join_url("not a url"));
        assert!(!is_allowed_join_url(""));
    }

    #[test]
    fn offline_mode_blocks_meeting_auto_join_with_the_standard_message() {
        let policy = NetworkPolicy::load_from_directory(&tempfile::tempdir().unwrap().keep());
        policy.set_offline_mode(true).unwrap();
        let error = authorize_join_url(&policy, "https://teams.microsoft.com/l/meetup-join/abc")
            .unwrap_err();
        assert_eq!(error, "Offline Mode is on. Lantern cannot connect to the internet. Turn it off to use meeting auto-join.");
    }

    #[test]
    fn offline_mode_blocks_loopback_meeting_auto_join_too() {
        let policy = NetworkPolicy::load_from_directory(&tempfile::tempdir().unwrap().keep());
        policy.set_offline_mode(true).unwrap();
        let error = authorize_join_url(&policy, "https://127.0.0.1/meeting").unwrap_err();
        assert_eq!(error, "Offline Mode is on. Lantern cannot connect to the internet. Turn it off to use meeting auto-join.");
    }
}

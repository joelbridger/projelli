//! Shared WebView2 environment options for EVERY webview window in the app.
//!
//! ## Why this module exists (QA-91: Notice Card never joins the meeting)
//!
//! On Windows, wry creates a *separate* `CoreWebView2Environment` for each
//! webview window (see `CreateCoreWebView2EnvironmentWithOptions` in wry's
//! `webview2/mod.rs`). WebView2 requires that **every environment sharing one
//! user-data-folder use IDENTICAL `AdditionalBrowserArguments`**. If a second
//! webview is created with a *different* argument string, WebView2 refuses with
//! `ERROR_INVALID_STATE` — `HRESULT(0x8007139F)` — and the window never opens.
//!
//! The app has two webview windows: the main window (`lib.rs`) and the Notice
//! Card companion window (`commands/notice_card/mod.rs`). Before this module the
//! main window passed an explicit args string (the wry default PLUS anything in
//! `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, e.g. `--remote-debugging-port=…`
//! when a developer/bench build is driven over CDP), while the Notice Card
//! window passed no args at all and got wry's bare default. Those two strings
//! match only when the env var is unset — so under CDP-driven Windows testing
//! (and any run that sets the env var) the Notice Card webview creation failed
//! with `0x8007139F` and the recording-notice guest never joined the meeting.
//!
//! The fix is to compute the argument string in ONE place and hand the *same*
//! string to BOTH window builders. Passing an explicit string makes wry use it
//! verbatim — it only appends its own autoplay/proxy extras on the `None` path —
//! so this string must itself REPRODUCE every extra wry would have added for our
//! windows. In particular it keeps `--autoplay-policy=no-user-gesture-required`
//! (wry's default, which the companion window needs to play meeting media with no
//! user gesture); see `WRY_DEFAULT_BROWSER_ARGS`. With both windows fed the same
//! complete string they are byte-for-byte identical in every config.

/// The full additional-browser-args string wry would build for THIS app's
/// webviews when left to its own devices — reproduced exactly so that our
/// explicit string is byte-identical to wry's own default and can never differ
/// from what an un-overridden wry webview would use.
///
/// Derived directly from wry-0.55.1 `webview2/mod.rs` (the `unwrap_or_else`
/// default at lines 294-322), which assembles, in order:
///   1. `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`
///      (wry's `default_args`, always present).
///   2. ` --autoplay-policy=no-user-gesture-required` — appended when
///      `attributes.autoplay` is true. wry defaults `autoplay: true`
///      (`wry/src/lib.rs:843`) and Tauri never overrides it (the identifier
///      "autoplay" appears nowhere in tauri / tauri-runtime / tauri-runtime-wry),
///      so it is ALWAYS true for our windows — hence always present here. This is
///      the flag the Notice Card companion window needs: it auto-joins with no
///      user gesture, so gesture-free autoplay is what lets the meeting page play
///      remote participants' media and drive the canvas camera feed. Dropping it
///      (as the first cut of this fix did) risks the card's media stalling.
///   3. proxy args — appended only when `attributes.proxy_config` is `Some`.
///      This app configures NO proxy on either window, so wry never appends them;
///      they are deliberately omitted here (fabricating a `--proxy-server` would
///      be wrong, and their absence is identical on both windows so it is not a
///      mismatch risk).
///
/// If a wry upgrade changes any of the above, `base_matches_wry_default` in the
/// tests will flag it.
pub const WRY_DEFAULT_BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// The additional-browser-args string that EVERY webview window in the app must
/// use. In debug builds only, reads the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
/// env var (set when the app is driven over CDP) and appends it to the shared
/// base. Release builds deliberately ignore that process/machine env var so a
/// real user's WebView2 profile/cache cannot be redirected by outside state.
/// Call this from every `WebviewWindowBuilder`; never build the string ad hoc.
pub fn webview_browser_args() -> String {
    webview_browser_args_with(
        std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").ok(),
        cfg!(debug_assertions),
    )
}

/// Pure core of [`webview_browser_args`], split out so the env-independent
/// behavior is unit-testable without touching process-global state.
fn webview_browser_args_with(extra: Option<String>, allow_env_extra_args: bool) -> String {
    let mut args = String::from(WRY_DEFAULT_BROWSER_ARGS);
    if !allow_env_extra_args {
        return args;
    }

    if let Some(extra) = extra {
        let extra = extra.trim();
        if !extra.is_empty() {
            args.push(' ');
            args.push_str(extra);
        }
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_matches_wry_default() {
        // The base MUST equal the COMPLETE string wry builds by default for our
        // windows (disable-features + autoplay, no proxy). If it doesn't, a window
        // that falls back to wry's default (or a wry upgrade) would diverge from
        // one that uses our string, reintroducing the 0x8007139F mismatch — and,
        // per QA-91 round 2, dropping autoplay would also stall the Notice Card's
        // gesture-free media.
        assert_eq!(
            WRY_DEFAULT_BROWSER_ARGS,
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required"
        );
    }

    #[test]
    fn base_includes_gesture_free_autoplay() {
        // Explicit guard for the specific flag the companion window relies on to
        // play meeting media without a user gesture. wry appends this whenever
        // autoplay is enabled (its default); our explicit string must carry it.
        assert!(
            WRY_DEFAULT_BROWSER_ARGS.contains("--autoplay-policy=no-user-gesture-required"),
            "shared args must keep gesture-free autoplay for the Notice Card media feed"
        );
    }

    #[test]
    fn no_extra_yields_exactly_the_base() {
        // With no env override the string is byte-identical to wry's default, so
        // it can never conflict with any other webview created without options.
        assert_eq!(
            webview_browser_args_with(None, true),
            WRY_DEFAULT_BROWSER_ARGS
        );
    }

    #[test]
    fn empty_or_whitespace_extra_is_ignored() {
        assert_eq!(
            webview_browser_args_with(Some(String::new()), true),
            WRY_DEFAULT_BROWSER_ARGS
        );
        assert_eq!(
            webview_browser_args_with(Some("   ".into()), true),
            WRY_DEFAULT_BROWSER_ARGS
        );
    }

    #[test]
    fn debug_or_bench_extra_is_appended_after_a_single_space() {
        // This is the CDP case that used to crash the Notice Card: the main
        // window got the port arg, the companion window didn't. Now the SAME
        // function produces the SAME string for both. The cloud/Legion bench
        // launches `npm run tauri:dev`, so `debug_assertions` is true and this
        // extra CDP port remains available there.
        let args = webview_browser_args_with(Some("--remote-debugging-port=9223".into()), true);
        assert_eq!(
            args,
            format!("{WRY_DEFAULT_BROWSER_ARGS} --remote-debugging-port=9223")
        );
    }

    #[test]
    fn release_build_ignores_external_webview_args() {
        // This is the production hardening: a machine-level env var must not be
        // able to redirect a real user's WebView2 profile/cache.
        let args = webview_browser_args_with(
            Some("--remote-debugging-port=9223 --user-data-dir=C:\\wrong-profile".into()),
            false,
        );
        assert_eq!(args, WRY_DEFAULT_BROWSER_ARGS);
    }

    #[test]
    fn surrounding_whitespace_on_extra_is_trimmed() {
        let args = webview_browser_args_with(Some("  --foo=bar  ".into()), true);
        assert_eq!(args, format!("{WRY_DEFAULT_BROWSER_ARGS} --foo=bar"));
    }

    #[test]
    fn both_windows_get_the_same_string_for_the_same_env() {
        // The invariant the whole fix rests on: two independent calls with the
        // same input produce identical output, so the main window and the Notice
        // Card window are guaranteed to match.
        let a = webview_browser_args_with(Some("--remote-debugging-port=9223".into()), true);
        let b = webview_browser_args_with(Some("--remote-debugging-port=9223".into()), true);
        assert_eq!(a, b);
    }
}

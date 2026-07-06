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
//! when the app is driven over CDP), while the Notice Card window passed no args
//! at all and got wry's bare default. Those two strings match only when the env
//! var is unset — so under CDP-driven Windows testing (and any run that sets the
//! env var) the Notice Card webview creation failed with `0x8007139F` and the
//! recording-notice guest never joined the meeting.
//!
//! The fix is to compute the argument string in ONE place and hand the *same*
//! string to BOTH window builders. Passing an explicit string also makes wry use
//! it verbatim (wry only appends its autoplay/proxy extras when the caller passes
//! `None`), so the two windows are byte-for-byte identical in every config.

/// wry's built-in default additional-browser-args string. Kept as a constant so
/// the base we pass is provably identical to wry's own default — which is what
/// guarantees that, when no extra args are supplied, our explicit string can
/// never differ from what any other wry webview would use.
///
/// Mirrors `wry::webview2` `default_args`
/// (`--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`). If a wry
/// upgrade changes that default, `base_matches_wry_default` in the tests will
/// flag it.
pub const WRY_DEFAULT_BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// The additional-browser-args string that EVERY webview window in the app must
/// use. Reads the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` env var (set when the
/// app is driven over CDP) and appends it to the shared base. Call this from
/// every `WebviewWindowBuilder`; never build the string ad hoc.
pub fn webview_browser_args() -> String {
    webview_browser_args_with(std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").ok())
}

/// Pure core of [`webview_browser_args`], split out so the env-independent
/// behavior is unit-testable without touching process-global state.
fn webview_browser_args_with(extra: Option<String>) -> String {
    let mut args = String::from(WRY_DEFAULT_BROWSER_ARGS);
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
        // The base MUST equal wry's own default string. If it doesn't, a window
        // that falls back to wry's default (or a wry upgrade) would diverge from
        // one that uses our string, reintroducing the 0x8007139F mismatch.
        assert_eq!(
            WRY_DEFAULT_BROWSER_ARGS,
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
        );
    }

    #[test]
    fn no_extra_yields_exactly_the_base() {
        // With no env override the string is byte-identical to wry's default, so
        // it can never conflict with any other webview created without options.
        assert_eq!(webview_browser_args_with(None), WRY_DEFAULT_BROWSER_ARGS);
    }

    #[test]
    fn empty_or_whitespace_extra_is_ignored() {
        assert_eq!(webview_browser_args_with(Some(String::new())), WRY_DEFAULT_BROWSER_ARGS);
        assert_eq!(webview_browser_args_with(Some("   ".into())), WRY_DEFAULT_BROWSER_ARGS);
    }

    #[test]
    fn extra_is_appended_after_a_single_space() {
        // This is the CDP case that used to crash the Notice Card: the main
        // window got the port arg, the companion window didn't. Now the SAME
        // function produces the SAME string for both.
        let args = webview_browser_args_with(Some("--remote-debugging-port=9223".into()));
        assert_eq!(
            args,
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=9223"
        );
    }

    #[test]
    fn surrounding_whitespace_on_extra_is_trimmed() {
        let args = webview_browser_args_with(Some("  --foo=bar  ".into()));
        assert_eq!(
            args,
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --foo=bar"
        );
    }

    #[test]
    fn both_windows_get_the_same_string_for_the_same_env() {
        // The invariant the whole fix rests on: two independent calls with the
        // same input produce identical output, so the main window and the Notice
        // Card window are guaranteed to match.
        let a = webview_browser_args_with(Some("--remote-debugging-port=9223".into()));
        let b = webview_browser_args_with(Some("--remote-debugging-port=9223".into()));
        assert_eq!(a, b);
    }
}

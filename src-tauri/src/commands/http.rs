// HTTP commands - Phase 2 Rust foundation for v1.5.
//
// Public surface:
//   - `fetch_url_title(url)`   — Q12 smart-paste. Fetches a page, pulls
//                                 <title> out of the HTML. Safe: 5s timeout,
//                                 10 MiB body cap, up to 5 redirects.
//                                 Returns "" on any error so the frontend
//                                 falls back to inserting the raw URL.
//   - `ollama_list_models()`   — Phase 4 stub. Not wired to anything yet.
//   - `ollama_chat_stream()`   — Phase 4 stub. Phase 4 wires the streaming
//                                 reqwest loop + tauri event emitter.
//
// The title-extraction helper is factored out as `extract_title_from_html`
// so it can be unit-tested without touching the network.

use std::time::Duration;

use crate::commands::connector_network::{authorize_url, await_authorized, send_with_authorized_redirects};
use crate::network_policy::{NetworkPolicy, EXTERNAL_NAVIGATION};

/// Max number of bytes we'll read from a response body before giving up.
/// Most <title> tags appear in the first few hundred bytes; 10 MiB is more
/// than enough without exposing us to a pathological server trying to
/// stream forever. Keeps memory bounded.
const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;

/// Extract the contents of the first `<title>...</title>` block from a
/// (partial) HTML document.
///
/// This is intentionally minimal: a real HTML parser would be overkill for
/// a one-field extraction. We look for `<title` (tolerating attributes like
/// `<title lang="en">`), skip to the first `>`, then capture up to the next
/// `</title`. We decode the handful of HTML entities that commonly appear
/// in titles (`&amp; &lt; &gt; &quot; &apos; &#NN;`). Whitespace is
/// collapsed to single spaces and trimmed, matching how most browsers
/// render tab titles.
///
/// Returns `None` if no recognisable `<title>` block is found.
pub fn extract_title_from_html(html: &str) -> Option<String> {
    // Case-insensitive search for the opening tag. We scan once over the
    // lowercased bytes to find an index, then operate on the original
    // string from that index so entity casing inside the title is
    // preserved.
    let lower = html.to_ascii_lowercase();
    let open_idx = lower.find("<title")?;

    // Move past the closing '>' of the opening tag. This handles
    // attributes like `<title class="x">` and whitespace-only forms.
    let after_open = open_idx + "<title".len();
    let rest = html.get(after_open..)?;
    let tag_close = rest.find('>')?;
    let content_start = after_open + tag_close + 1;

    // Now find the closing tag.
    let remaining = html.get(content_start..)?;
    let remaining_lower = lower.get(content_start..)?;
    let content_end_rel = remaining_lower.find("</title")?;
    let raw = remaining.get(..content_end_rel)?;

    let decoded = decode_common_entities(raw);
    let collapsed = collapse_whitespace(&decoded);
    if collapsed.is_empty() {
        None
    } else {
        Some(collapsed)
    }
}

/// Decode the handful of HTML character entities that commonly appear in
/// page titles. This is NOT a full HTML5 entity table; we only care about
/// the ones that show up in the wild often enough to matter for link text:
///   `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` `&#39;` `&nbsp;` and numeric
///   character references `&#NN;` / `&#xHH;` (ASCII range only).
/// Anything else is left as-is.
fn decode_common_entities(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'&' {
            // Find next ';' within 10 bytes (any legitimate entity is short).
            let lookahead_end = (i + 10).min(bytes.len());
            if let Some(semi_rel) = bytes[i + 1..lookahead_end].iter().position(|&c| c == b';') {
                let entity = &input[i + 1..i + 1 + semi_rel];
                match entity {
                    "amp" => out.push('&'),
                    "lt" => out.push('<'),
                    "gt" => out.push('>'),
                    "quot" => out.push('"'),
                    "apos" => out.push('\''),
                    "nbsp" => out.push(' '),
                    num if num.starts_with('#') => {
                        let digits = &num[1..];
                        let code = if let Some(hex) = digits
                            .strip_prefix('x')
                            .or_else(|| digits.strip_prefix('X'))
                        {
                            u32::from_str_radix(hex, 16).ok()
                        } else {
                            digits.parse::<u32>().ok()
                        };
                        if let Some(c) = code.and_then(char::from_u32) {
                            out.push(c);
                        } else {
                            // Leave malformed numeric ref as-is.
                            out.push('&');
                            out.push_str(entity);
                            out.push(';');
                        }
                    }
                    _ => {
                        out.push('&');
                        out.push_str(entity);
                        out.push(';');
                    }
                }
                i += 1 + semi_rel + 1;
                continue;
            }
        }
        // Copy the next UTF-8 character, preserving multi-byte sequences.
        let ch = input[i..].chars().next().unwrap_or('\0');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// Collapse runs of whitespace (ASCII + Unicode per `char::is_whitespace`)
/// to a single space and trim. Matches how browsers display page titles.
fn collapse_whitespace(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_space = true; // treat leading whitespace as already-collapsed
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    if out.ends_with(' ') {
        out.pop();
    }
    out
}

/// Fetch a URL and return the HTML `<title>` contents, or an empty string
/// if anything goes wrong (invalid URL, timeout, HTTP error, no title tag).
/// The frontend treats `""` as "fall back to the raw URL".
///
/// Timeout is 5 seconds. Body is read to a hard 10 MiB cap. Up to 5
/// redirects are followed.
#[tauri::command]
pub async fn fetch_url_title(
    url: String,
    policy: tauri::State<'_, NetworkPolicy>,
) -> Result<String, String> {
    reqwest::Url::parse(&url).map_err(|_| "invalid URL".to_string())?;
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Advisor Prep HeroTitleFetcher/1.0")
        .build()
    {
        Ok(c) => c,
        Err(_) => return Ok(String::new()),
    };

    let resp = match send_with_authorized_redirects(
        policy.inner(),
        &EXTERNAL_NAVIGATION,
        &url,
        |request_url| {
            let client = client.clone();
            async move { Ok(client.get(request_url).send().await?) }
        },
    )
    .await
    {
        Ok(response) => response,
        Err(_) => return Ok(String::new()),
    };
        if !resp.status().is_success() {
            return Ok(String::new());
        }

    // Stream the response body up to MAX_BODY_BYTES. We can usually stop much
    // earlier (once we see `</title>`), which both saves bandwidth and avoids
    // pulling huge pages into memory. The body gets its own grant: the
    // request-level grant ended once headers were received.
    let body_url = resp.url().as_str().to_string();
    let body_grant = match authorize_url(policy.inner(), &EXTERNAL_NAVIGATION, &body_url) {
        Ok(grant) => grant,
        Err(_) => return Ok(String::new()),
    };
    let title = await_authorized(policy.inner(), &body_grant, async {
        let mut stream = resp.bytes_stream();
        Ok::<String, anyhow::Error>(read_title_body(&mut stream).await)
    })
    .await;
    Ok(title.unwrap_or_default())
}

async fn read_title_body<S, B, E>(stream: &mut S) -> String
where
    S: futures_util::Stream<Item = Result<B, E>> + Unpin,
    B: AsRef<[u8]>,
{
    let mut buf: Vec<u8> = Vec::with_capacity(8 * 1024);
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(_) => break,
        };
        buf.extend_from_slice(chunk.as_ref());
        if buf.len() >= MAX_BODY_BYTES {
            buf.truncate(MAX_BODY_BYTES);
            break;
        }
        if has_complete_title(&buf) {
            break;
        }
    }
    let html = String::from_utf8_lossy(&buf);
    extract_title_from_html(&html).unwrap_or_default()
}

/// Cheap check used to short-circuit streaming once we've got a title tag.
/// Does a case-insensitive byte scan rather than allocating a lowercase
/// copy of the whole buffer.
fn has_complete_title(buf: &[u8]) -> bool {
    let open = b"<title";
    let close = b"</title";
    let mut open_at: Option<usize> = None;
    for i in 0..buf.len().saturating_sub(open.len()) {
        if buf[i..i + open.len()].eq_ignore_ascii_case(open) {
            open_at = Some(i);
            break;
        }
    }
    let Some(start) = open_at else {
        return false;
    };
    for i in start..buf.len().saturating_sub(close.len()) {
        if buf[i..i + close.len()].eq_ignore_ascii_case(close) {
            return true;
        }
    }
    false
}

// --------------------------------------------------------------------
// Ollama stubs. Real implementations land in Phase 4 (Q7 provider + M6
// voice-driven chat). Declaring them here lets the frontend start wiring
// the provider adapter against the real command names without a second
// round of Tauri config / capability changes.
// --------------------------------------------------------------------

/// List models available on the local Ollama daemon. Stub in Phase 2.
#[tauri::command]
pub async fn ollama_list_models() -> Result<Vec<String>, String> {
    Err("ollama_list_models not implemented yet (Phase 4 / Q7).".to_string())
}

/// Start a streaming chat with a local Ollama model. Stub in Phase 2.
/// Phase 4 will wire this to reqwest streaming + tauri event emission.
#[tauri::command]
pub async fn ollama_chat_stream(
    _model: String,
    _messages: serde_json::Value,
) -> Result<(), String> {
    Err("ollama_chat_stream not implemented yet (Phase 4 / Q7).".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_simple_title() {
        let html = "<html><head><title>Hello World</title></head></html>";
        assert_eq!(
            extract_title_from_html(html).as_deref(),
            Some("Hello World")
        );
    }

    #[test]
    fn handles_title_with_attributes() {
        let html = r#"<title lang="en" class="main">Tagged Title</title>"#;
        assert_eq!(
            extract_title_from_html(html).as_deref(),
            Some("Tagged Title")
        );
    }

    #[test]
    fn mixed_case_tags() {
        let html = "<HTML><HEAD><TiTlE>Case Test</TITLE></HEAD>";
        assert_eq!(extract_title_from_html(html).as_deref(), Some("Case Test"));
    }

    #[test]
    fn collapses_whitespace_and_trims() {
        let html = "<title>\n  Spacey   Title\t\n</title>";
        assert_eq!(
            extract_title_from_html(html).as_deref(),
            Some("Spacey Title")
        );
    }

    #[test]
    fn decodes_common_entities() {
        let html = "<title>Ben &amp; Jerry&apos;s &lt;tasty&gt;</title>";
        assert_eq!(
            extract_title_from_html(html).as_deref(),
            Some("Ben & Jerry's <tasty>")
        );
    }

    #[test]
    fn decodes_numeric_entities() {
        let html = "<title>A&#38;B &#x26; C</title>";
        assert_eq!(extract_title_from_html(html).as_deref(), Some("A&B & C"));
    }

    #[test]
    fn returns_none_on_missing_title() {
        let html = "<html><body>no title here</body></html>";
        assert_eq!(extract_title_from_html(html), None);
    }

    #[test]
    fn returns_none_on_empty_title() {
        let html = "<title>   </title>";
        assert_eq!(extract_title_from_html(html), None);
    }

    #[test]
    fn unclosed_title_returns_none() {
        let html = "<title>never ends";
        assert_eq!(extract_title_from_html(html), None);
    }

    #[test]
    fn collapse_whitespace_pure() {
        assert_eq!(collapse_whitespace("  a \t b\nc  "), "a b c");
        assert_eq!(collapse_whitespace(""), "");
        assert_eq!(collapse_whitespace("   "), "");
    }

    #[test]
    fn decode_entities_leaves_unknown_untouched() {
        let s = decode_common_entities("&unknown;&amp;&foo;");
        assert_eq!(s, "&unknown;&&foo;");
    }

    #[test]
    fn decode_entities_preserves_unicode() {
        let s = decode_common_entities("café &amp; ümlaut");
        assert_eq!(s, "café & ümlaut");
    }

    #[test]
    fn has_complete_title_detects_close() {
        assert!(has_complete_title(b"<title>X</title>"));
        assert!(has_complete_title(b"noise <TITLE>foo</TITLE> trailing"));
        assert!(!has_complete_title(b"<title>incomplete"));
        assert!(!has_complete_title(b"no tags here at all"));
    }

    #[tokio::test]
    async fn offline_mode_stops_title_body_after_the_first_chunk() {
        let policy_dir = tempfile::tempdir().unwrap();
        let policy = crate::network_policy::NetworkPolicy::load_from_directory(policy_dir.path());
        let grant = authorize_url(
            &policy,
            &EXTERNAL_NAVIGATION,
            "https://example.com/article",
        )
        .unwrap();
        let (first_chunk_tx, first_chunk_rx) = tokio::sync::oneshot::channel();
        let (release_second_tx, release_second_rx) = tokio::sync::oneshot::channel();
        let stream = Box::pin(futures_util::stream::unfold(
            (0_u8, Some(first_chunk_tx), Some(release_second_rx)),
            |(state, first_chunk, release_second)| async move {
                match state {
                    0 => {
                        let _ = first_chunk.unwrap().send(());
                        Some((
                            Ok::<Vec<u8>, std::io::Error>(b"<html><head>".to_vec()),
                            (1, None, release_second),
                        ))
                    }
                    1 => {
                        release_second?.await.ok()?;
                        Some((
                            Ok::<Vec<u8>, std::io::Error>(b"<title>must not arrive</title>".to_vec()),
                            (2, None, None),
                        ))
                    }
                    _ => None,
                }
            },
        ));
        let work_policy = policy.clone();
        let work = tokio::spawn(async move {
            let mut stream = stream;
            await_authorized(&work_policy, &grant, async {
                Ok::<String, anyhow::Error>(read_title_body(&mut stream).await)
            })
            .await
        });

        first_chunk_rx.await.unwrap();
        policy.set_offline_mode(true).unwrap();
        assert!(work.await.unwrap().is_err());
        let _ = release_second_tx.send(());
    }
}

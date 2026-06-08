use crate::commands::mail::model::{BodyContentType, MailMessage, Recipient};

fn fmt_recipient(r: &Recipient) -> String {
    match (&r.name, &r.address) {
        (Some(n), Some(a)) => format!("{n} <{a}>"),
        (None, Some(a)) => a.clone(),
        (Some(n), None) => n.clone(),
        _ => String::new(),
    }
}

fn yaml_escape(s: &str) -> String {
    // Escape backslash and quote first, then literal line breaks. Without the
    // newline/carriage-return escapes a crafted subject (e.g. one containing a
    // line that is just `---`) could turn the single-line double-quoted scalar
    // into a multi-line one and inject/await a spurious YAML document break.
    // Backslash is replaced first so the backslashes we introduce below are not
    // doubled again.
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

/// Naive but dependency-free HTML-to-text: drop tags and the contents of
/// `<script>`/`<style>` blocks, collapse whitespace, decode the few entities
/// email actually uses. Good enough for indexing; fidelity is not the goal
/// (the original stays in the store).
fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut tag = String::new();
    // True while inside a <script>/<style> element: their text content is code,
    // not prose, and would otherwise pollute the search index.
    let mut skip_content = false;
    for c in html.chars() {
        match c {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' => {
                in_tag = false;
                let name = tag.trim().to_ascii_lowercase();
                let first = name
                    .split(|ch: char| ch.is_ascii_whitespace() || ch == '/')
                    .find(|s| !s.is_empty())
                    .unwrap_or("");
                if name.starts_with('/') {
                    if first == "script" || first == "style" {
                        skip_content = false;
                    }
                } else if first == "script" || first == "style" {
                    skip_content = true;
                }
            }
            _ if in_tag => tag.push(c),
            _ if !skip_content => out.push(c),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn to_markdown(m: &MailMessage) -> String {
    let from = match (&m.from_name, &m.from_address) {
        (Some(n), Some(a)) => format!("{n} <{a}>"),
        (_, Some(a)) => a.clone(),
        _ => String::new(),
    };
    let to = m
        .to
        .iter()
        .map(fmt_recipient)
        .collect::<Vec<_>>()
        .join(", ");
    let cc = m
        .cc
        .iter()
        .map(fmt_recipient)
        .collect::<Vec<_>>()
        .join(", ");
    let body = match m.body_content_type {
        BodyContentType::Html => html_to_text(&m.body_text),
        BodyContentType::Text => m.body_text.clone(),
    };
    let mut s = String::new();
    s.push_str("---\n");
    s.push_str(&format!("message_id: \"{}\"\n", yaml_escape(&m.id)));
    if let Some(c) = &m.conversation_id {
        s.push_str(&format!("conversation_id: \"{}\"\n", yaml_escape(c)));
    }
    if let Some(i) = &m.internet_message_id {
        s.push_str(&format!("internet_message_id: \"{}\"\n", yaml_escape(i)));
    }
    s.push_str(&format!("subject: \"{}\"\n", yaml_escape(&m.subject)));
    if let Some(t) = &m.thread_id {
        s.push_str(&format!("thread_id: \"{}\"\n", yaml_escape(t)));
    }
    if !m.folders.is_empty() {
        s.push_str(&format!("folders: \"{}\"\n", yaml_escape(&m.folders.join(", "))));
    }
    if !m.provider.is_empty() {
        s.push_str(&format!("provider: \"{}\"\n", yaml_escape(&m.provider)));
    }
    s.push_str(&format!("from: \"{}\"\n", yaml_escape(&from)));
    s.push_str(&format!("to: \"{}\"\n", yaml_escape(&to)));
    if !cc.is_empty() {
        s.push_str(&format!("cc: \"{}\"\n", yaml_escape(&cc)));
    }
    if let Some(d) = &m.received_date_time {
        s.push_str(&format!("date: \"{}\"\n", yaml_escape(d)));
    }
    s.push_str(&format!("has_attachments: {}\n", m.has_attachments));
    s.push_str("source: microsoft365\n");
    s.push_str("---\n\n");
    let heading_subject = m.subject.replace(['\r', '\n'], " ");
    s.push_str(&format!("# {}\n\n", heading_subject));
    s.push_str(&body);
    s.push('\n');
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::mail::model::{BodyContentType, MailMessage, Recipient};

    fn msg() -> MailMessage {
        MailMessage {
            id: "AAMk-123".into(),
            conversation_id: Some("conv-9".into()),
            internet_message_id: Some("<abc@hender.com>".into()),
            subject: "Closing date".into(),
            received_date_time: Some("2026-05-01T14:30:00Z".into()),
            from_name: Some("Pat H".into()),
            from_address: Some("pat@hender.com".into()),
            to: vec![Recipient {
                name: Some("Me".into()),
                address: Some("me@firm.com".into()),
            }],
            cc: vec![],
            folders: vec![],
            thread_id: None,
            provider: "m365".into(),
            account: String::new(),
            has_attachments: false,
            body_content_type: BodyContentType::Text,
            body_text: "Confirming May 14.".into(),
        }
    }

    #[test]
    fn renders_frontmatter_and_body() {
        let md = to_markdown(&msg());
        assert!(md.starts_with("---\n"));
        // FIX E: message_id, conversation_id, and date are now quoted
        assert!(md.contains("message_id: \"AAMk-123\""));
        assert!(md.contains("conversation_id: \"conv-9\""));
        assert!(md.contains("date: \"2026-05-01T14:30:00Z\""));
        assert!(md.contains("from: \"Pat H <pat@hender.com>\""));
        assert!(md.contains("subject: \"Closing date\""));
        assert!(md.contains("\n---\n")); // closing fence
        assert!(md.trim_end().ends_with("Confirming May 14."));
    }

    #[test]
    fn html_body_is_stripped_to_text() {
        let mut m = msg();
        m.body_content_type = BodyContentType::Html;
        m.body_text = "<p>Hi <b>there</b></p>".into();
        let md = to_markdown(&m);
        assert!(md.contains("Hi there"));
        assert!(!md.contains("<b>"));
    }

    #[test]
    fn quotes_are_escaped_in_frontmatter() {
        let mut m = msg();
        m.subject = "Re: \"urgent\" matter".into();
        let md = to_markdown(&m);
        assert!(md.contains("subject: \"Re: \\\"urgent\\\" matter\""));
    }

    #[test]
    fn message_id_and_conversation_id_and_date_are_quoted() {
        // FIX E: all three fields must be quoted + yaml_escape'd, not bare values
        let md = to_markdown(&msg());
        assert!(md.contains("message_id: \"AAMk-123\""),
            "message_id must be quoted, got:\n{md}");
        assert!(md.contains("conversation_id: \"conv-9\""),
            "conversation_id must be quoted, got:\n{md}");
        assert!(md.contains("date: \"2026-05-01T14:30:00Z\""),
            "date must be quoted, got:\n{md}");
    }

    #[test]
    fn newline_in_subject_does_not_break_heading() {
        // FIX F: \n or \r in the subject must be replaced with a space in the heading
        let mut m = msg();
        m.subject = "Line one\nLine two".into();
        let md = to_markdown(&m);
        // The heading must be a single line
        assert!(md.contains("# Line one Line two\n"),
            "heading should collapse newline to space, got:\n{md}");
        // The frontmatter subject keeps the value on ONE physical line: the
        // newline is now escaped as the two characters backslash-n, never raw.
        assert!(md.contains("subject: \"Line one\\nLine two\""),
            "frontmatter subject must escape the newline, got:\n{md}");
        assert!(!md.contains("subject: \"Line one\nLine two\""),
            "frontmatter subject must NOT contain a raw newline, got:\n{md}");
    }

    #[test]
    fn crafted_subject_cannot_inject_a_yaml_document_break() {
        // A subject whose value is a line that is just `---` (or contains one)
        // must not be able to terminate/inject the frontmatter document.
        let mut m = msg();
        m.subject = "evil\n---\ninjected: true".into();
        let md = to_markdown(&m);
        // The whole hostile subject stays on a single escaped frontmatter line.
        assert!(
            md.contains("subject: \"evil\\n---\\ninjected: true\""),
            "subject newlines must be escaped so `---` cannot break the doc, got:\n{md}"
        );
        // The only `---` fences are the opening and closing frontmatter fences.
        let fence_lines = md.lines().filter(|l| l.trim() == "---").count();
        assert_eq!(fence_lines, 2, "expected exactly 2 frontmatter fences, got:\n{md}");
    }

    #[test]
    fn frontmatter_includes_thread_and_provider() {
        let mut m = msg();
        m.thread_id = Some("conv-9".into());
        m.provider = "m365".into();
        m.folders = vec!["Inbox".into(), "Important".into()];
        let md = to_markdown(&m);
        assert!(md.contains("thread_id: \"conv-9\""), "got:\n{md}");
        assert!(md.contains("provider: \"m365\""), "got:\n{md}");
        assert!(md.contains("folders: \"Inbox, Important\""), "got:\n{md}");
    }

    #[test]
    fn script_and_style_content_is_dropped_from_text() {
        let mut m = msg();
        m.body_content_type = BodyContentType::Html;
        m.body_text =
            "<style>.a{color:red}</style><p>Real body</p><script>alert('x')</script>".into();
        let md = to_markdown(&m);
        assert!(md.contains("Real body"), "prose must survive, got:\n{md}");
        assert!(!md.contains("color:red"), "style content must be dropped, got:\n{md}");
        assert!(!md.contains("alert"), "script content must be dropped, got:\n{md}");
    }
}

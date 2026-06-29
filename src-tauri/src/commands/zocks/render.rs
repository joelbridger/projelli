//! Render Zocks sessions into readable text for encrypted RAG indexing.

use crate::commands::zocks::model::{ZocksActionItem, ZocksParticipant, ZocksSession};

const TRANSCRIPT_EXCERPT_CHARS: usize = 8000;

fn append_line(buf: &mut String, label: &str, value: &str) {
    let value = value.trim();
    if value.is_empty() {
        return;
    }
    buf.push_str(label);
    buf.push_str(": ");
    buf.push_str(value);
    buf.push('\n');
}

pub fn zocks_source_id(session_id: &str) -> String {
    format!("zocks:{}", session_id.trim())
}

pub fn render_session(session: &ZocksSession) -> (String, String) {
    let source_id = zocks_source_id(&session.stable_id());
    let mut text = String::new();
    text.push_str("Zocks meeting notes\n");
    append_line(&mut text, "Title", &session.title);
    append_line(&mut text, "Client", &session.client_name);
    append_line(&mut text, "Client email", &session.client_email);
    append_line(&mut text, "Started", &session.started_at);
    append_line(&mut text, "Ended", &session.ended_at);
    append_line(&mut text, "Updated", &session.updated_at);

    if !session.participants.is_empty() {
        text.push_str("Participants:\n");
        for participant in &session.participants {
            append_participant(&mut text, participant);
        }
    }

    append_line(&mut text, "Summary", &session.summary);
    append_line(&mut text, "Notes", &session.notes);

    if !session.key_points.is_empty() {
        text.push_str("Key points:\n");
        for point in &session.key_points {
            let point = point.trim();
            if !point.is_empty() {
                text.push_str("- ");
                text.push_str(point);
                text.push('\n');
            }
        }
    }

    if !session.action_items.is_empty() {
        text.push_str("Action items:\n");
        for item in &session.action_items {
            append_action_item(&mut text, item);
        }
    }

    let transcript = transcript_excerpt(&session.transcript);
    append_line(&mut text, "Transcript excerpt", &transcript);
    if !session.tags.is_empty() {
        append_line(&mut text, "Tags", &session.tags.join(", "));
    }

    (source_id, text)
}

fn append_participant(buf: &mut String, participant: &ZocksParticipant) {
    let name = participant.name.trim();
    let email = participant.email.trim();
    let role = participant.role.trim();
    let mut line = String::from("- ");
    if !name.is_empty() {
        line.push_str(name);
    }
    if !email.is_empty() {
        if !name.is_empty() {
            line.push_str(" <");
            line.push_str(email);
            line.push('>');
        } else {
            line.push_str(email);
        }
    }
    if !role.is_empty() {
        line.push_str(" (");
        line.push_str(role);
        line.push(')');
    }
    if line != "- " {
        buf.push_str(&line);
        buf.push('\n');
    }
}

fn append_action_item(buf: &mut String, item: &ZocksActionItem) {
    let text = item.text.trim();
    if text.is_empty() {
        return;
    }
    let mut line = String::from("- ");
    line.push_str(text);
    if !item.owner.trim().is_empty() {
        line.push_str(" - owner: ");
        line.push_str(item.owner.trim());
    }
    if !item.due_date.trim().is_empty() {
        line.push_str(" - due: ");
        line.push_str(item.due_date.trim());
    }
    if !item.status.trim().is_empty() {
        line.push_str(" - status: ");
        line.push_str(item.status.trim());
    }
    buf.push_str(&line);
    buf.push('\n');
}

fn transcript_excerpt(transcript: &str) -> String {
    let trimmed = transcript.trim();
    if trimmed.chars().count() <= TRANSCRIPT_EXCERPT_CHARS {
        return trimmed.to_string();
    }
    let mut out = trimmed
        .chars()
        .take(TRANSCRIPT_EXCERPT_CHARS)
        .collect::<String>();
    out.push_str("...");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::zocks::model::ZocksSession;

    #[test]
    fn fixture_session_renders_notes_actions_and_transcript_excerpt() {
        let session: ZocksSession =
            serde_json::from_str(include_str!("fixtures/session.json")).unwrap();
        let (source_id, text) = render_session(&session);
        assert_eq!(source_id, "zocks:sess_123");
        assert!(text.contains("Quarterly review with Amelia Rivera"));
        assert!(text.contains("Increase Roth conversion estimate"));
        assert!(text.contains("Amelia asked about cash reserves"));
        assert!(text.contains("Transcript excerpt"));
    }
}

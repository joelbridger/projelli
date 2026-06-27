//! Render Calendly meetings into searchable text.

use crate::commands::calendly::model::{CalendlyEventWithInvitees, CalendlyInvitee};

fn append_line(buf: &mut String, label: &str, value: &str) {
    let v = value.trim();
    if !v.is_empty() {
        buf.push_str(label);
        buf.push_str(": ");
        buf.push_str(v);
        buf.push('\n');
    }
}

pub fn render_meeting(bundle: &CalendlyEventWithInvitees) -> (String, String) {
    let event = &bundle.event;
    let uuid = event.uuid();
    let source_id = format!("calendly:event:{}", uuid);
    let mut text = String::new();
    text.push_str(&format!(
        "Calendly meeting: {}\n",
        non_empty(&event.name, "(untitled)")
    ));
    append_line(&mut text, "Status", &event.status);
    append_line(&mut text, "Start time", &event.start_time);
    append_line(&mut text, "End time", &event.end_time);
    if let Some(location) = &event.location {
        append_line(&mut text, "Location type", &location.r#type);
        append_line(&mut text, "Location", &location.location);
        append_line(&mut text, "Join URL", &location.join_url);
    }

    if !bundle.invitees.is_empty() {
        text.push_str("Invitees:\n");
        for invitee in &bundle.invitees {
            append_invitee(&mut text, invitee);
        }
    }
    (source_id, text)
}

fn append_invitee(buf: &mut String, invitee: &CalendlyInvitee) {
    let mut line = String::from("- ");
    let name = invitee.name.trim();
    let email = invitee.email.trim();
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
    if !invitee.status.trim().is_empty() {
        line.push_str(" (");
        line.push_str(invitee.status.trim());
        line.push(')');
    }
    if line != "- " {
        buf.push_str(&line);
        buf.push('\n');
    }
    for qa in &invitee.questions_and_answers {
        let q = qa.question.trim();
        let a = qa.answer.trim();
        if !q.is_empty() || !a.is_empty() {
            buf.push_str("  Intake Q&A");
            if !q.is_empty() {
                buf.push_str(" - ");
                buf.push_str(q);
            }
            if !a.is_empty() {
                buf.push_str(": ");
                buf.push_str(a);
            }
            buf.push('\n');
        }
    }
}

fn non_empty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback
    } else {
        trimmed
    }
}

#[cfg(test)]
mod tests {
    use crate::commands::calendly::model::{
        CalendlyEventWithInvitees, CalendlyInvitee, CalendlyQuestionAnswer, CalendlyScheduledEvent,
    };

    use super::render_meeting;

    #[test]
    fn render_meeting_includes_invitee_qa() {
        let bundle = CalendlyEventWithInvitees {
            event: CalendlyScheduledEvent {
                uri: "https://api.calendly.com/scheduled_events/abc".into(),
                name: "Initial consult".into(),
                start_time: "2026-07-01T14:00:00Z".into(),
                ..Default::default()
            },
            invitees: vec![CalendlyInvitee {
                name: "Amelia Rivera".into(),
                email: "amelia@example.com".into(),
                questions_and_answers: vec![CalendlyQuestionAnswer {
                    question: "What is this about?".into(),
                    answer: "Estate plan review".into(),
                }],
                ..Default::default()
            }],
        };
        let (source_id, text) = render_meeting(&bundle);
        assert_eq!(source_id, "calendly:event:abc");
        assert!(text.contains("Amelia Rivera <amelia@example.com>"));
        assert!(text.contains("What is this about?"));
        assert!(text.contains("Estate plan review"));
    }
}
